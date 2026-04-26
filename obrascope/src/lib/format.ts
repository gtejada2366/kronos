const SOLES = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const SOLES_COMPACT = new Intl.NumberFormat("es-PE", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1
});

const NUMBER = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });

const DATE = new Intl.DateTimeFormat("es-PE", {
  year: "numeric",
  month: "short",
  day: "2-digit"
});

export function fmtSoles(n: number): string {
  return SOLES.format(n);
}

export function fmtSolesCompact(n: number): string {
  return "S/. " + SOLES_COMPACT.format(n);
}

export function fmtPct(n: number, digits = 1): string {
  return `${NUMBER.format(Number(n.toFixed(digits)))}%`;
}

export function fmtNumber(n: number): string {
  return NUMBER.format(n);
}

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  return DATE.format(new Date(iso));
}

export function mesNombre(m: number): string {
  const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return names[(m - 1) % 12] ?? String(m);
}
