import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { fmtSoles, fmtDateTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Yape webhook handler. Acepta dos formas:
 *   1. Yape Empresas API real (cuando el merchant tiene contrato): JSON con
 *      reference, status, paid_at, signature.
 *   2. Endpoint manual: PATCH-style notification del owner desde el panel,
 *      con `reference` y header X-Citaya-Secret = CRON_SECRET.
 *
 * En ambos casos buscamos el payment_intent por `reference`, lo marcamos
 * como pagado, confirmamos la cita y notificamos al paciente.
 */
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServiceClient();

  let payload: { reference?: string; status?: string; signature?: string; paid_at?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  await supabase.from("webhook_events").insert({
    source: "yape",
    payload: payload as object,
    external_id: payload.reference ?? null,
    processed: false
  });

  const reference = (payload.reference ?? "").trim();
  if (!reference) return NextResponse.json({ ok: false, error: "missing_reference" }, { status: 400 });

  if (payload.status && payload.status !== "paid" && payload.status !== "PAID")
    return NextResponse.json({ ok: true, ignored: "non_paid_status" });

  const expectedSig = process.env.YAPE_WEBHOOK_SECRET;
  const manualSecret = req.headers.get("x-citaya-secret");
  const ok = (expectedSig && payload.signature === expectedSig) || (manualSecret && manualSecret === process.env.CRON_SECRET);
  if (!ok) {
    logger.warn("yape_webhook_unauthenticated", { reference });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: intent } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("reference", reference)
    .eq("status", "pending")
    .maybeSingle();
  if (!intent) {
    logger.warn("yape_no_intent", { reference });
    return NextResponse.json({ ok: false, error: "intent_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await supabase.from("payment_intents").update({ status: "paid", paid_at: now }).eq("id", intent.id);

  const { data: appointment } = await supabase
    .from("appointments")
    .update({ status: "confirmed", signal_paid_at: now })
    .eq("id", intent.appointment_id)
    .select("*, leads!inner(whatsapp_phone), clinics!inner(name, whatsapp_phone_number_id, whatsapp_access_token)")
    .single();

  if (appointment) {
    await supabase
      .from("leads")
      .update({ status: "paid", last_message_at: now })
      .eq("id", appointment.lead_id);

    const lead = appointment.leads as { whatsapp_phone?: string };
    const clinic = appointment.clinics as { name?: string; whatsapp_phone_number_id?: string; whatsapp_access_token?: string };
    if (lead?.whatsapp_phone && clinic?.whatsapp_phone_number_id && clinic.whatsapp_access_token) {
      await sendWhatsAppText(
        {
          phoneNumberId: clinic.whatsapp_phone_number_id,
          accessToken: clinic.whatsapp_access_token
        },
        lead.whatsapp_phone,
        `✅ Pago confirmado. Te esperamos el ${fmtDateTime(appointment.scheduled_at)} en ${clinic.name}. La señal de ${fmtSoles(Number(appointment.signal_amount))} es descontable del total.`
      );
    }
  }

  return NextResponse.json({ ok: true, appointment_id: intent.appointment_id });
}
