export function KpiCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "brand" | "ok" | "warn" | "err";
}) {
  const toneClass =
    tone === "brand"
      ? "text-brand"
      : tone === "ok"
      ? "text-ok"
      : tone === "warn"
      ? "text-warn"
      : tone === "err"
      ? "text-err"
      : "text-ink";
  return (
    <div className="panel p-4">
      <p className="label">{label}</p>
      <p className={`mt-2 num text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-dim">{hint}</p> : null}
    </div>
  );
}
