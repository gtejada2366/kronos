import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import type { Entity } from "@/lib/types";

export function Topbar({ entity, email }: { entity: Entity; email: string | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-bg-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-sm bg-accent text-black">
              <span className="font-mono text-xs font-bold">O</span>
            </div>
            <span className="font-mono text-xs font-semibold tracking-[0.2em]">OBRASCOPE</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <Link href="/dashboard" className="rounded-sm px-3 py-1.5 text-sm text-ink-mute hover:bg-bg-elev hover:text-ink">
              Cartera
            </Link>
            <Link href="/settings" className="rounded-sm px-3 py-1.5 text-sm text-ink-mute hover:bg-bg-elev hover:text-ink">
              Configuración
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium text-ink">{entity.nombre}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">
              UBIGEO {entity.ubigeo} · {email ?? "—"}
            </p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
