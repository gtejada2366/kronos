import { redirect } from "next/navigation";
import Link from "next/link";
import { KpiCard } from "@/components/KpiCard";
import { AppointmentStatusBadge, LeadStatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import {
  getAppointments,
  getCurrentContext,
  getDashboardMetrics,
  getLeads
} from "@/lib/data";
import { fmtDate, fmtDateTime, fmtRelative, fmtSoles, fmtPct } from "@/lib/format";

export const metadata = { title: "Panel · Citaya" };

export default async function DashboardPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [metrics, leads, appointments] = await Promise.all([
    getDashboardMetrics(ctx.clinic.id, since),
    getLeads(ctx.clinic.id, 8),
    getAppointments(ctx.clinic.id, 8)
  ]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Hola, {ctx.profile.full_name?.split(" ")[0] ?? ctx.clinic.name}</h1>
          <p className="mt-1 text-sm text-ink-mute">Resumen de los últimos 30 días.</p>
        </div>
        <Link href="/leads" className="btn-ghost text-xs">Ver bandeja completa →</Link>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Leads recibidos" value={String(metrics.totalLeads)} hint={`${metrics.newLeads} sin contestar`} />
        <KpiCard
          label="Conversión"
          value={fmtPct(metrics.conversionRate, 0)}
          hint={`${metrics.bookedAppointments} citas reservadas`}
          tone="brand"
        />
        <KpiCard
          label="Citas pagadas"
          value={String(metrics.paidAppointments)}
          hint={`${metrics.pendingPayment} pendientes de pago`}
          tone="ok"
        />
        <KpiCard
          label="Revenue rescatado"
          value={fmtSoles(metrics.revenueRescued)}
          hint={`${metrics.upcomingToday} citas hoy`}
          tone="brand"
        />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <header className="flex items-center justify-between border-b border-bg-border px-4 py-3">
            <h2 className="text-sm font-semibold">Últimos leads</h2>
            <Link href="/leads" className="text-xs text-brand hover:underline">
              ver todos
            </Link>
          </header>
          {leads.length === 0 ? (
            <EmptyState
              title="Aún no hay leads"
              body="Cuando un paciente escriba a tu WhatsApp conectado a Citaya, lo verás acá."
            />
          ) : (
            <ul className="divide-y divide-bg-border">
              {leads.map((l) => (
                <li key={l.id} className="flex items-center justify-between px-4 py-3 hover:bg-bg/60">
                  <Link href={`/leads/${l.id}`} className="flex flex-1 items-center gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{l.name ?? "Sin nombre"}</p>
                      <p className="num text-xs text-ink-dim">{l.whatsapp_phone}</p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-3">
                    <LeadStatusBadge value={l.status} />
                    <span className="text-xs text-ink-dim">{fmtRelative(l.last_message_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <header className="flex items-center justify-between border-b border-bg-border px-4 py-3">
            <h2 className="text-sm font-semibold">Próximas citas</h2>
            <Link href="/appointments" className="text-xs text-brand hover:underline">
              ver todas
            </Link>
          </header>
          {appointments.length === 0 ? (
            <EmptyState
              title="Sin citas todavía"
              body="Las citas que tu bot agende aparecerán aquí."
            />
          ) : (
            <ul className="divide-y divide-bg-border">
              {appointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-bg/60">
                  <div>
                    <p className="text-sm font-medium text-ink">{fmtDateTime(a.scheduled_at)}</p>
                    <p className="text-xs text-ink-dim">{fmtSoles(Number(a.total_price))} · señal {fmtSoles(Number(a.signal_amount))}</p>
                  </div>
                  <AppointmentStatusBadge value={a.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6 panel p-5">
        <h2 className="text-sm font-semibold">Periodo evaluado</h2>
        <p className="mt-1 text-xs text-ink-dim">
          Desde {fmtDate(since)} hasta hoy. Los KPIs se actualizan cada vez que entras al panel.
        </p>
      </section>
    </div>
  );
}
