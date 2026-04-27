"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", label: "Panel", icon: "▣" },
  { href: "/leads", label: "Leads", icon: "✉" },
  { href: "/appointments", label: "Citas", icon: "🗓" },
  { href: "/services", label: "Servicios", icon: "✚" },
  { href: "/availability", label: "Horarios", icon: "⏱" },
  { href: "/settings", label: "Configuración", icon: "⚙" }
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 border-r border-bg-border bg-bg-elev py-6 lg:block">
      <nav className="flex flex-col gap-0.5 px-3">
        {ITEMS.map((it) => {
          const active = path === it.href || path.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-brand-soft text-brand font-semibold"
                  : "text-ink-mute hover:bg-bg hover:text-ink"
              }`}
            >
              <span className="font-mono text-xs">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
