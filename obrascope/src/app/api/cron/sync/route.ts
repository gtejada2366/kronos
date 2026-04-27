import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { fetchMefForEntity, mefIsLive, mockProgress } from "@/lib/mef";
import { logger } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import type { Entity, Project } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT = 6; // calls
const RATE_WINDOW_MS = 60 * 60 * 1000; // per hour per IP

export async function GET(req: NextRequest) {
  const ip = clientKey(req.headers);
  const rl = rateLimit(`cron-sync:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    logger.warn("cron_rate_limited", { route: "sync", ip, resetAt: rl.resetAt });
    return NextResponse.json(
      { ok: false, error: "rate_limited", reset_at: new Date(rl.resetAt).toISOString() },
      { status: 429 }
    );
  }
  if (!isAuthorizedCron(req)) {
    logger.warn("cron_unauthorized", { route: "sync", ip });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const [{ data: projects, error: projErr }, { data: entities, error: entErr }] = await Promise.all([
    supabase.from("projects").select("*"),
    supabase.from("entities").select("*")
  ]);
  if (projErr || entErr) {
    logger.error("cron_sync_query_error", { error: projErr?.message ?? entErr?.message });
    return NextResponse.json({ ok: false, error: projErr?.message ?? entErr?.message }, { status: 500 });
  }

  const now = new Date();
  const mes = now.getUTCMonth() + 1;
  const anio = now.getUTCFullYear();
  const live = mefIsLive();

  const snapshotsByEntity = new Map<string, Map<string, { codigo: string; pim: number; devengado: number; avance_fisico: number }>>();
  if (live) {
    for (const ent of (entities ?? []) as Entity[]) {
      try {
        const snap = await fetchMefForEntity(ent.ubigeo, anio);
        snapshotsByEntity.set(ent.id, snap);
        logger.info("cron_sync_mef_fetched", { entity_id: ent.id, ubigeo: ent.ubigeo, rows: snap.size });
      } catch (err) {
        logger.warn("cron_sync_mef_failed", {
          entity_id: ent.id,
          ubigeo: ent.ubigeo,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  let updated = 0;
  let snapshots = 0;
  let liveHits = 0;
  let mockHits = 0;

  for (const raw of (projects ?? []) as Project[]) {
    if (raw.estado === "CONCLUIDO") continue;

    const liveSnap = snapshotsByEntity.get(raw.entity_id)?.get(raw.codigo);
    let nextPim = raw.pim;
    let nextDev = raw.devengado;
    let nextAvance = raw.avance_fisico;

    if (liveSnap) {
      liveHits++;
      nextPim = liveSnap.pim || raw.pim;
      nextDev = Math.max(raw.devengado, liveSnap.devengado);
      nextAvance = Math.max(raw.avance_fisico, liveSnap.avance_fisico);
    } else {
      const m = mockProgress(raw, now);
      mockHits++;
      nextDev = m.devengado;
      nextAvance = m.avance_fisico;
    }

    if (nextDev === raw.devengado && nextAvance === raw.avance_fisico && nextPim === raw.pim) continue;

    const { error: upErr } = await supabase
      .from("projects")
      .update({
        pim: nextPim,
        devengado: nextDev,
        avance_fisico: nextAvance,
        updated_at: now.toISOString()
      })
      .eq("id", raw.id);
    if (upErr) {
      logger.error("cron_sync_update_failed", { project_id: raw.id, error: upErr.message });
      continue;
    }
    updated++;

    const { error: snapErr } = await supabase.from("executions").upsert(
      {
        project_id: raw.id,
        mes,
        anio,
        devengado: nextDev,
        pim: nextPim
      },
      { onConflict: "project_id,anio,mes" }
    );
    if (!snapErr) snapshots++;
  }

  const result = {
    ok: true,
    ran_at: now.toISOString(),
    mode: live ? "live" : "mock",
    updated,
    snapshots,
    live_hits: liveHits,
    mock_hits: mockHits,
    total: projects?.length ?? 0
  };
  logger.info("cron_sync_done", result);
  return NextResponse.json(result);
}
