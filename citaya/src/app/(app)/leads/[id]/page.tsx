import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AppointmentStatusBadge, LeadStatusBadge } from "@/components/StatusBadge";
import {
  getAppointmentsByLead,
  getCurrentContext,
  getLead,
  getMessagesForLead
} from "@/lib/data";
import { fmtDate, fmtDateTime, fmtRelative, fmtSoles, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const lead = await getLead(params.id);
  if (!lead || lead.clinic_id !== ctx.clinic.id) notFound();

  const [messages, appointments] = await Promise.all([
    getMessagesForLead(lead.id),
    getAppointmentsByLead(lead.id)
  ]);

  return (
    <div>
      <nav className="text-xs text-ink-mute">
        <Link href="/leads" className="hover:text-brand">← Bandeja de leads</Link>
      </nav>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{lead.name ?? "Sin nombre"}</h1>
          <p className="mt-1 num text-sm text-ink-mute">{lead.whatsapp_phone}</p>
          <p className="mt-1 text-xs text-ink-dim">
            Primer contacto {fmtDate(lead.first_seen_at)} · último mensaje {fmtRelative(lead.last_message_at)}
          </p>
        </div>
        <LeadStatusBadge value={lead.status} />
      </header>

      <section className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="panel">
          <header className="border-b border-bg-border px-4 py-3">
            <h2 className="text-sm font-semibold">Conversación</h2>
          </header>
          <div className="max-h-[640px] overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="text-sm text-ink-dim">Sin mensajes aún.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {messages.map((m) => {
                  const inbound = m.direction === "inbound";
                  return (
                    <li
                      key={m.id}
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                        inbound
                          ? "self-end rounded-br-sm border border-bg-border bg-bg-elev text-ink-mute"
                          : "self-start rounded-bl-sm bg-brand-soft text-ink"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider opacity-60">
                        {inbound ? lead.name ?? "paciente" : m.role} · {fmtTime(m.created_at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="panel">
          <header className="border-b border-bg-border px-4 py-3">
            <h2 className="text-sm font-semibold">Citas asociadas</h2>
          </header>
          {appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-dim">Aún no agendó.</p>
          ) : (
            <ul className="divide-y divide-bg-border">
              {appointments.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{fmtDateTime(a.scheduled_at)}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-ink-mute">
                    <span>
                      {fmtSoles(Number(a.total_price))} · señal {fmtSoles(Number(a.signal_amount))}
                    </span>
                    <AppointmentStatusBadge value={a.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
