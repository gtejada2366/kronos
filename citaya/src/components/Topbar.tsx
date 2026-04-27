import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import type { Clinic } from "@/lib/types";

export function Topbar({ clinic, email }: { clinic: Clinic; email: string | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-bg-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-brand text-white">
              <span className="font-mono text-xs font-bold">C</span>
            </div>
            <span className="font-semibold tracking-tight">Citaya</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium text-ink">{clinic.name}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">
              {email ?? "—"}
            </p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
