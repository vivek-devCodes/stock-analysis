"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ChevronsLeft, ChevronsRight, CircleUser, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { clsx } from "@/lib/format";
import { NAV_GROUPS, navItemFor } from "@/lib/nav";
import { GlobalSearch } from "./GlobalSearch";
import { MarketChips } from "./MarketChips";

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.replace("/login");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const current = navItemFor(pathname);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.user && setUser(j.user))
      .catch(() => {});
  }, []);

  const sidebar = (mobile: boolean) => {
    const narrow = collapsed && !mobile;
    return (
      <div className="flex h-full flex-col">
        <div className={clsx("flex items-center gap-2 border-b border-line px-4 py-4", narrow && "justify-center px-2")}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Activity className="h-5 w-5" />
          </span>
          {!narrow && (
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">Apex Desk</p>
              <p className="text-[11px] text-muted">Stock Analysis CRM</p>
            </div>
          )}
          {mobile && (
            <button onClick={() => setMobileOpen(false)} className="ml-auto rounded-lg p-1.5 text-muted hover:bg-white/5" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              {!narrow && <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">{group.title}</p>}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = current.href === item.href;
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        title={narrow ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                          narrow && "justify-center",
                          active ? "bg-accent/15 font-medium text-foreground" : "text-muted hover:bg-white/5 hover:text-foreground",
                        )}
                      >
                        <Icon className={clsx("h-[18px] w-[18px] shrink-0", active ? item.tone : "group-hover:text-foreground")} />
                        {!narrow && <span className="truncate">{item.label}</span>}
                        {active && !narrow && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <div className={clsx("flex items-center gap-2 rounded-lg bg-white/[0.03] p-2", narrow && "flex-col")}>
            <CircleUser className="h-8 w-8 shrink-0 text-muted" />
            {!narrow && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.username ?? "Admin"}</p>
                <p className="flex items-center gap-1 text-[11px] text-muted">
                  <ShieldCheck className="h-3 w-3 text-up" />
                  {user?.role === "admin" ? "Administrator" : "Signed in"}
                </p>
              </div>
            )}
            <button onClick={logout} title="Logout" aria-label="Logout" className="rounded-lg p-2 text-muted hover:bg-down/15 hover:text-down">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {!mobile && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-xs text-muted hover:bg-white/5 hover:text-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              {!collapsed && "Collapse"}
            </button>
          )}
        </div>
      </div>
    );
  };

  const CurrentIcon = current.icon;

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          "sticky top-0 hidden h-screen shrink-0 border-r border-line bg-[#0a0e14] transition-[width] duration-200 lg:block",
          collapsed ? "w-[72px]" : "w-60",
        )}
      >
        {sidebar(false)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64 border-r border-line bg-[#0a0e14]">{sidebar(true)}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-[#07090d]/90 px-4 py-2.5 backdrop-blur">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-muted hover:bg-white/5 lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 sm:flex">
              <CurrentIcon className={clsx("h-4 w-4", current.tone)} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{current.label}</p>
              <p className="hidden truncate text-[11px] text-muted md:block">{current.description}</p>
            </div>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <MarketChips />
            <GlobalSearch />
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
