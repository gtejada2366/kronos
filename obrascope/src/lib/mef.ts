/**
 * Connector for the MEF (Ministerio de Economía y Finanzas) public sources.
 *
 *   - Consulta Amigable (transparencia económica) → monthly PIM/devengado per
 *     project (proyecto = inversión SNIP/CUI), grouped by ubigeo.
 *   - Invierte.pe → catálogo de inversiones with avance físico and estado.
 *
 * Both are public and do not require authentication. They are, however, ASP.NET
 * WebForms apps that respond with view-state-bound HTML; the canonical machine
 * readable export comes from the open-data portal at datosabiertos.gob.pe and
 * the SIAF transparency JSON endpoints.
 *
 * To avoid coupling the cron path to upstream availability, this module:
 *   1. Tries the configured MEF endpoint when MEF_LIVE=1 is set.
 *   2. Returns [] if the upstream is unreachable or returns an unexpected
 *      shape (so the caller can fall back to mockProgress()).
 *
 * Replace MEF_BASE / parsing with the exact endpoint your contract uses.
 */

import type { Project } from "./types";
import { logger } from "./logger";

export interface MefSnapshot {
  codigo: string;
  pim: number;
  devengado: number;
  avance_fisico: number;
}

const MEF_BASE = process.env.MEF_BASE_URL ?? "https://apps5.mineco.gob.pe/transparencia";
const REQUEST_TIMEOUT_MS = 15_000;
const RETRIES = 2;

export function mefIsLive(): boolean {
  return process.env.MEF_LIVE === "1";
}

export async function fetchConsultaAmigable(ubigeo: string, anio: number): Promise<MefSnapshot[]> {
  if (!mefIsLive()) return [];
  const url = `${MEF_BASE}/api/Inversiones/ListaPorUbigeo?ubigeo=${encodeURIComponent(ubigeo)}&anio=${anio}`;
  const json = await fetchJsonWithRetry(url, "consulta_amigable", { ubigeo, anio });
  if (!json || !Array.isArray(json)) return [];
  return json
    .map((row): MefSnapshot | null => {
      const codigo = String(row.cui ?? row.codigo ?? "").trim();
      const pim = Number(row.pim ?? row.PIM ?? 0);
      const devengado = Number(row.devengado ?? row.DEVENGADO ?? 0);
      const avance = Number(row.avance_fisico ?? row.avanceFisico ?? row.AVANCE_FISICO ?? 0);
      if (!codigo || !Number.isFinite(pim)) return null;
      return {
        codigo,
        pim: Math.max(0, Math.round(pim)),
        devengado: Math.max(0, Math.round(devengado)),
        avance_fisico: clampPct(avance)
      };
    })
    .filter((x): x is MefSnapshot => x !== null);
}

export async function fetchInviertePe(ubigeo: string): Promise<MefSnapshot[]> {
  if (!mefIsLive()) return [];
  const base = process.env.INVIERTE_BASE_URL ?? "https://ofi5.mef.gob.pe/inviertews";
  const url = `${base}/Consultas/ListaInversiones?ubigeo=${encodeURIComponent(ubigeo)}`;
  const json = await fetchJsonWithRetry(url, "invierte_pe", { ubigeo });
  if (!json || !Array.isArray(json)) return [];
  return json
    .map((row): MefSnapshot | null => {
      const codigo = String(row.codigoUnico ?? row.cui ?? "").trim();
      if (!codigo) return null;
      const pim = Number(row.montoActualizado ?? 0);
      const devengado = Number(row.montoDevengado ?? 0);
      const avance = Number(row.avanceFisico ?? 0);
      return {
        codigo,
        pim: Math.max(0, Math.round(pim)),
        devengado: Math.max(0, Math.round(devengado)),
        avance_fisico: clampPct(avance)
      };
    })
    .filter((x): x is MefSnapshot => x !== null);
}

/**
 * Combines both sources, preferring Consulta Amigable for budget figures and
 * Invierte.pe for avance físico when available.
 */
export async function fetchMefForEntity(ubigeo: string, anio: number): Promise<Map<string, MefSnapshot>> {
  const [ca, ip] = await Promise.all([
    fetchConsultaAmigable(ubigeo, anio).catch(() => [] as MefSnapshot[]),
    fetchInviertePe(ubigeo).catch(() => [] as MefSnapshot[])
  ]);
  const merged = new Map<string, MefSnapshot>();
  for (const row of ca) merged.set(row.codigo, row);
  for (const row of ip) {
    const prev = merged.get(row.codigo);
    if (!prev) {
      merged.set(row.codigo, row);
    } else {
      merged.set(row.codigo, {
        codigo: row.codigo,
        pim: prev.pim || row.pim,
        devengado: prev.devengado || row.devengado,
        avance_fisico: row.avance_fisico || prev.avance_fisico
      });
    }
  }
  return merged;
}

/**
 * Deterministic mock progression: pushes each project's devengado closer to its
 * PIM proportionally to the % of fiscal year elapsed, with a small random walk
 * keyed off the project codigo so re-runs are stable per-day.
 */
export function mockProgress(p: Project, now: Date = new Date()): { devengado: number; avance_fisico: number } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const yearLen =
    ((now.getUTCFullYear() % 4 === 0 && now.getUTCFullYear() % 100 !== 0) || now.getUTCFullYear() % 400 === 0)
      ? 366
      : 365;
  const pctYear = dayOfYear / yearLen;

  const seed = [...p.codigo].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const drift = ((seed % 17) - 8) / 100; // -0.08 .. +0.08
  const target = Math.max(0, Math.min(1, pctYear * (0.85 + drift)));

  const newDev = Math.min(p.pim, Math.max(p.devengado, Math.round(p.pim * target)));
  const newAvance = Math.min(100, Math.max(p.avance_fisico, Math.round(target * 100)));
  return { devengado: newDev, avance_fisico: newAvance };
}

async function fetchJsonWithRetry(
  url: string,
  source: string,
  ctx: Record<string, unknown>
): Promise<unknown> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "ObraScope/1.0 (+https://obrascope.pe)"
        },
        signal: controller.signal,
        cache: "no-store"
      });
      clearTimeout(timer);
      if (!res.ok) {
        logger.warn("mef_fetch_non_ok", { source, status: res.status, attempt, ...ctx });
        if (res.status >= 500 && attempt < RETRIES) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        return null;
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      logger.warn("mef_fetch_error", {
        source,
        attempt,
        error: err instanceof Error ? err.message : String(err),
        ...ctx
      });
      if (attempt < RETRIES) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 1) return Math.round(n * 100); // tolerate 0..1 inputs
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
