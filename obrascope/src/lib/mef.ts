/**
 * Connector hooks for the MEF (Ministerio de Economía y Finanzas) public APIs.
 *
 * Two upstream sources are anticipated:
 *   - Consulta Amigable: monthly PIM / devengado per project (ejecucion del gasto).
 *   - Invierte.pe: catálogo de inversiones with avance físico and estado.
 *
 * The cron `/api/cron/sync` is wired to fall back to a deterministic mock
 * generator when the env-flag MEF_LIVE is not set to "1". Replace the body of
 * the functions below with real HTTP calls when credentials are available.
 */

import type { Project } from "./types";

export interface MefSnapshot {
  codigo: string;
  pim: number;
  devengado: number;
  avance_fisico: number;
}

export async function fetchConsultaAmigable(_ubigeo: string, _anio: number): Promise<MefSnapshot[]> {
  // TODO: real implementation against
  // https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx
  return [];
}

export async function fetchInviertePe(_ubigeo: string): Promise<MefSnapshot[]> {
  // TODO: real implementation against
  // https://ofi5.mef.gob.pe/inviertews/Consultas
  return [];
}

export function mefIsLive(): boolean {
  return process.env.MEF_LIVE === "1";
}

/**
 * Deterministic mock progression: pushes each project's devengado closer to its
 * PIM proportionally to the % of fiscal year elapsed, with a small random walk
 * keyed off the project codigo so re-runs are stable per-day.
 */
export function mockProgress(p: Project, now: Date = new Date()): { devengado: number; avance_fisico: number } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const yearLen = ((now.getUTCFullYear() % 4 === 0 && now.getUTCFullYear() % 100 !== 0) || now.getUTCFullYear() % 400 === 0) ? 366 : 365;
  const pctYear = dayOfYear / yearLen;

  const seed = [...p.codigo].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const drift = ((seed % 17) - 8) / 100; // -0.08 .. +0.08
  const target = Math.max(0, Math.min(1, pctYear * (0.85 + drift)));

  const newDev = Math.min(p.pim, Math.max(p.devengado, Math.round(p.pim * target)));
  const newAvance = Math.min(100, Math.max(p.avance_fisico, Math.round(target * 100)));
  return { devengado: newDev, avance_fisico: newAvance };
}
