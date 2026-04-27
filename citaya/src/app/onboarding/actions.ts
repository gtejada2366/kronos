"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/lib/data";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

interface ServiceInput {
  name: string;
  duration_minutes: number;
  price: number;
  description?: string;
}

interface ScheduleDay {
  day: number;
  enabled: boolean;
  start: string; // HH:mm
  end: string; // HH:mm
}

interface OnboardingPayload {
  step: "clinic" | "services" | "schedule" | "integrations" | "finish";
  signal_amount?: number;
  bot_persona?: string;
  bot_extra_instructions?: string;
  services?: ServiceInput[];
  schedule?: ScheduleDay[];
  yape_handle?: string;
  whatsapp_phone_number_id?: string;
  whatsapp_business_account_id?: string;
  whatsapp_access_token?: string;
}

export async function saveOnboardingStep(payload: OnboardingPayload): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();
  const clinicId = ctx.clinic.id;

  if (payload.step === "clinic") {
    const update: Record<string, unknown> = {};
    if (typeof payload.signal_amount === "number" && payload.signal_amount >= 0)
      update.signal_amount = Math.round(payload.signal_amount);
    if (typeof payload.bot_persona === "string") update.bot_persona = payload.bot_persona.trim() || null;
    if (typeof payload.bot_extra_instructions === "string")
      update.bot_extra_instructions = payload.bot_extra_instructions.trim() || null;
    if (Object.keys(update).length > 0) {
      const { error } = await admin.from("clinics").update(update).eq("id", clinicId);
      if (error) return { ok: false, error: error.message };
    }
  }

  if (payload.step === "services" && Array.isArray(payload.services)) {
    const cleaned = payload.services
      .filter((s) => s && s.name && s.duration_minutes > 0)
      .map((s, idx) => ({
        clinic_id: clinicId,
        name: s.name.trim().slice(0, 120),
        description: s.description?.trim() || null,
        duration_minutes: Math.max(5, Math.min(480, Math.round(s.duration_minutes))),
        price: Math.max(0, Number(s.price ?? 0)),
        active: true,
        sort_order: idx
      }));
    if (cleaned.length === 0)
      return { ok: false, error: "Agrega al menos un servicio." };

    await admin.from("services").delete().eq("clinic_id", clinicId);
    const { error } = await admin.from("services").insert(cleaned);
    if (error) return { ok: false, error: error.message };
  }

  if (payload.step === "schedule" && Array.isArray(payload.schedule)) {
    const rows: Array<{
      clinic_id: string;
      day_of_week: number;
      start_minute: number;
      end_minute: number;
    }> = [];
    for (const d of payload.schedule) {
      if (!d.enabled) continue;
      const start = parseTime(d.start);
      const end = parseTime(d.end);
      if (start === null || end === null) continue;
      if (end <= start) continue;
      rows.push({
        clinic_id: clinicId,
        day_of_week: d.day,
        start_minute: start,
        end_minute: end
      });
    }
    if (rows.length === 0) return { ok: false, error: "Marca al menos un día con horario válido." };
    await admin.from("availability_rules").delete().eq("clinic_id", clinicId);
    const { error } = await admin.from("availability_rules").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  if (payload.step === "integrations") {
    const update: Record<string, unknown> = {};
    if (typeof payload.yape_handle === "string") update.yape_handle = payload.yape_handle.trim() || null;
    if (typeof payload.whatsapp_phone_number_id === "string")
      update.whatsapp_phone_number_id = payload.whatsapp_phone_number_id.trim() || null;
    if (typeof payload.whatsapp_business_account_id === "string")
      update.whatsapp_business_account_id = payload.whatsapp_business_account_id.trim() || null;
    if (typeof payload.whatsapp_access_token === "string")
      update.whatsapp_access_token = payload.whatsapp_access_token.trim() || null;
    if (Object.keys(update).length > 0) {
      const { error } = await admin.from("clinics").update(update).eq("id", clinicId);
      if (error) return { ok: false, error: error.message };
    }
  }

  if (payload.step === "finish") {
    const { error } = await admin.from("clinics").update({ onboarded: true }).eq("id", clinicId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/dashboard");
    redirect("/dashboard");
  }

  return { ok: true };
}

function parseTime(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
