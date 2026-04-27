"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/data";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { fmtDateTime, fmtSoles } from "@/lib/format";
import { logger } from "@/lib/logger";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function markPaymentReceivedAction(appointmentId: string): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();

  const { data: appt } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinic.id)
    .maybeSingle();
  if (!appt) return { ok: false, error: "Cita no encontrada." };
  if (appt.status === "cancelled" || appt.status === "expired")
    return { ok: false, error: "La cita está cancelada o expirada." };

  const now = new Date().toISOString();
  const { error: aErr } = await admin
    .from("appointments")
    .update({ status: "confirmed", signal_paid_at: now })
    .eq("id", appointmentId);
  if (aErr) return { ok: false, error: aErr.message };

  await admin
    .from("payment_intents")
    .update({ status: "paid", paid_at: now })
    .eq("appointment_id", appointmentId)
    .eq("status", "pending");

  await admin
    .from("leads")
    .update({ status: "paid", last_message_at: now })
    .eq("id", appt.lead_id);

  // Notify the patient via WhatsApp
  try {
    const { data: lead } = await admin.from("leads").select("whatsapp_phone").eq("id", appt.lead_id).single();
    if (lead && ctx.clinic.whatsapp_phone_number_id && ctx.clinic.whatsapp_access_token) {
      await sendWhatsAppText(
        {
          phoneNumberId: ctx.clinic.whatsapp_phone_number_id,
          accessToken: ctx.clinic.whatsapp_access_token
        },
        lead.whatsapp_phone,
        `✅ Pago confirmado. Te esperamos el ${fmtDateTime(appt.scheduled_at)} en ${ctx.clinic.name}. La señal de ${fmtSoles(Number(appt.signal_amount))} es descontable del total.`
      );
    }
  } catch (err) {
    logger.warn("manual_confirm_whatsapp_failed", {
      appointment_id: appointmentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  return { ok: true, message: "Pago marcado como recibido." };
}

export async function markNoShowAction(appointmentId: string): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();
  const { error } = await admin
    .from("appointments")
    .update({ status: "no_show" })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinic.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appointments");
  return { ok: true };
}

export async function markCompletedAction(appointmentId: string): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();
  const { error } = await admin
    .from("appointments")
    .update({ status: "completed" })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinic.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appointments");
  return { ok: true };
}

export async function cancelAppointmentAction(appointmentId: string): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();
  const { error } = await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinic.id);
  if (error) return { ok: false, error: error.message };
  await admin
    .from("payment_intents")
    .update({ status: "cancelled" })
    .eq("appointment_id", appointmentId)
    .eq("status", "pending");
  revalidatePath("/appointments");
  return { ok: true };
}
