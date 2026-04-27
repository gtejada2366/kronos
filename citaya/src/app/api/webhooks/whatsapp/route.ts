import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { parseInboundWebhook, sendWhatsAppText } from "@/lib/whatsapp/client";
import { runBotTurn } from "@/lib/anthropic/bot";
import { fmtSoles } from "@/lib/format";
import type { Clinic, Conversation, Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Webhook verification handshake from Meta. Cloud API calls this once
 * with hub.challenge when you set the webhook URL in the developer console.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  logger.warn("whatsapp_verify_failed", { mode, hasToken: !!token, hasChallenge: !!challenge });
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * POST — inbound message dispatcher. Persists the raw payload, parses it,
 * resolves the clinic, and runs the bot turn.
 */
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServiceClient();
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  await supabase.from("webhook_events").insert({
    source: "whatsapp",
    payload: payload as object,
    processed: false
  });

  const inbound = parseInboundWebhook(payload);
  if (!inbound) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data: clinicRow } = await supabase
    .from("clinics")
    .select("*")
    .eq("whatsapp_phone_number_id", inbound.phoneNumberId)
    .maybeSingle<Clinic>();

  if (!clinicRow) {
    logger.warn("whatsapp_no_clinic", { phoneNumberId: inbound.phoneNumberId });
    return NextResponse.json({ ok: true, ignored: true, reason: "no_clinic" });
  }

  const { lead, conversation } = await ensureLeadAndConversation(supabase, clinicRow, inbound);

  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    clinic_id: clinicRow.id,
    direction: "inbound",
    role: "patient",
    content: inbound.text ?? "",
    whatsapp_message_id: inbound.whatsappMessageId
  });

  if (!inbound.text || inbound.text.trim().length === 0) {
    return NextResponse.json({ ok: true, ignored: "empty_text" });
  }

  let botResult;
  try {
    botResult = await runBotTurn({
      clinic: clinicRow,
      lead,
      conversation,
      inboundText: inbound.text
    });
  } catch (err) {
    logger.error("bot_turn_failed", {
      clinic_id: clinicRow.id,
      lead_id: lead.id,
      error: err instanceof Error ? err.message : String(err)
    });
    botResult = {
      reply:
        "Disculpa, tuvimos un inconveniente. Un asesor humano te responderá en breve.",
      needsHandoff: true,
      handoffReason: "exception"
    };
  }

  if (botResult.reply) {
    await supabase.from("messages").insert({
      conversation_id: conversation.id,
      clinic_id: clinicRow.id,
      direction: "outbound",
      role: botResult.needsHandoff ? "system" : "bot",
      content: botResult.reply
    });

    if (clinicRow.whatsapp_phone_number_id && clinicRow.whatsapp_access_token) {
      const send = await sendWhatsAppText(
        {
          phoneNumberId: clinicRow.whatsapp_phone_number_id,
          accessToken: clinicRow.whatsapp_access_token
        },
        inbound.fromPhone,
        botResult.reply
      );
      if (!send.ok) {
        logger.warn("whatsapp_outbound_failed", {
          clinic_id: clinicRow.id,
          error: send.error
        });
      }
    }

    // Si el bot agendó, mandamos un segundo mensaje con el link de pago para
    // separar el contexto y que el paciente vea el link claramente.
    if (botResult.bookedAppointmentId) {
      const { data: appt } = await supabase
        .from("appointments")
        .select("payment_link, signal_amount, scheduled_at")
        .eq("id", botResult.bookedAppointmentId)
        .single();
      if (appt?.payment_link && clinicRow.whatsapp_phone_number_id && clinicRow.whatsapp_access_token) {
        const followup = `Aquí va el link para pagar la señal de ${fmtSoles(Number(appt.signal_amount))}:\n${appt.payment_link}\n\nTu slot queda reservado por 30 minutos.`;
        await sendWhatsAppText(
          {
            phoneNumberId: clinicRow.whatsapp_phone_number_id,
            accessToken: clinicRow.whatsapp_access_token
          },
          inbound.fromPhone,
          followup
        );
        await supabase.from("messages").insert({
          conversation_id: conversation.id,
          clinic_id: clinicRow.id,
          direction: "outbound",
          role: "bot",
          content: followup
        });
      }
    }
  }

  await supabase
    .from("leads")
    .update({
      last_message_at: new Date().toISOString(),
      status:
        lead.status === "new" || lead.status === "abandoned"
          ? "in_progress"
          : lead.status
    })
    .eq("id", lead.id);

  return NextResponse.json({ ok: true });
}

async function ensureLeadAndConversation(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  clinic: Clinic,
  inbound: { fromPhone: string; contactName: string | null; receivedAt: Date }
): Promise<{ lead: Lead; conversation: Conversation }> {
  const phone = inbound.fromPhone;

  const { data: existing } = await supabase
    .from("leads")
    .select("*")
    .eq("clinic_id", clinic.id)
    .eq("whatsapp_phone", phone)
    .maybeSingle<Lead>();

  let lead = existing;
  if (!lead) {
    const { data: created } = await supabase
      .from("leads")
      .insert({
        clinic_id: clinic.id,
        whatsapp_phone: phone,
        name: inbound.contactName,
        status: "new"
      })
      .select("*")
      .single<Lead>();
    if (!created) throw new Error("lead_create_failed");
    lead = created;
  } else if (!lead.name && inbound.contactName) {
    await supabase.from("leads").update({ name: inbound.contactName }).eq("id", lead.id);
    lead.name = inbound.contactName;
  }

  const { data: openConv } = await supabase
    .from("conversations")
    .select("*")
    .eq("lead_id", lead.id)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<Conversation>();

  if (openConv) return { lead, conversation: openConv };

  const { data: newConv } = await supabase
    .from("conversations")
    .insert({ clinic_id: clinic.id, lead_id: lead.id, status: "active" })
    .select("*")
    .single<Conversation>();
  if (!newConv) throw new Error("conversation_create_failed");

  return { lead, conversation: newConv };
}
