import { describe, expect, it } from "vitest";
import { fmtDate, fmtNumber, fmtPct, fmtSoles, fmtSolesCompact, mesNombre } from "./format";

describe("fmtSoles", () => {
  it("renders Peruvian Soles without decimals", () => {
    const out = fmtSoles(1_234_567);
    expect(out).toContain("1");
    expect(out).toContain("234");
    expect(out).toContain("567");
    expect(out).toMatch(/S\/?\.?/);
  });
});

describe("fmtSolesCompact", () => {
  it("renders compact for big numbers", () => {
    expect(fmtSolesCompact(1_500_000)).toContain("1");
    expect(fmtSolesCompact(1_500_000)).toContain("M");
  });
  it("prefixes with S/.", () => {
    expect(fmtSolesCompact(1000)).toMatch(/^S\/\./);
  });
});

describe("fmtPct", () => {
  it("appends % and uses 1 decimal by default", () => {
    expect(fmtPct(12.345)).toMatch(/^12[.,]3%$/);
  });
  it("supports digits override", () => {
    expect(fmtPct(50, 0)).toBe("50%");
  });
});

describe("fmtNumber", () => {
  it("formats with locale separators", () => {
    expect(fmtNumber(1234)).toMatch(/1.?234/);
  });
});

describe("fmtDate", () => {
  it("returns em-dash for empty", () => {
    expect(fmtDate("")).toBe("—");
  });
  it("formats ISO dates in Spanish", () => {
    const out = fmtDate("2025-06-15");
    expect(out.toLowerCase()).toMatch(/jun/);
  });
});

describe("mesNombre", () => {
  it("maps month numbers to Spanish abbreviations", () => {
    expect(mesNombre(1)).toBe("Ene");
    expect(mesNombre(12)).toBe("Dic");
    expect(mesNombre(7)).toBe("Jul");
  });
});
