import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { mockProgress } from "@/lib/mef";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: projects, error } = await supabase.from("projects").select("*");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const now = new Date();
  const mes = now.getUTCMonth() + 1;
  const anio = now.getUTCFullYear();
  let updated = 0;
  let snapshots = 0;

  for (const raw of (projects ?? []) as Project[]) {
    if (raw.estado === "CONCLUIDO") continue;
    const next = mockProgress(raw, now);
    if (next.devengado === raw.devengado && next.avance_fisico === raw.avance_fisico) continue;

    const { error: upErr } = await supabase
      .from("projects")
      .update({
        devengado: next.devengado,
        avance_fisico: next.avance_fisico,
        updated_at: now.toISOString()
      })
      .eq("id", raw.id);
    if (upErr) continue;
    updated++;

    const { error: snapErr } = await supabase
      .from("executions")
      .upsert(
        {
          project_id: raw.id,
          mes,
          anio,
          devengado: next.devengado,
          pim: raw.pim
        },
        { onConflict: "project_id,anio,mes" }
      );
    if (!snapErr) snapshots++;
  }

  return NextResponse.json({
    ok: true,
    ran_at: now.toISOString(),
    updated,
    snapshots,
    total: projects?.length ?? 0
  });
}
