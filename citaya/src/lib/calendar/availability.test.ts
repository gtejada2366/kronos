import { describe, expect, it } from "vitest";
import {
  computeAvailableSlots,
  dayOfWeekInTimezone,
  pickSuggestions,
  wallTimeToUtc,
  ymdInTimezone
} from "./availability";
import type { AvailabilityRule } from "../types";

const TZ = "America/Lima";

const MON_TO_FRI_9_19: AvailabilityRule[] = [1, 2, 3, 4, 5].map((d) => ({
  id: `r-${d}`,
  clinic_id: "c1",
  day_of_week: d,
  start_minute: 9 * 60,
  end_minute: 19 * 60
}));

describe("ymdInTimezone", () => {
  it("returns YYYY-MM-DD in target tz", () => {
    const date = new Date("2025-06-15T05:00:00Z");
    expect(ymdInTimezone(date, TZ)).toBe("2025-06-15");
  });
  it("respects tz boundary", () => {
    // 03:00 UTC = 22:00 previous day in Lima (UTC-5)
    const date = new Date("2025-06-15T03:00:00Z");
    expect(ymdInTimezone(date, TZ)).toBe("2025-06-14");
  });
});

describe("dayOfWeekInTimezone", () => {
  it("returns Monday=1 etc.", () => {
    expect(dayOfWeekInTimezone(new Date("2025-06-09T15:00:00Z"), TZ)).toBe(1); // Mon
    expect(dayOfWeekInTimezone(new Date("2025-06-15T15:00:00Z"), TZ)).toBe(0); // Sun
  });
});

describe("wallTimeToUtc", () => {
  it("9am Lima = 14:00 UTC", () => {
    const utc = wallTimeToUtc("2025-06-09", 9 * 60, TZ);
    expect(utc.toISOString()).toBe("2025-06-09T14:00:00.000Z");
  });
  it("19:30 Lima = 00:30 UTC next day", () => {
    const utc = wallTimeToUtc("2025-06-09", 19 * 60 + 30, TZ);
    expect(utc.toISOString()).toBe("2025-06-10T00:30:00.000Z");
  });
});

describe("computeAvailableSlots", () => {
  it("produces slots in business hours only", () => {
    const now = new Date("2025-06-09T13:00:00Z"); // Mon 8am Lima
    const slots = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [],
      appointments: [],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 1
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const start = new Date(s.start);
      const hour = start.getUTCHours();
      // 9am Lima = 14 UTC, 19 Lima = 00 UTC. So expected UTC hour range 14..23 + 0
      expect([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0].includes(hour)).toBe(true);
    }
  });

  it("respects MIN_BOOKING_LEAD_HOURS (no slots <2h ahead)", () => {
    const now = new Date("2025-06-09T15:00:00Z"); // Mon 10am Lima
    const slots = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [],
      appointments: [],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 0
    });
    for (const s of slots) {
      const start = new Date(s.start);
      expect(start.getTime() - now.getTime()).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    }
  });

  it("blocks slots overlapping with existing appointments", () => {
    const now = new Date("2025-06-09T13:00:00Z");
    const slots = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [],
      appointments: [
        { scheduled_at: "2025-06-09T20:00:00Z", duration_minutes: 60, status: "confirmed" } // 3pm Lima
      ],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 0
    });
    for (const s of slots) {
      const start = new Date(s.start).getTime();
      const blockedStart = new Date("2025-06-09T20:00:00Z").getTime();
      const blockedEnd = blockedStart + 60 * 60 * 1000;
      expect(start >= blockedEnd || start + 30 * 60 * 1000 <= blockedStart).toBe(true);
    }
  });

  it("ignores cancelled / expired appointments", () => {
    const now = new Date("2025-06-09T13:00:00Z");
    const baseline = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [],
      appointments: [],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 0
    });
    const withCancelled = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [],
      appointments: [
        { scheduled_at: "2025-06-09T20:00:00Z", duration_minutes: 60, status: "cancelled" }
      ],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 0
    });
    expect(withCancelled.length).toBe(baseline.length);
  });

  it("respects closed-day overrides", () => {
    const now = new Date("2025-06-09T13:00:00Z");
    const slots = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [
        {
          id: "ov1",
          clinic_id: "c1",
          date: "2025-06-09",
          closed: true,
          custom_start_minute: null,
          custom_end_minute: null,
          note: "feriado"
        }
      ],
      appointments: [],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 1
    });
    for (const s of slots) {
      expect(ymdInTimezone(new Date(s.start), TZ)).not.toBe("2025-06-09");
    }
  });

  it("respects custom-hours overrides", () => {
    const now = new Date("2025-06-09T13:00:00Z");
    const slots = computeAvailableSlots({
      rules: MON_TO_FRI_9_19,
      overrides: [
        {
          id: "ov1",
          clinic_id: "c1",
          date: "2025-06-10",
          closed: false,
          custom_start_minute: 14 * 60,
          custom_end_minute: 16 * 60,
          note: "horario reducido"
        }
      ],
      appointments: [],
      timezone: TZ,
      serviceDurationMinutes: 30,
      now,
      daysAhead: 2
    });
    const tueSlots = slots.filter((s) => ymdInTimezone(new Date(s.start), TZ) === "2025-06-10");
    expect(tueSlots.length).toBeGreaterThan(0);
    for (const s of tueSlots) {
      const start = new Date(s.start);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(start);
      const h = parseInt(fmt, 10);
      expect(h).toBeGreaterThanOrEqual(14);
      expect(h).toBeLessThan(16);
    }
  });
});

describe("pickSuggestions", () => {
  it("returns all when fewer than n", () => {
    const slots = [{ start: "a", end: "" }, { start: "b", end: "" }];
    expect(pickSuggestions(slots, 3).length).toBe(2);
  });
  it("returns evenly spaced n slots", () => {
    const slots = Array.from({ length: 12 }, (_, i) => ({ start: String(i), end: "" }));
    const out = pickSuggestions(slots, 3);
    expect(out.length).toBe(3);
    expect(out[0].start).toBe("0");
  });
});
