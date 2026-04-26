import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { SemaforoBadge } from "@/components/SemaforoBadge";
import { KpiCard } from "@/components/KpiCard";
import { ExecutionChart } from "./execution-chart";
import { getAlertsForProject, getCurrentContext, getExecutions, getProject } from "@/lib/data";
import { fmtDate, fmtPct, fmtSoles, fmtSolesCompact } from "@/lib/format";
import { mesNombre } from "@/lib/format";

export const dynamic = "force-dynamic";

const ESTADOS: Record<string, string> = {
  EN_EJECUCION: "En ejecución",
  PARALIZADO: "Paralizado",
  CONCLUIDO: "Concluido",
  EN_LIQUIDACION: "En liquidación"
};

const ALERTAS: Record<string, string> = {
  SEMAFORO_ROJO: "Semáforo rojo",
  DEVENGADO_BAJO: "Devengado bajo",
  PARALIZADO: "Paralizado",
  DIGEST_SEMANAL: "Digest semanal"
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const project = await getProject(params.id);
  if (!project || project.entity_id !== ctx.entity.id) notFound();

  const [executions, alerts] = await Promise.all([
    getExecutions(project.id),
    getAlertsForProject(project.id)
  ]);

  const anioActual = new Date().getFullYear();
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const e = executions.find((x) => x.anio === anioActual && x.mes === mes);
    const targetPct = (mes / 12) * 90;
    const targetDevengado = (project.pim * targetPct) / 100;
    return {
      mes,
      label: mesNombre(mes),
      devengado: e ? e.devengado : 0,
      meta: Math.round(targetDevengado),
      tieneData: !!e
    };
  });

  return (
    <div className="min-h-screen">
      <Topbar entity={ctx.entity} email={ctx.user.email} />

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <nav className="mb-4 text-xs text-ink-mute">
          <Link href="/dashboard" className="hover:text-accent">
            ← Cartera
          </Link>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-ink-dim">
              CUI {project.codigo} · {ESTADOS[project.estado] ?? project.estado}
            </p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight">{project.nombre}</h1>
            <p className="mt-1 text-sm text-ink-mute">
              Inicio {fmtDate(project.fecha_inicio)} · Cierre programado {fmtDate(project.fecha_fin)}
            </p>
          </div>
          <SemaforoBadge value={project.semaforo} />
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="PIA" value={fmtSolesCompact(project.pia)} hint="Apertura" />
          <KpiCard label="PIM" value={fmtSolesCompact(project.pim)} hint="Modificado" />
          <KpiCard
            label="Devengado"
            value={fmtSolesCompact(project.devengado)}
            hint={fmtPct(project.pct_devengado)}
            tone="accent"
          />
          <KpiCard
            label="Avance físico"
            value={fmtPct(project.avance_fisico, 0)}
            hint={`Meta esperada ${fmtPct(project.pct_esperado)}`}
            tone={project.semaforo === "verde" ? "green" : project.semaforo === "amarillo" ? "yellow" : "red"}
          />
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Ejecución mensual {anioActual}</h2>
              <div className="flex items-center gap-3 text-xs text-ink-mute">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-accent" /> Devengado
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-px w-3 bg-ink-mute" /> Meta
                </span>
              </div>
            </div>
            <div className="mt-3 h-72">
              <ExecutionChart data={monthly} />
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-semibold">Resumen contractual</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Entidad" v={ctx.entity.nombre} />
              <Row k="UBIGEO" v={ctx.entity.ubigeo} mono />
              <Row k="PIA" v={fmtSoles(project.pia)} mono />
              <Row k="PIM" v={fmtSoles(project.pim)} mono />
              <Row k="Devengado" v={fmtSoles(project.devengado)} mono />
              <Row k="Saldo por ejecutar" v={fmtSoles(Math.max(0, project.pim - project.devengado))} mono />
              <Row k="% año transcurrido" v={fmtPct(project.pct_anio_transcurrido)} mono />
              <Row k="% meta esperada" v={fmtPct(project.pct_esperado)} mono />
            </dl>
          </div>
        </section>

        <section className="mt-6 panel p-4">
          <h2 className="text-sm font-semibold">Historial de alertas</h2>
          {alerts.length === 0 ? (
            <p className="mt-3 text-sm text-ink-dim">Sin alertas registradas para este proyecto.</p>
          ) : (
            <ul className="mt-3 divide-y divide-bg-border">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-sm">
                      <span className="rounded-sm border border-bg-border bg-bg-elev px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-mute">
                        {ALERTAS[a.tipo] ?? a.tipo}
                      </span>{" "}
                      <span className="ml-2 text-ink">{a.mensaje}</span>
                    </p>
                  </div>
                  <span className="num shrink-0 text-xs text-ink-dim">{fmtDate(a.sent_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs uppercase tracking-wider text-ink-dim">{k}</dt>
      <dd className={`text-sm text-ink ${mono ? "num" : ""}`}>{v}</dd>
    </div>
  );
}
