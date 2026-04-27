import { describe, expect, it } from "vitest";
import {
  dayName,
  fmtDate,
  fmtDuration,
  fmtPct,
  fmtRelative,
  fmtSoles,
  labelToMinutes,
  minutesToLabel,
  shortDayName
} from "./format";

describe("fmtSoles", () => {
  it("formats Peruvian Soles", () => {
    expect(fmtSoles(1500)).toMatch(/1\.500|1,500/);
    expect(fmtSoles(1500)).toMatch(/S\/?\.?/);
  });
});

describe("fmtPct", () => {
  it("appends %", () => {
    expect(fmtPct(33.3, 0)).toBe("33%");
  });
});

describe("fmtDuration", () => {
  it("returns minutes when <60", () => expect(fmtDuration(45)).toBe("45 min"));
  it("returns hours when exact", () => expect(fmtDuration(120)).toBe("2 h"));
  it("returns mixed", () => expect(fmtDuration(75)).toBe("1 h 15 min"));
});

describe("minutesToLabel / labelToMinutes", () => {
  it("round trips", () => {
    expect(minutesToLabel(9 * 60)).toBe("09:00");
    expect(labelToMinutes("19:30")).toBe(19 * 60 + 30);
  });
  it("throws for invalid", () => {
    expect(() => labelToMinutes("oops")).toThrow();
  });
});

describe("dayName / shortDayName", () => {
  it("returns Spanish names", () => {
    expect(dayName(0)).toBe("Domingo");
    expect(dayName(1)).toBe("Lunes");
    expect(shortDayName(5)).toBe("Vie");
  });
});

describe("fmtRelative", () => {
  const ref = new Date("2025-06-15T12:00:00Z");
  it("returns 'ahora' for <1 min", () => {
    expect(fmtRelative(new Date("2025-06-15T12:00:00Z"), ref)).toBe("ahora");
  });
  it("returns minute label for past minutes", () => {
    expect(fmtRelative(new Date("2025-06-15T11:55:00Z"), ref)).toBe("hace 5 min");
  });
  it("returns minute label for future minutes", () => {
    expect(fmtRelative(new Date("2025-06-15T12:30:00Z"), ref)).toBe("en 30 min");
  });
});

describe("fmtDate", () => {
  it("returns em-dash for null", () => {
    expect(fmtDate(null)).toBe("—");
  });
});
