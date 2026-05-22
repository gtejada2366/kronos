/** All dates in this project are UTC YYYY-MM-DD strings. */

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDateStr(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}

export function todayUTC(): string {
  return toDateStr(new Date());
}

/** Inclusive list of date strings from start to end. */
export function dateRange(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  let cur = startStr;
  let guard = 0;
  while (cur <= endStr && guard < 10000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}
