"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Crosshair, FlaskConical, LogOut, Menu, Search, X } from "lucide-react";
import { AddClipDialog } from "@/components/clips/add-clip-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav";

export function AppShell({
  children,
  mode,
  userEmail,
  awaitingReview,
}: {
  children: React.ReactNode;
  mode: "demo" | "supabase";
  userEmail: string | null;
  awaitingReview: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-surface transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/20 text-violet-300">
            <Crosshair className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">ClipHunter</span>
          <button className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{section.title}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                          active ? "bg-white/[0.06] font-medium text-foreground" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                        )}
                      >
                        <Icon className={cn("size-4", active && "text-violet-400")} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badgeKey === "awaitingReview" && awaitingReview > 0 && (
                          <span className="rounded bg-primary/20 px-1.5 text-[10px] font-semibold tabular-nums text-violet-300">{awaitingReview}</span>
                        )}
                        {item.phase && (
                          <span className="rounded border border-border px-1 text-[9px] font-medium text-zinc-500" title={`Planned for Phase ${item.phase}`}>
                            P{item.phase}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          {mode === "demo" ? (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200">
              <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
                <FlaskConical className="size-3.5" /> Demo mode
              </div>
              Sample data stored locally. Connect Supabase in <code>.env.local</code> for real data.
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold uppercase text-violet-300">
                {userEmail?.[0] ?? "?"}
              </div>
              <span className="flex-1 truncate text-xs text-muted-foreground">{userEmail}</span>
              <form action="/auth/signout" method="post">
                <Button size="icon-sm" variant="ghost" type="submit" aria-label="Sign out" title="Sign out">
                  <LogOut />
                </Button>
              </form>
            </div>
          )}
        </div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Main */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button size="icon-sm" variant="ghost" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            {mode === "demo" && (
              <span className="hidden items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200 sm:inline-flex">
                <FlaskConical className="size-3" /> Demo data
              </span>
            )}
            <AddClipDialog />
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="relative w-full max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/clips?q=${encodeURIComponent(q.trim())}` : "/clips");
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all clips…" className="h-8 bg-card pl-8" aria-label="Search all clips" />
    </form>
  );
}
