const SOLES = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const SOLES_DECIMAL = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const NUMBER = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });

const DATE_LONG = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "2-digit"
});

const DATE_SHORT = new Intl.DateTimeFormat("es-PE", {
  year: "numeric",
  month: "short",
  day: "2-digit"
});

const TIME = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const DATETIME = new Intl.DateTimeFormat("es-PE", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export function fmtSoles(n: number, withCents = false): string {
  return withCents ? SOLES_DECIMAL.format(n) : SOLES.format(n);
}

export function fmtNumber(n: number): string {
  return NUMBER.format(n);
}

export function fmtPct(n: number, digits = 1): string {
  return `${NUMBER.format(Number(n.toFixed(digits)))}%`;
}

export function fmtDate(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return DATE_SHORT.format(d);
}

export function fmtDateLong(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return DATE_LONG.format(d);
}

export function fmtTime(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return TIME.format(d);
}

export function fmtDateTime(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return DATETIME.format(d);
}

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function fmtRelative(iso: string | Date | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return future ? `en ${minutes} min` : `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `en ${hours} h` : `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return future ? `en ${days} d` : `hace ${days} d`;
  return fmtDate(d);
}

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function labelToMinutes(label: string): number {
  const [h, m] = label.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`invalid time label: ${label}`);
  return h * 60 + m;
}

export function dayName(dow: number): string {
  return ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][dow] ?? `Día ${dow}`;
}

export function shortDayName(dow: number): string {
  return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][dow] ?? `D${dow}`;
}
