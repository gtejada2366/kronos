import type { Semaforo } from "@/lib/types";
import { semaforoLabel } from "@/lib/semaforo";

const STYLES: Record<Semaforo, string> = {
  verde: "bg-sema-green/15 text-sema-green border-sema-green/40",
  amarillo: "bg-sema-yellow/15 text-sema-yellow border-sema-yellow/40",
  rojo: "bg-sema-red/15 text-sema-red border-sema-red/40"
};

export function SemaforoBadge({ value, withLabel = true }: { value: Semaforo; withLabel?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium ${STYLES[value]}`}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: value === "verde" ? "#10B981" : value === "amarillo" ? "#EAB308" : "#EF4444" }}
      />
      {withLabel ? semaforoLabel(value) : null}
    </span>
  );
}
