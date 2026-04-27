import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { fmtDateTime, fmtTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly reminder cron:
 *   - 24h before scheduled_at: confirmation reminder
 *   - 2h before: same-day reminder
 * Idempotent via the `notes` JSON tag we append.
 */
export async function GET(req: NextRequest) {
  const ip = clientKey(req.headers);
  const rl = rateLimit(`cron-reminders:${ip}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  if (!isAuthorizedCron(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supabase = createSupabaseServiceClient();
  const now = new Date();
  const in24Min = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const in24Max = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();
  const in2Min = new Date(now.getTime() + 90 * 60 * 1000).toISOString();
  const in2Max = new Date(now.getTime() + 150 * 60 * 1000).toISOString();

  const [{ data: dayBefore }, { data: hoursBefore }] = await Promise.all([
    supabase
      .from("appointments")
      .select("*, leads!inner(whatsapp_phone), clinics!inner(name, whatsapp_phone_number_id, whatsapp_access_token)")
      .eq("status", "confirmed")
      .gte("scheduled_at", in24Min)
      .lt("scheduled_at", in24Max),
    supabase
      .from("appointments")
      .select("*, leads!inner(whatsapp_phone), clinics!inner(name, whatsapp_phone_number_id, whatsapp_access_token)")
      .eq("status", "confirmed")
      .gte("scheduled_at", in2Min)
      .lt("scheduled_at", in2Max)
  ]);

  let sent24 = 0;
  let sent2 = 0;

  for (const a of dayBefore ?? []) {
    if ((a.notes ?? "").includes("[reminded_24h]")) continue;
    const lead = a.leads as { whatsapp_phone?: string };
    const clinic = a.clinics as { name?: string; whatsapp_phone_number_id?: string; whatsapp_access_token?: string };
    if (!lead?.whatsapp_phone || !clinic?.whatsapp_phone_number_id || !clinic.whatsapp_access_token) continue;
    const r = await sendWhatsAppText(
      { phoneNumberId: clinic.whatsapp_phone_number_id, accessToken: clinic.whatsapp_access_token },
      lead.whatsapp_phone,
      `Recordatorio: tienes cita mañana ${fmtDateTime(a.scheduled_at)} en ${clinic.name}. ¿Confirmas tu asistencia?`
    );
    if (r.ok) {
      sent24++;
      await supabase
        .from("appointments")
        .update({ notes: ((a.notes ?? "") + " [reminded_24h]").trim() })
        .eq("id", a.id);
    }
  }

  for (const a of hoursBefore ?? []) {
    if ((a.notes ?? "").includes("[reminded_2h]")) continue;
    const lead = a.leads as { whatsapp_phone?: string };
    const clinic = a.clinics as { name?: string; whatsapp_phone_number_id?: string; whatsapp_access_token?: string };
    if (!lead?.whatsapp_phone || !clinic?.whatsapp_phone_number_id || !clinic.whatsapp_access_token) continue;
    const r = await sendWhatsAppText(
      { phoneNumberId: clinic.whatsapp_phone_number_id, accessToken: clinic.whatsapp_access_token },
      lead.whatsapp_phone,
      `Recordatorio: tu cita en ${clinic.name} es hoy a las ${fmtTime(a.scheduled_at)}. Te esperamos.`
    );
    if (r.ok) {
      sent2++;
      await supabase
        .from("appointments")
        .update({ notes: ((a.notes ?? "") + " [reminded_2h]").trim() })
        .eq("id", a.id);
    }
  }

  logger.info("cron_reminders_done", { sent_24h: sent24, sent_2h: sent2 });
  return NextResponse.json({ ok: true, ran_at: now.toISOString(), sent_24h: sent24, sent_2h: sent2 });
}
