export function EmptyState({
  title,
  body,
  action
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel grid place-items-center px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
        <span className="font-mono text-lg">⌬</span>
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-ink-mute">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
