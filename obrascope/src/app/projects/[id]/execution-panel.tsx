"use client";

import { useMemo, useState } from "react";
import type { Execution } from "@/lib/types";
import { mesNombre } from "@/lib/format";
import { ExecutionChart } from "./execution-chart";

export function ExecutionPanel({ executions, pim }: { executions: Execution[]; pim: number }) {
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const e of executions) set.add(e.anio);
    if (set.size === 0) set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [executions]);

  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());

  const monthly = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const e = executions.find((x) => x.anio === year && x.mes === mes);
      const targetPct = (mes / 12) * 90;
      const targetDevengado = ((e?.pim ?? pim) * targetPct) / 100;
      return {
        mes,
        label: mesNombre(mes),
        devengado: e ? e.devengado : 0,
        meta: Math.round(targetDevengado),
        tieneData: !!e
      };
    });
  }, [executions, year, pim]);

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Ejecución mensual</h2>
        <div className="flex items-center gap-3 text-xs text-ink-mute">
          <div className="flex items-center gap-1 rounded-sm border border-bg-border bg-bg p-0.5">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`num rounded-sm px-2.5 py-1 text-xs ${
                  year === y ? "bg-bg-panel text-ink" : "text-ink-mute hover:text-ink"
                }`}
              >
                {y}
              </button>
            ))}
          </div>
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
  );
}
