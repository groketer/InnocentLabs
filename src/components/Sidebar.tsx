"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", enabled: true },
  { label: "Intelligence", href: "/intelligence", enabled: true },
  { label: "Prospects", href: "/prospects", enabled: true },
  { label: "Follow-ups", href: "/follow-ups", enabled: false },
  { label: "Products", href: "/products", enabled: false },
  { label: "Activity", href: "/activity", enabled: true },
  { label: "Settings", href: "/settings", enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <div className="flex items-center gap-2 px-5 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/90 text-sm font-bold text-ink-950">
          II
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">
            Innocent Intelligence
          </p>
          <p className="text-xs leading-tight text-white/40">
            Business-development partner
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;

          if (!item.enabled) {
            return (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-white/30"
                title="Coming soon"
              >
                <span>{item.label}</span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/30">
                  Soon
                </span>
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-700 px-5 py-4">
        <p className="text-xs text-white/30">Milestone 1 — Foundation</p>
      </div>
    </aside>
  );
}
