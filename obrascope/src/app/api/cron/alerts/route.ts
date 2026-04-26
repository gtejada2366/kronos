import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { enrichProject } from "@/lib/semaforo";
import { sendTelegramMessage } from "@/lib/telegram";
import { fmtPct, fmtSolesCompact } from "@/lib/format";
import type { Entity, Project } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface EntityReport {
  entity: Entity;
  rojos: ReturnType<typeof enrichProject>[];
  totalProyectos: number;
  pim: number;
  devengado: number;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const [{ data: entities, error: entErr }, { data: projects, error: prjErr }] = await Promise.all([
    supabase.from("entities").select("*"),
    supabase.from("projects").select("*")
  ]);
  if (entErr || prjErr) {
    return NextResponse.json({ ok: false, error: entErr?.message ?? prjErr?.message }, { status: 500 });
  }

  const now = new Date();
  const reports: EntityReport[] = [];
  for (const ent of (entities ?? []) as Entity[]) {
    const ofEntity = ((projects ?? []) as Project[])
      .filter((p) => p.entity_id === ent.id)
      .map((p) => enrichProject(p, now));
    const rojos = ofEntity.filter((p) => p.semaforo === "rojo");
    reports.push({
      entity: ent,
      rojos,
      totalProyectos: ofEntity.length,
      pim: ofEntity.reduce((a, p) => a + p.pim, 0),
      devengado: ofEntity.reduce((a, p) => a + p.devengado, 0)
    });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const detail: Array<{ entity: string; status: string; error?: string }> = [];

  for (const report of reports) {
    if (!report.entity.telegram_chat_id) {
      skipped++;
      detail.push({ entity: report.entity.nombre, status: "skipped:no-chat" });
      await persistDigestAlert(supabase, report, "DIGEST_SEMANAL", "Resumen no enviado: chat de Telegram no configurado.");
      continue;
    }
    if (report.rojos.length === 0) {
      const ok = await sendTelegramMessage(
        report.entity.telegram_chat_id,
        buildHealthyMessage(report)
      );
      if (ok.ok) {
        sent++;
        await persistDigestAlert(supabase, report, "DIGEST_SEMANAL", "Sin proyectos en zona crítica esta semana.");
      } else {
        failed++;
        detail.push({ entity: report.entity.nombre, status: "failed", error: ok.error });
      }
      continue;
    }

    const message = buildAlertMessage(report);
    const result = await sendTelegramMessage(report.entity.telegram_chat_id, message);
    if (result.ok) {
      sent++;
      detail.push({ entity: report.entity.nombre, status: "sent" });
      await persistDigestAlert(
        supabase,
        report,
        "DIGEST_SEMANAL",
        `Digest semanal enviado: ${report.rojos.length} proyectos en zona roja.`
      );
      for (const proj of report.rojos) {
        await supabase.from("alerts").insert({
          project_id: proj.id,
          entity_id: report.entity.id,
          tipo: "SEMAFORO_ROJO",
          mensaje: `Devengado ${fmtPct(proj.pct_devengado)} vs meta ${fmtPct(proj.pct_esperado)}.`,
          sent_at: new Date().toISOString()
        });
      }
    } else {
      failed++;
      detail.push({ entity: report.entity.nombre, status: "failed", error: result.error });
    }
  }

  return NextResponse.json({
    ok: true,
    ran_at: now.toISOString(),
    entities: reports.length,
    sent,
    skipped,
    failed,
    detail
  });
}

function buildAlertMessage(r: EntityReport): string {
  const lines: string[] = [];
  lines.push(`*ObraScope · Digest semanal*`);
  lines.push(`_${r.entity.nombre}_`);
  lines.push("");
  lines.push(
    `Cartera: ${r.totalProyectos} proyectos · PIM ${fmtSolesCompact(r.pim)} · Devengado ${fmtSolesCompact(r.devengado)}`
  );
  lines.push("");
  lines.push(`🔴 *${r.rojos.length} proyectos en zona crítica*`);
  for (const p of r.rojos.slice(0, 10)) {
    lines.push(
      `• \`${p.codigo}\` ${truncate(p.nombre, 60)} — ${fmtPct(p.pct_devengado)} dev. (meta ${fmtPct(p.pct_esperado)})`
    );
  }
  if (r.rojos.length > 10) lines.push(`…y ${r.rojos.length - 10} más.`);
  lines.push("");
  lines.push("Ver detalle en https://obrascope.pe/dashboard");
  return lines.join("\n");
}

function buildHealthyMessage(r: EntityReport): string {
  return [
    `*ObraScope · Digest semanal*`,
    `_${r.entity.nombre}_`,
    "",
    `🟢 No hay proyectos en zona crítica esta semana.`,
    `Cartera: ${r.totalProyectos} proyectos · Devengado ${fmtSolesCompact(r.devengado)} de ${fmtSolesCompact(r.pim)}.`
  ].join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function persistDigestAlert(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  report: EntityReport,
  tipo: "DIGEST_SEMANAL",
  mensaje: string
) {
  await supabase.from("alerts").insert({
    project_id: null,
    entity_id: report.entity.id,
    tipo,
    mensaje,
    sent_at: new Date().toISOString()
  });
}
