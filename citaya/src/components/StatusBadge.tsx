import type { AppointmentStatus, LeadStatus } from "@/lib/types";

const APPT: Record<AppointmentStatus, { label: string; tone: string }> = {
  pending_payment: { label: "Pendiente pago", tone: "border-warn/40 bg-warn/10 text-warn" },
  confirmed: { label: "Confirmada", tone: "border-ok/40 bg-ok/10 text-ok" },
  completed: { label: "Atendida", tone: "border-brand/40 bg-brand-soft text-brand" },
  cancelled: { label: "Cancelada", tone: "border-bg-border bg-bg text-ink-mute" },
  no_show: { label: "No asistió", tone: "border-err/40 bg-err/10 text-err" },
  expired: { label: "Expirada", tone: "border-bg-border bg-bg text-ink-mute" }
};

const LEAD: Record<LeadStatus, { label: string; tone: string }> = {
  new: { label: "Nuevo", tone: "border-brand/40 bg-brand-soft text-brand" },
  in_progress: { label: "En conversación", tone: "border-warn/40 bg-warn/10 text-warn" },
  booked: { label: "Reservó", tone: "border-warn/40 bg-warn/10 text-warn" },
  paid: { label: "Pagó", tone: "border-ok/40 bg-ok/10 text-ok" },
  abandoned: { label: "Abandonó", tone: "border-err/40 bg-err/10 text-err" }
};

export function AppointmentStatusBadge({ value }: { value: AppointmentStatus }) {
  const cfg = APPT[value];
  return <span className={`pill ${cfg.tone}`}>{cfg.label}</span>;
}

export function LeadStatusBadge({ value }: { value: LeadStatus }) {
  const cfg = LEAD[value];
  return <span className={`pill ${cfg.tone}`}>{cfg.label}</span>;
}
