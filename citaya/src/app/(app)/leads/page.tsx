import { redirect } from "next/navigation";
import Link from "next/link";
import { LeadStatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { getCurrentContext, getLeads } from "@/lib/data";
import { fmtRelative } from "@/lib/format";

export const metadata = { title: "Leads · Citaya" };

export default async function LeadsPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const leads = await getLeads(ctx.clinic.id, 200);

  return (
    <div>
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bandeja de leads</h1>
          <p className="mt-1 text-sm text-ink-mute">Cada paciente que escribió a tu WhatsApp.</p>
        </div>
      </header>

      <div className="mt-6 panel overflow-hidden">
        {leads.length === 0 ? (
          <EmptyState
            title="Sin leads aún"
            body="Conecta tu WhatsApp Cloud API en Configuración para que el bot empiece a recibir mensajes."
            action={
              <Link href="/settings" className="btn-primary text-xs">
                Ir a Configuración
              </Link>
            }
          />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head">Paciente</th>
                <th className="table-head">Teléfono</th>
                <th className="table-head">Estado</th>
                <th className="table-head text-right">Último mensaje</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-bg-border/60 last:border-0 hover:bg-bg/60">
                  <td className="table-cell">
                    <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-brand">
                      {l.name ?? "Sin nombre"}
                    </Link>
                  </td>
                  <td className="table-cell num text-ink-mute">{l.whatsapp_phone}</td>
                  <td className="table-cell">
                    <LeadStatusBadge value={l.status} />
                  </td>
                  <td className="table-cell text-right text-xs text-ink-dim">{fmtRelative(l.last_message_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
