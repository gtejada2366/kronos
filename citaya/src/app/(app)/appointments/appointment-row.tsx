"use client";

import { useState, useTransition } from "react";
import type { AppointmentStatus } from "@/lib/types";
import {
  cancelAppointmentAction,
  markCompletedAction,
  markNoShowAction,
  markPaymentReceivedAction
} from "./actions";

export function AppointmentRow({
  id,
  status,
  paymentLink
}: {
  id: string;
  status: AppointmentStatus;
  paymentLink: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn(id);
      if (!r.ok && r.error) setError(r.error);
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {paymentLink ? (
        <a href={paymentLink} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
          Link Yape
        </a>
      ) : null}
      {status === "pending_payment" ? (
        <button
          onClick={() => run(markPaymentReceivedAction)}
          disabled={pending}
          className="btn-primary text-xs"
        >
          Pago recibido
        </button>
      ) : null}
      {status === "confirmed" ? (
        <>
          <button onClick={() => run(markCompletedAction)} disabled={pending} className="btn-ghost text-xs">
            Atendida
          </button>
          <button onClick={() => run(markNoShowAction)} disabled={pending} className="btn-danger text-xs">
            No asistió
          </button>
        </>
      ) : null}
      {status === "pending_payment" || status === "confirmed" ? (
        <button onClick={() => run(cancelAppointmentAction)} disabled={pending} className="btn-ghost text-xs">
          Cancelar
        </button>
      ) : null}
      {error ? <span className="text-xs text-err">{error}</span> : null}
    </div>
  );
}
