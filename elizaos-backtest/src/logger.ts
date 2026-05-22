function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`[${ts()}] INFO  ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[${ts()}] WARN  ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[${ts()}] ERROR ${msg}`, ...args),
  step: (msg: string) => console.log(`\n${"─".repeat(64)}\n  ${msg}\n${"─".repeat(64)}`)
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
