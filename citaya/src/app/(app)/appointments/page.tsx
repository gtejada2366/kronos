import { redirect } from "next/navigation";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { getAppointments, getCurrentContext, getServices } from "@/lib/data";
import { fmtDateTime, fmtSoles } from "@/lib/format";
import { AppointmentRow } from "./appointment-row";

export const metadata = { title: "Citas · Citaya" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const [appointments, services] = await Promise.all([
    getAppointments(ctx.clinic.id, 200),
    getServices(ctx.clinic.id)
  ]);
  const serviceById = new Map(services.map((s) => [s.id, s]));

  return (
    <div>
      <header>
        <h1 className="text-2xl font-semibold">Citas</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Aquí ves cada cita reservada. Confirma manualmente cuando recibas el pago Yape (si no
          tienes integración API), márcalas como completadas tras la atención.
        </p>
      </header>

      <div className="mt-6 panel overflow-hidden">
        {appointments.length === 0 ? (
          <EmptyState title="Sin citas" body="El bot aún no ha agendado citas. Pídele a un paciente que te escriba para probar." />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head">Fecha y hora</th>
                <th className="table-head">Servicio</th>
                <th className="table-head text-right">Total</th>
                <th className="table-head text-right">Señal</th>
                <th className="table-head">Estado</th>
                <th className="table-head text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id} className="border-b border-bg-border/60 last:border-0 hover:bg-bg/60">
                  <td className="table-cell num">{fmtDateTime(a.scheduled_at)}</td>
                  <td className="table-cell">{a.service_id ? serviceById.get(a.service_id)?.name ?? "—" : "—"}</td>
                  <td className="table-cell num text-right">{fmtSoles(Number(a.total_price))}</td>
                  <td className="table-cell num text-right">{fmtSoles(Number(a.signal_amount))}</td>
                  <td className="table-cell">
                    <AppointmentStatusBadge value={a.status} />
                  </td>
                  <td className="table-cell text-right">
                    <AppointmentRow id={a.id} status={a.status} paymentLink={a.payment_link} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
