import { describe, expect, it } from "vitest";
import {
  calcularSemaforo,
  diaDelAnio,
  diasEnAnio,
  enrichProject,
  pctAnioTranscurrido,
  pctEsperado,
  semaforoColor,
  semaforoLabel
} from "./semaforo";
import type { Project } from "./types";

describe("diaDelAnio", () => {
  it("returns 1 for January 1st", () => {
    expect(diaDelAnio(new Date(Date.UTC(2025, 0, 1)))).toBe(1);
  });
  it("returns 365 for December 31st on a non-leap year", () => {
    expect(diaDelAnio(new Date(Date.UTC(2025, 11, 31)))).toBe(365);
  });
  it("returns 366 for December 31st on a leap year", () => {
    expect(diaDelAnio(new Date(Date.UTC(2024, 11, 31)))).toBe(366);
  });
});

describe("diasEnAnio", () => {
  it("returns 365 in normal years", () => {
    expect(diasEnAnio(new Date(Date.UTC(2025, 5, 1)))).toBe(365);
  });
  it("returns 366 in leap years (div by 4)", () => {
    expect(diasEnAnio(new Date(Date.UTC(2024, 5, 1)))).toBe(366);
  });
  it("returns 365 for century years not divisible by 400", () => {
    expect(diasEnAnio(new Date(Date.UTC(2100, 5, 1)))).toBe(365);
  });
  it("returns 366 for century years divisible by 400", () => {
    expect(diasEnAnio(new Date(Date.UTC(2000, 5, 1)))).toBe(366);
  });
});

describe("pctAnioTranscurrido", () => {
  it("is ~50% at the middle of the year", () => {
    const v = pctAnioTranscurrido(new Date(Date.UTC(2025, 6, 2)));
    expect(v).toBeGreaterThan(49);
    expect(v).toBeLessThan(52);
  });
});

describe("pctEsperado", () => {
  it("is exactly factor 0.9 of pctAnioTranscurrido", () => {
    const d = new Date(Date.UTC(2025, 5, 30));
    expect(pctEsperado(d)).toBeCloseTo(pctAnioTranscurrido(d) * 0.9);
  });
});

describe("calcularSemaforo", () => {
  it("verde when actual >= expected", () => {
    expect(calcularSemaforo(60, 50)).toBe("verde");
    expect(calcularSemaforo(50, 50)).toBe("verde");
  });
  it("amarillo when expected > actual >= expected*0.6", () => {
    expect(calcularSemaforo(35, 50)).toBe("amarillo");
    expect(calcularSemaforo(30, 50)).toBe("amarillo");
  });
  it("rojo when actual < expected*0.6", () => {
    expect(calcularSemaforo(29.99, 50)).toBe("rojo");
    expect(calcularSemaforo(0, 50)).toBe("rojo");
  });
  it("rojo when expected is 0 only when actual is also 0", () => {
    expect(calcularSemaforo(0, 0)).toBe("verde");
  });
});

describe("enrichProject", () => {
  const base: Project = {
    id: "p1",
    entity_id: "e1",
    codigo: "001",
    nombre: "Test",
    pia: 1_000_000,
    pim: 1_000_000,
    devengado: 500_000,
    avance_fisico: 50,
    estado: "EN_EJECUCION",
    fecha_inicio: "2025-01-01",
    fecha_fin: "2025-12-31",
    updated_at: "2025-06-01T00:00:00Z"
  };

  it("computes pct_devengado from devengado/PIM", () => {
    const e = enrichProject(base, new Date(Date.UTC(2025, 5, 1)));
    expect(e.pct_devengado).toBeCloseTo(50);
  });
  it("returns 0% devengado when PIM is 0", () => {
    const e = enrichProject({ ...base, pim: 0, devengado: 0 }, new Date(Date.UTC(2025, 5, 1)));
    expect(e.pct_devengado).toBe(0);
  });
  it("classifies a healthy project as verde", () => {
    const e = enrichProject({ ...base, devengado: 900_000 }, new Date(Date.UTC(2025, 5, 1)));
    expect(e.semaforo).toBe("verde");
  });
  it("classifies a stalled project as rojo", () => {
    const e = enrichProject({ ...base, devengado: 50_000 }, new Date(Date.UTC(2025, 11, 1)));
    expect(e.semaforo).toBe("rojo");
  });
});

describe("semaforoLabel + semaforoColor", () => {
  it("returns matching color hex", () => {
    expect(semaforoColor("verde")).toBe("#10B981");
    expect(semaforoColor("amarillo")).toBe("#EAB308");
    expect(semaforoColor("rojo")).toBe("#EF4444");
  });
  it("returns Spanish labels", () => {
    expect(semaforoLabel("verde")).toBe("En meta");
    expect(semaforoLabel("amarillo")).toBe("Riesgo");
    expect(semaforoLabel("rojo")).toBe("Crítico");
  });
});
