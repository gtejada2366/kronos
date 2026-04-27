"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProjectEstado, ProjectWithSemaforo, Semaforo } from "@/lib/types";
import { SemaforoBadge } from "@/components/SemaforoBadge";
import { fmtPct, fmtSolesCompact, fmtDate } from "@/lib/format";

type SortKey = "codigo" | "nombre" | "pim" | "devengado" | "pct_devengado" | "avance_fisico" | "estado" | "semaforo";
type SortDir = "asc" | "desc";

const SEMA_ORDER: Record<Semaforo, number> = { rojo: 0, amarillo: 1, verde: 2 };

const ESTADOS: Record<ProjectEstado, string> = {
  EN_EJECUCION: "En ejecución",
  PARALIZADO: "Paralizado",
  CONCLUIDO: "Concluido",
  EN_LIQUIDACION: "En liquidación"
};

const ESTADO_OPTIONS: Array<{ value: "" | ProjectEstado; label: string }> = [
  { value: "", label: "Todos los estados" },
  { value: "EN_EJECUCION", label: ESTADOS.EN_EJECUCION },
  { value: "PARALIZADO", label: ESTADOS.PARALIZADO },
  { value: "CONCLUIDO", label: ESTADOS.CONCLUIDO },
  { value: "EN_LIQUIDACION", label: ESTADOS.EN_LIQUIDACION }
];

export function ProjectsTable({ projects }: { projects: ProjectWithSemaforo[] }) {
  const [q, setQ] = useState("");
  const [filterSema, setFilterSema] = useState<"todos" | Semaforo>("todos");
  const [filterEstado, setFilterEstado] = useState<"" | ProjectEstado>("");
  const [minPim, setMinPim] = useState<string>("");
  const [closesBy, setClosesBy] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("semaforo");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const minPimNum = minPim ? Number(minPim) * 1_000_000 : 0;
    const closesByDate = closesBy ? new Date(closesBy + "T00:00:00") : null;

    let arr = projects.filter((p) => {
      if (filterSema !== "todos" && p.semaforo !== filterSema) return false;
      if (filterEstado && p.estado !== filterEstado) return false;
      if (minPimNum > 0 && p.pim < minPimNum) return false;
      if (closesByDate && new Date(p.fecha_fin) > closesByDate) return false;
      if (!text) return true;
      return (
        p.nombre.toLowerCase().includes(text) ||
        p.codigo.toLowerCase().includes(text) ||
        ESTADOS[p.estado].toLowerCase().includes(text)
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
  }, [projects, q, filterSema, filterEstado, minPim, closesBy, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(pageStart, pageStart + pageSize);

  function toggleSort(k: SortKey) {
    setPage(1);
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "pim" || k === "devengado" || k === "pct_devengado" || k === "avance_fisico" ? "desc" : "asc");
    }
  }

  function clearFilters() {
    setQ("");
    setFilterSema("todos");
    setFilterEstado("");
    setMinPim("");
    setClosesBy("");
    setPage(1);
  }

  function onFilterChange<T>(setter: (v: T) => void): (v: T) => void {
    return (v) => {
      setter(v);
      setPage(1);
    };
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

  const filtersActive =
    q !== "" || filterSema !== "todos" || filterEstado !== "" || minPim !== "" || closesBy !== "";

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-bg-border bg-bg-elev px-3 py-2">
        <input
          value={q}
          onChange={(e) => onFilterChange(setQ)(e.target.value)}
          placeholder="Buscar por código, nombre o estado…"
          className="input max-w-xs"
        />
        <div className="flex items-center gap-1 rounded-sm border border-bg-border bg-bg p-0.5">
          {(["todos", "verde", "amarillo", "rojo"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(setFilterSema)(f)}
              className={`rounded-sm px-2.5 py-1 text-xs capitalize ${
                filterSema === f ? "bg-bg-panel text-ink" : "text-ink-mute hover:text-ink"
              }`}
            >
              {f === "todos" ? "Todos" : f}
            </button>
          ))}
        </div>
        <select
          value={filterEstado}
          onChange={(e) => onFilterChange(setFilterEstado)(e.target.value as "" | ProjectEstado)}
          className="input max-w-[180px] text-xs"
        >
          {ESTADO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-mute">
          PIM ≥
          <input
            type="number"
            value={minPim}
            onChange={(e) => onFilterChange(setMinPim)(e.target.value)}
            min={0}
            step={0.5}
            className="input w-24"
            placeholder="0"
          />
          <span className="num text-[10px] text-ink-dim">M S/.</span>
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-mute">
          Cierre ≤
          <input
            type="date"
            value={closesBy}
            onChange={(e) => onFilterChange(setClosesBy)(e.target.value)}
            className="input w-36"
          />
        </label>
        {filtersActive ? (
          <button onClick={clearFilters} className="btn-ghost text-xs">
            Limpiar
          </button>
        ) : null}
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
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-cell py-12 text-center text-ink-dim">
                  Sin proyectos para los filtros aplicados.
                </td>
              </tr>
            ) : (
              pageRows.map((p) => (
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
                  <td className="table-cell text-xs text-ink-mute">{ESTADOS[p.estado]}</td>
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bg-border bg-bg-elev px-3 py-2 text-xs text-ink-mute">
        <label className="flex items-center gap-2">
          <span>Filas</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="input w-20 text-xs"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            ←
          </button>
          <span className="num">
            {safePage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            →
          </button>
        </div>
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
