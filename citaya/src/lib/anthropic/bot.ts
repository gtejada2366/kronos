import type Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODEL, getAnthropic } from "./client";
import { BOT_TOOLS } from "./tools";
import { buildSystemPrompt } from "./prompts";
import { computeAvailableSlots, pickSuggestions } from "../calendar/availability";
import { buildYapeLink, paymentReference } from "../payments/yape";
import { logger } from "../logger";
import { PAYMENT_GRACE_MINUTES } from "../constants";
import { createSupabaseServiceClient } from "../supabase/server";
import type {
  AvailabilityOverride,
  AvailabilityRule,
  Clinic,
  Conversation,
  Lead,
  Message,
  Service
} from "../types";

const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 800;
const HISTORY_LOOKBACK = 30; // last N messages from this conversation

export interface BotRunInput {
  clinic: Clinic;
  lead: Lead;
  conversation: Conversation;
  inboundText: string;
}

export interface BotRunOutput {
  reply: string | null;
  needsHandoff: boolean;
  handoffReason?: string;
  bookedAppointmentId?: string;
}

/**
 * Runs one turn of the bot: takes the latest patient message, talks to Claude
 * with tools, executes any tools, and returns the assistant text reply to send
 * via WhatsApp.
 */
export async function runBotTurn(input: BotRunInput): Promise<BotRunOutput> {
  const supabase = createSupabaseServiceClient();
  const { clinic, lead, conversation, inboundText } = input;

  const [
    { data: services },
    { data: rules },
    { data: overrides },
    { data: history },
    { data: appointments }
  ] = await Promise.all([
    supabase.from("services").select("*").eq("clinic_id", clinic.id).eq("active", true).order("sort_order"),
    supabase.from("availability_rules").select("*").eq("clinic_id", clinic.id),
    supabase.from("availability_overrides").select("*").eq("clinic_id", clinic.id),
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LOOKBACK),
    supabase
      .from("appointments")
      .select("scheduled_at, duration_minutes, status")
      .eq("clinic_id", clinic.id)
      .gte("scheduled_at", new Date().toISOString())
  ]);

  const servicesArr = (services ?? []) as Service[];
  const rulesArr = (rules ?? []) as AvailabilityRule[];
  const overridesArr = (overrides ?? []) as AvailabilityOverride[];

  const messagesForLlm: Anthropic.MessageParam[] = [];
  for (const m of (history ?? []) as Message[]) {
    if (m.role === "system") continue;
    if (m.direction === "inbound") {
      messagesForLlm.push({ role: "user", content: m.content });
    } else {
      messagesForLlm.push({ role: "assistant", content: m.content });
    }
  }
  messagesForLlm.push({ role: "user", content: inboundText });

  const system = buildSystemPrompt({
    clinic,
    services: servicesArr,
    patientName: lead.name
  });

  const anthropic = getAnthropic();

  let needsHandoff = false;
  let handoffReason: string | undefined;
  let bookedAppointmentId: string | undefined;
  const conversationMessages: Anthropic.MessageParam[] = [...messagesForLlm];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools: BOT_TOOLS,
      messages: conversationMessages
    });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");

    if (toolUses.length === 0) {
      const reply = textBlocks.map((b) => b.text).join("\n").trim() || null;
      return { reply, needsHandoff, handoffReason, bookedAppointmentId };
    }

    conversationMessages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu, {
        clinic,
        lead,
        conversation,
        services: servicesArr,
        rules: rulesArr,
        overrides: overridesArr,
        existingAppointments: (appointments ?? []) as Array<{
          scheduled_at: string;
          duration_minutes: number;
          status: string;
        }>
      });

      if (result.kind === "handoff") {
        needsHandoff = true;
        handoffReason = result.reason;
      }
      if (result.kind === "booked") {
        bookedAppointmentId = result.appointmentId;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result.payload),
        is_error: result.kind === "error"
      });
    }

    conversationMessages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") break;
  }

  const last = conversationMessages[conversationMessages.length - 1];
  let fallback: string | null = null;
  if (last && last.role === "assistant") {
    const content = last.content;
    if (typeof content === "string") fallback = content;
    else fallback = content.filter((b: { type: string }) => b.type === "text").map((b: { type: string; text?: string }) => b.text ?? "").join("\n").trim() || null;
  }
  if (!fallback) {
    logger.warn("bot_no_text_reply", { conversation_id: conversation.id });
    fallback = "Disculpa, tuvimos un inconveniente. Una persona de la clínica te responderá en breve.";
    needsHandoff = true;
    handoffReason = handoffReason ?? "no_text_reply";
  }
  return { reply: fallback, needsHandoff, handoffReason, bookedAppointmentId };
}

interface ToolContext {
  clinic: Clinic;
  lead: Lead;
  conversation: Conversation;
  services: Service[];
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  existingAppointments: Array<{ scheduled_at: string; duration_minutes: number; status: string }>;
}

interface ExecResult {
  kind: "ok" | "error" | "handoff" | "booked";
  payload: Record<string, unknown>;
  reason?: string;
  appointmentId?: string;
}

async function executeTool(
  tu: { name: string; input: unknown },
  ctx: ToolContext
): Promise<ExecResult> {
  switch (tu.name) {
    case "get_available_slots":
      return execGetSlots(tu.input as { service_id: string; days_ahead?: number; prefer?: string }, ctx);
    case "book_appointment":
      return execBookAppointment(
        tu.input as { service_id: string; slot_iso: string; patient_name?: string },
        ctx
      );
    case "cancel_appointment":
      return execCancelAppointment(
        tu.input as { appointment_id: string; reason?: string },
        ctx
      );
    case "handoff_to_human":
      return {
        kind: "handoff",
        reason: (tu.input as { reason?: string }).reason || "patient_request",
        payload: { ok: true }
      };
    default:
      return { kind: "error", payload: { error: `unknown tool ${tu.name}` } };
  }
}

async function execGetSlots(
  input: { service_id: string; days_ahead?: number; prefer?: string },
  ctx: ToolContext
): Promise<ExecResult> {
  const service = ctx.services.find((s) => s.id === input.service_id);
  if (!service) {
    return { kind: "error", payload: { error: "service_not_found" } };
  }
  const slots = computeAvailableSlots({
    rules: ctx.rules,
    overrides: ctx.overrides,
    appointments: ctx.existingAppointments.map((a) => ({
      scheduled_at: a.scheduled_at,
      duration_minutes: a.duration_minutes,
      status: a.status as "pending_payment" | "confirmed" | "completed" | "cancelled" | "no_show" | "expired"
    })),
    timezone: ctx.clinic.timezone,
    serviceDurationMinutes: service.duration_minutes,
    daysAhead: input.days_ahead ?? 14
  });
  const filtered = applyPreference(slots, input.prefer, ctx.clinic.timezone);
  const suggestions = pickSuggestions(filtered, 3);
  return {
    kind: "ok",
    payload: {
      service: { id: service.id, name: service.name, duration_minutes: service.duration_minutes },
      timezone: ctx.clinic.timezone,
      slots: suggestions.map((s) => ({
        start: s.start,
        end: s.end,
        human_friendly: humanFriendly(s.start, ctx.clinic.timezone)
      }))
    }
  };
}

async function execBookAppointment(
  input: { service_id: string; slot_iso: string; patient_name?: string },
  ctx: ToolContext
): Promise<ExecResult> {
  const service = ctx.services.find((s) => s.id === input.service_id);
  if (!service) return { kind: "error", payload: { error: "service_not_found" } };

  const supabase = createSupabaseServiceClient();
  const start = new Date(input.slot_iso);
  if (Number.isNaN(start.getTime())) return { kind: "error", payload: { error: "invalid_slot_iso" } };
  const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);

  const { data: conflicts } = await supabase
    .from("appointments")
    .select("id, scheduled_at, duration_minutes, status")
    .eq("clinic_id", ctx.clinic.id)
    .lt("scheduled_at", end.toISOString())
    .gte("scheduled_at", new Date(start.getTime() - 4 * 60 * 60 * 1000).toISOString());
  const conflict = (conflicts ?? []).some((a) => {
    if (a.status === "cancelled" || a.status === "no_show" || a.status === "expired") return false;
    const aStart = new Date(a.scheduled_at);
    const aEnd = new Date(aStart.getTime() + a.duration_minutes * 60 * 1000);
    return aStart < end && aEnd > start;
  });
  if (conflict) return { kind: "error", payload: { error: "slot_taken" } };

  const reference = paymentReference();
  const yape = buildYapeLink({
    merchantHandle: ctx.clinic.yape_handle ?? "",
    amount: ctx.clinic.signal_amount,
    currency: ctx.clinic.currency,
    reference,
    description: `Señal ${service.name}`
  });
  const expiresAt = new Date(Date.now() + PAYMENT_GRACE_MINUTES * 60 * 1000).toISOString();

  if (input.patient_name && !ctx.lead.name) {
    await supabase.from("leads").update({ name: input.patient_name }).eq("id", ctx.lead.id);
  }

  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: ctx.clinic.id,
      lead_id: ctx.lead.id,
      service_id: service.id,
      scheduled_at: start.toISOString(),
      duration_minutes: service.duration_minutes,
      status: "pending_payment",
      signal_amount: ctx.clinic.signal_amount,
      total_price: service.price,
      payment_link: yape.link,
      payment_reference: reference
    })
    .select("*")
    .single();
  if (error || !appointment) {
    logger.error("bot_book_failed", { error: error?.message });
    return { kind: "error", payload: { error: error?.message ?? "insert_failed" } };
  }

  await supabase.from("payment_intents").insert({
    clinic_id: ctx.clinic.id,
    appointment_id: appointment.id,
    amount: ctx.clinic.signal_amount,
    currency: ctx.clinic.currency,
    provider: yape.provider,
    link: yape.link,
    reference,
    status: "pending",
    expires_at: expiresAt
  });

  await supabase.from("leads").update({ status: "booked", last_message_at: new Date().toISOString() }).eq("id", ctx.lead.id);

  return {
    kind: "booked",
    appointmentId: appointment.id,
    payload: {
      appointment_id: appointment.id,
      payment_link: yape.link,
      payment_reference: reference,
      signal_amount: ctx.clinic.signal_amount,
      expires_at: expiresAt,
      human_friendly: humanFriendly(start.toISOString(), ctx.clinic.timezone),
      grace_minutes: PAYMENT_GRACE_MINUTES
    }
  };
}

async function execCancelAppointment(
  input: { appointment_id: string; reason?: string },
  ctx: ToolContext
): Promise<ExecResult> {
  const supabase = createSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", input.appointment_id)
    .eq("clinic_id", ctx.clinic.id)
    .eq("lead_id", ctx.lead.id)
    .maybeSingle();
  if (!existing) return { kind: "error", payload: { error: "appointment_not_found" } };
  if (existing.status === "completed") return { kind: "error", payload: { error: "already_completed" } };

  await supabase
    .from("appointments")
    .update({ status: "cancelled", notes: input.reason ?? null })
    .eq("id", existing.id);

  await supabase
    .from("payment_intents")
    .update({ status: "cancelled" })
    .eq("appointment_id", existing.id)
    .eq("status", "pending");

  return { kind: "ok", payload: { ok: true, cancelled: existing.id } };
}

function applyPreference(slots: { start: string; end: string }[], prefer: string | undefined, tz: string) {
  if (!prefer || prefer === "soonest") return slots;
  return slots.filter((s) => {
    const hour = wallHourInTz(new Date(s.start), tz);
    if (prefer === "morning") return hour < 12;
    if (prefer === "afternoon") return hour >= 12 && hour < 18;
    if (prefer === "evening") return hour >= 18;
    return true;
  });
}

function wallHourInTz(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false
  }).format(date);
  return parseInt(fmt, 10);
}

function humanFriendly(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat("es-PE", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return fmt.format(new Date(iso));
}
