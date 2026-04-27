import { describe, expect, it } from "vitest";
import { mefIsLive, mockProgress } from "./mef";
import type { Project } from "./types";

const project: Project = {
  id: "p1",
  entity_id: "e1",
  codigo: "2467821",
  nombre: "Avenida prueba",
  pia: 1_000_000,
  pim: 1_000_000,
  devengado: 0,
  avance_fisico: 0,
  estado: "EN_EJECUCION",
  fecha_inicio: "2025-01-01",
  fecha_fin: "2025-12-31",
  updated_at: "2025-01-01T00:00:00Z"
};

describe("mockProgress", () => {
  it("never decreases devengado", () => {
    const start = { ...project, devengado: 800_000, avance_fisico: 80 };
    const next = mockProgress(start, new Date(Date.UTC(2025, 5, 1)));
    expect(next.devengado).toBeGreaterThanOrEqual(start.devengado);
    expect(next.avance_fisico).toBeGreaterThanOrEqual(start.avance_fisico);
  });

  it("returns devengado <= PIM", () => {
    const next = mockProgress(project, new Date(Date.UTC(2025, 11, 31)));
    expect(next.devengado).toBeLessThanOrEqual(project.pim);
  });

  it("returns avance_fisico in 0..100", () => {
    const next = mockProgress(project, new Date(Date.UTC(2025, 11, 31)));
    expect(next.avance_fisico).toBeGreaterThanOrEqual(0);
    expect(next.avance_fisico).toBeLessThanOrEqual(100);
  });

  it("is deterministic for same input", () => {
    const a = mockProgress(project, new Date(Date.UTC(2025, 5, 15)));
    const b = mockProgress(project, new Date(Date.UTC(2025, 5, 15)));
    expect(a).toEqual(b);
  });

  it("progresses more later in the year", () => {
    const early = mockProgress(project, new Date(Date.UTC(2025, 1, 1)));
    const late = mockProgress(project, new Date(Date.UTC(2025, 10, 1)));
    expect(late.devengado).toBeGreaterThanOrEqual(early.devengado);
  });
});

describe("mefIsLive", () => {
  it("returns false by default", () => {
    delete process.env.MEF_LIVE;
    expect(mefIsLive()).toBe(false);
  });

  it("returns true when MEF_LIVE=1", () => {
    process.env.MEF_LIVE = "1";
    expect(mefIsLive()).toBe(true);
    delete process.env.MEF_LIVE;
  });
});
