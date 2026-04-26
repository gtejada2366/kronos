"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProjectWithSemaforo, Semaforo } from "@/lib/types";
import { SemaforoBadge } from "@/components/SemaforoBadge";
import { fmtPct, fmtSolesCompact, fmtDate } from "@/lib/format";

type SortKey = "codigo" | "nombre" | "pim" | "devengado" | "pct_devengado" | "avance_fisico" | "estado" | "semaforo";
type SortDir = "asc" | "desc";

const SEMA_ORDER: Record<Semaforo, number> = { rojo: 0, amarillo: 1, verde: 2 };

const ESTADOS: Record<string, string> = {
  EN_EJECUCION: "En ejecución",
  PARALIZADO: "Paralizado",
  CONCLUIDO: "Concluido",
  EN_LIQUIDACION: "En liquidación"
};

export function ProjectsTable({ projects }: { projects: ProjectWithSemaforo[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"todos" | Semaforo>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("semaforo");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    let arr = projects.filter((p) => {
      if (filter !== "todos" && p.semaforo !== filter) return false;
      if (!text) return true;
      return (
        p.nombre.toLowerCase().includes(text) ||
        p.codigo.toLowerCase().includes(text) ||
        (ESTADOS[p.estado] ?? p.estado).toLowerCase().includes(text)
      );
    });
    arr = [...arr].sort((a, b) => {
      const sign = sortDir === "asc" ? 1 : -1;
      if (sortKey === "semaforo") return sign * (SEMA_ORDER[a.semaforo] - SEMA_ORDER[b.semaforo]);
      const va = a[sortKey] as number | string;
      const vb = b[sortKey] as number | string;
      if (typeof va === "number" && typeof vb === "number") return sign * (va - vb);
      return sign * String(va).localeCompare(String(vb), "es");
    });
    return arr;
  }, [projects, q, filter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "pim" || k === "devengado" || k === "pct_devengado" || k === "avance_fisico" ? "desc" : "asc");
    }
  }

  function exportCsv() {
    const headers = [
      "codigo",
      "nombre",
      "estado",
      "pia",
      "pim",
      "devengado",
      "pct_devengado",
      "avance_fisico",
      "fecha_inicio",
      "fecha_fin",
      "semaforo"
    ];
    const rows = filtered.map((p) =>
      [
        p.codigo,
        `"${p.nombre.replace(/"/g, '""')}"`,
        p.estado,
        p.pia,
        p.pim,
        p.devengado,
        p.pct_devengado.toFixed(2),
        p.avance_fisico,
        p.fecha_inicio,
        p.fecha_fin,
        p.semaforo
      ].join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `obrascope-cartera-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-bg-border bg-bg-elev px-3 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, nombre o estado…"
          className="input max-w-xs"
        />
        <div className="flex items-center gap-1 rounded-sm border border-bg-border bg-bg p-0.5">
          {(["todos", "verde", "amarillo", "rojo"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-sm px-2.5 py-1 text-xs capitalize ${
                filter === f ? "bg-bg-panel text-ink" : "text-ink-mute hover:text-ink"
              }`}
            >
              {f === "todos" ? "Todos" : f}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-dim">
          Mostrando <span className="num text-ink">{filtered.length}</span> de{" "}
          <span className="num text-ink">{projects.length}</span>
        </span>
        <button onClick={exportCsv} className="btn-ghost text-xs">
          Exportar CSV
        </button>
      </div>

      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th onClick={() => toggleSort("semaforo")} active={sortKey === "semaforo"} dir={sortDir}>
                Sem.
              </Th>
              <Th onClick={() => toggleSort("codigo")} active={sortKey === "codigo"} dir={sortDir}>
                CUI
              </Th>
              <Th onClick={() => toggleSort("nombre")} active={sortKey === "nombre"} dir={sortDir}>
                Proyecto
              </Th>
              <Th onClick={() => toggleSort("estado")} active={sortKey === "estado"} dir={sortDir}>
                Estado
              </Th>
              <Th onClick={() => toggleSort("pim")} active={sortKey === "pim"} dir={sortDir} align="right">
                PIM
              </Th>
              <Th onClick={() => toggleSort("devengado")} active={sortKey === "devengado"} dir={sortDir} align="right">
                Devengado
              </Th>
              <Th onClick={() => toggleSort("pct_devengado")} active={sortKey === "pct_devengado"} dir={sortDir} align="right">
                % Dev.
              </Th>
              <Th onClick={() => toggleSort("avance_fisico")} active={sortKey === "avance_fisico"} dir={sortDir} align="right">
                Avance físico
              </Th>
              <th className="table-head text-right">Cierre</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-cell py-12 text-center text-ink-dim">
                  Sin proyectos para los filtros aplicados.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-b border-bg-border/60 last:border-0 hover:bg-bg-elev/60">
                  <td className="table-cell">
                    <SemaforoBadge value={p.semaforo} withLabel={false} />
                  </td>
                  <td className="table-cell num text-xs text-ink-mute">{p.codigo}</td>
                  <td className="table-cell">
                    <Link href={`/projects/${p.id}`} className="text-ink hover:text-accent">
                      {p.nombre}
                    </Link>
                  </td>
                  <td className="table-cell text-xs text-ink-mute">{ESTADOS[p.estado] ?? p.estado}</td>
                  <td className="table-cell num text-right">{fmtSolesCompact(p.pim)}</td>
                  <td className="table-cell num text-right">{fmtSolesCompact(p.devengado)}</td>
                  <td className="table-cell num text-right">
                    <PctBar pct={p.pct_devengado} target={p.pct_esperado} />
                  </td>
                  <td className="table-cell num text-right">{fmtPct(p.avance_fisico, 0)}</td>
                  <td className="table-cell text-right text-xs text-ink-mute">{fmtDate(p.fecha_fin)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = "left"
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
}) {
  return (
    <th className={`table-head ${align === "right" ? "text-right" : "text-left"}`}>
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <span className="text-[10px]">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function PctBar({ pct, target }: { pct: number; target: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const targetClamped = Math.max(0, Math.min(100, target));
  const tone =
    pct >= target ? "bg-sema-green" : pct >= target * 0.6 ? "bg-sema-yellow" : "bg-sema-red";
  return (
    <div className="ml-auto flex w-32 items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-bg-elev">
        <div className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${clamped}%` }} />
        <div
          className="absolute inset-y-0 w-px bg-ink/60"
          style={{ left: `${targetClamped}%` }}
          aria-hidden
        />
      </div>
      <span className="num w-12 text-right text-xs">{clamped.toFixed(0)}%</span>
    </div>
  );
}
