import {
  APPOINTMENT_BUFFER_MINUTES,
  MAX_BOOKING_LEAD_DAYS,
  MIN_BOOKING_LEAD_HOURS
} from "../constants";
import type {
  AvailabilityOverride,
  AvailabilityRule,
  Appointment,
  Slot
} from "../types";

export interface AvailabilityInput {
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  appointments: Pick<Appointment, "scheduled_at" | "duration_minutes" | "status">[];
  timezone: string;
  serviceDurationMinutes: number;
  now?: Date;
  daysAhead?: number;
}

/**
 * Compute available slots that fit a service of `serviceDurationMinutes` length
 * across the next `daysAhead` days, given:
 *   - weekly recurring availability rules
 *   - per-date overrides (closed/custom hours)
 *   - existing appointments (any non-terminal status blocks the slot)
 *
 * Returns slot ISO timestamps in UTC. The bot speaks to patients in clinic TZ
 * via the format helpers, but the slots themselves are TZ-neutral.
 */
export function computeAvailableSlots(input: AvailabilityInput): Slot[] {
  const {
    rules,
    overrides,
    appointments,
    timezone,
    serviceDurationMinutes,
    now = new Date(),
    daysAhead = 14
  } = input;

  const min = new Date(now.getTime() + MIN_BOOKING_LEAD_HOURS * 60 * 60 * 1000);
  const horizonDays = Math.min(daysAhead, MAX_BOOKING_LEAD_DAYS);
  // max = end of the horizon day (last day fully open), not "now + N*24h"
  const maxDay = new Date(now);
  maxDay.setUTCHours(0, 0, 0, 0);
  const max = new Date(maxDay.getTime() + (horizonDays + 1) * 24 * 60 * 60 * 1000);

  const blocked = appointments
    .filter((a) => a.status !== "expired" && a.status !== "cancelled" && a.status !== "no_show")
    .map((a) => {
      const start = new Date(a.scheduled_at);
      const end = new Date(start.getTime() + a.duration_minutes * 60 * 1000);
      return { start, end };
    });

  const overrideByDate = new Map<string, AvailabilityOverride>();
  for (const o of overrides) overrideByDate.set(o.date, o);

  const slots: Slot[] = [];
  // Anchor day iteration in clinic timezone so "today" doesn't roll back when
  // the runtime is in UTC and the clinic is in UTC-5.
  const todayYmd = ymdInTimezone(now, timezone);

  for (let d = 0; d <= daysAhead; d++) {
    const ymd = addDaysToYmd(todayYmd, d);
    // A noon-UTC anchor is enough to extract the dow consistently in any tz.
    const dayAnchor = new Date(ymd + "T12:00:00Z");
    const override = overrideByDate.get(ymd);

    if (override?.closed) continue;

    const dow = dayOfWeekInTimezone(dayAnchor, timezone);
    let intervals: Array<{ start: number; end: number }> = [];

    if (override && override.custom_start_minute != null && override.custom_end_minute != null) {
      intervals = [{ start: override.custom_start_minute, end: override.custom_end_minute }];
    } else {
      intervals = rules
        .filter((r) => r.day_of_week === dow)
        .map((r) => ({ start: r.start_minute, end: r.end_minute }));
    }

    for (const interval of intervals) {
      let cursor = interval.start;
      while (cursor + serviceDurationMinutes <= interval.end) {
        const startUtc = wallTimeToUtc(ymd, cursor, timezone);
        const endUtc = new Date(startUtc.getTime() + serviceDurationMinutes * 60 * 1000);

        if (startUtc < min || startUtc > max) {
          cursor += APPOINTMENT_BUFFER_MINUTES + 5;
          continue;
        }

        const conflict = blocked.some(
          (b) =>
            startUtc < new Date(b.end.getTime() + APPOINTMENT_BUFFER_MINUTES * 60 * 1000) &&
            endUtc > new Date(b.start.getTime() - APPOINTMENT_BUFFER_MINUTES * 60 * 1000)
        );

        if (!conflict) slots.push({ start: startUtc.toISOString(), end: endUtc.toISOString() });

        cursor += serviceDurationMinutes + APPOINTMENT_BUFFER_MINUTES;
      }
    }
  }

  return slots;
}

/**
 * Adds `days` to a YYYY-MM-DD date string, returning YYYY-MM-DD.
 */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  const utc = Date.UTC(y, m - 1, d);
  const next = new Date(utc + days * 24 * 60 * 60 * 1000);
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Returns YYYY-MM-DD as observed in the given IANA timezone.
 */
export function ymdInTimezone(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(date);
}

export function dayOfWeekInTimezone(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  const day = fmt.format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[day] ?? 0;
}

/**
 * Convert (date YMD, minutes-from-midnight, IANA tz) to a UTC Date that
 * represents that wall-clock time in that timezone.
 *
 * Algorithm: take the naive UTC date for the YMD+minutes, then look at how
 * that instant *displays* in the target tz. The diff between the displayed
 * wall time and the requested wall time equals the timezone offset, which we
 * subtract to get the true UTC instant.
 */
export function wallTimeToUtc(ymd: string, minutes: number, timezone: string): Date {
  const [yStr, mStr, dStr] = ymd.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10) - 1;
  const d = parseInt(dStr, 10);
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;

  const naive = Date.UTC(y, m, d, hour, min, 0);

  const displayed = wallClockMinutesAt(new Date(naive), timezone);
  const requested = (d * 24 * 60) + minutes;
  const displayedAbsolute = displayed.dayOffsetMinutes + displayed.minutes;
  const diff = displayedAbsolute - requested;
  return new Date(naive - diff * 60 * 1000);
}

/**
 * Returns the wall-clock minutes-from-midnight of `date` as observed in `tz`,
 * along with the day-of-month offset (in minutes-of-day terms).
 */
export function wallClockMinutesAt(date: Date, timezone: string): {
  minutes: number;
  dayOffsetMinutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const day = parseInt(get("day"), 10);
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10);
  return { minutes: hour * 60 + minute, dayOffsetMinutes: day * 24 * 60 };
}

/**
 * Picks N evenly-spaced slot suggestions from the available list, biased
 * toward sooner-but-not-cramped timing. Designed for the bot, which should
 * never dump 60 options on a patient.
 */
export function pickSuggestions(slots: Slot[], n = 3): Slot[] {
  if (slots.length <= n) return slots;
  const result: Slot[] = [];
  const stride = Math.floor(slots.length / n);
  for (let i = 0; i < n; i++) {
    const idx = Math.min(slots.length - 1, i * stride);
    result.push(slots[idx]);
  }
  return result;
}
