import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cleanup runs every 5 minutes:
 *   - Marks payment_intents as expired when expires_at < now and still pending.
 *   - Releases the slot by setting the appointment to 'expired'.
 *   - Marks idle leads (no msg in 24h, status 'in_progress') as 'abandoned'.
 */
export async function GET(req: NextRequest) {
  const ip = clientKey(req.headers);
  const rl = rateLimit(`cron-cleanup:${ip}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  if (!isAuthorizedCron(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supabase = createSupabaseServiceClient();
  const now = new Date();

  const { data: expired } = await supabase
    .from("payment_intents")
    .select("id, appointment_id")
    .eq("status", "pending")
    .lt("expires_at", now.toISOString())
    .limit(100);

  let intentsExpired = 0;
  let appointmentsExpired = 0;

  for (const intent of expired ?? []) {
    await supabase.from("payment_intents").update({ status: "expired" }).eq("id", intent.id);
    intentsExpired++;
    if (intent.appointment_id) {
      await supabase
        .from("appointments")
        .update({ status: "expired" })
        .eq("id", intent.appointment_id)
        .eq("status", "pending_payment");
      appointmentsExpired++;
    }
  }

  const idleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: abandonedRows } = await supabase
    .from("leads")
    .update({ status: "abandoned" })
    .eq("status", "in_progress")
    .lt("last_message_at", idleCutoff)
    .select("id");
  const leadsAbandoned = abandonedRows?.length ?? 0;

  logger.info("cron_cleanup_done", {
    intents_expired: intentsExpired,
    appointments_expired: appointmentsExpired,
    leads_abandoned: leadsAbandoned
  });

  return NextResponse.json({
    ok: true,
    ran_at: now.toISOString(),
    intents_expired: intentsExpired,
    appointments_expired: appointmentsExpired,
    leads_abandoned: leadsAbandoned
  });
}
