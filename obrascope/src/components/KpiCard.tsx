export function KpiCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "green" | "yellow" | "red";
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "green"
      ? "text-sema-green"
      : tone === "yellow"
      ? "text-sema-yellow"
      : tone === "red"
      ? "text-sema-red"
      : "text-ink";
  return (
    <div className="panel p-4">
      <p className="label">{label}</p>
      <p className={`mt-2 num text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-dim">{hint}</p> : null}
    </div>
  );
}
