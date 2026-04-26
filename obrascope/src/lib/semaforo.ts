import type { Project, ProjectWithSemaforo, Semaforo } from "./types";

const FACTOR_OBJETIVO = 0.9;
const UMBRAL_AMARILLO = 0.6;

export function diaDelAnio(date: Date = new Date()): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function diasEnAnio(date: Date = new Date()): number {
  const year = date.getUTCFullYear();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

export function pctAnioTranscurrido(date: Date = new Date()): number {
  return (diaDelAnio(date) / diasEnAnio(date)) * 100;
}

export function pctEsperado(date: Date = new Date()): number {
  return pctAnioTranscurrido(date) * FACTOR_OBJETIVO;
}

export function calcularSemaforo(pctDevengado: number, pctEsp: number): Semaforo {
  if (pctDevengado >= pctEsp) return "verde";
  if (pctDevengado >= pctEsp * UMBRAL_AMARILLO) return "amarillo";
  return "rojo";
}

export function enrichProject(p: Project, now: Date = new Date()): ProjectWithSemaforo {
  const pctDev = p.pim > 0 ? (p.devengado / p.pim) * 100 : 0;
  const pctTrans = pctAnioTranscurrido(now);
  const pctEsp = pctEsperado(now);
  return {
    ...p,
    pct_devengado: pctDev,
    pct_anio_transcurrido: pctTrans,
    pct_esperado: pctEsp,
    semaforo: calcularSemaforo(pctDev, pctEsp)
  };
}

export function semaforoLabel(s: Semaforo): string {
  return s === "verde" ? "En meta" : s === "amarillo" ? "Riesgo" : "Crítico";
}

export function semaforoColor(s: Semaforo): string {
  return s === "verde" ? "#10B981" : s === "amarillo" ? "#EAB308" : "#EF4444";
}
