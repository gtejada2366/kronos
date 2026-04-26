import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { KpiCard } from "@/components/KpiCard";
import { ProjectsTable } from "./projects-table";
import { getCurrentContext, getProjectsForEntity } from "@/lib/data";
import { fmtPct, fmtSolesCompact } from "@/lib/format";
import { pctAnioTranscurrido, pctEsperado } from "@/lib/semaforo";

export const metadata = { title: "Cartera · ObraScope" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const projects = await getProjectsForEntity(ctx.entity.id);

  const totalPim = projects.reduce((a, p) => a + p.pim, 0);
  const totalDev = projects.reduce((a, p) => a + p.devengado, 0);
  const totalPia = projects.reduce((a, p) => a + p.pia, 0);
  const avgExec = projects.length > 0 ? projects.reduce((a, p) => a + p.pct_devengado, 0) / projects.length : 0;
  const verdes = projects.filter((p) => p.semaforo === "verde").length;
  const amarillos = projects.filter((p) => p.semaforo === "amarillo").length;
  const rojos = projects.filter((p) => p.semaforo === "rojo").length;
  const pctYear = pctAnioTranscurrido();
  const pctEsp = pctEsperado();

  return (
    <div className="min-h-screen">
      <Topbar entity={ctx.entity} email={ctx.user.email} />

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Cartera de obras</h1>
            <p className="mt-1 text-sm text-ink-mute">
              Año fiscal {new Date().getFullYear()} · {fmtPct(pctYear)} transcurrido · meta esperada{" "}
              {fmtPct(pctEsp)}
            </p>
          </div>
          <div className="hidden gap-2 md:flex">
            <SemaforoStat color="green" count={verdes} label="En meta" />
            <SemaforoStat color="yellow" count={amarillos} label="Riesgo" />
            <SemaforoStat color="red" count={rojos} label="Crítico" />
          </div>
        </div>

        <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Proyectos" value={String(projects.length)} hint={`PIA ${fmtSolesCompact(totalPia)}`} />
          <KpiCard label="PIM total" value={fmtSolesCompact(totalPim)} hint="Presupuesto modificado" />
          <KpiCard
            label="Devengado"
            value={fmtSolesCompact(totalDev)}
            hint={totalPim > 0 ? `${fmtPct((totalDev / totalPim) * 100)} del PIM` : ""}
            tone="accent"
          />
          <KpiCard
            label="Avance promedio"
            value={fmtPct(avgExec)}
            hint={`vs meta ${fmtPct(pctEsp)}`}
            tone={avgExec >= pctEsp ? "green" : avgExec >= pctEsp * 0.6 ? "yellow" : "red"}
          />
        </section>

        <section className="mt-6">
          <ProjectsTable projects={projects} />
        </section>
      </main>
    </div>
  );
}

function SemaforoStat({ color, count, label }: { color: "green" | "yellow" | "red"; count: number; label: string }) {
  const dot = color === "green" ? "#10B981" : color === "yellow" ? "#EAB308" : "#EF4444";
  return (
    <div className="flex items-center gap-2 rounded-sm border border-bg-border bg-bg-panel px-3 py-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
      <span className="num text-sm font-semibold">{count}</span>
      <span className="text-xs text-ink-mute">{label}</span>
    </div>
  );
}
