"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Loader2, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { REVIEW_LABEL } from "@/lib/format";
import { PLATFORM_META } from "@/lib/platforms";
import { SORT_LABEL } from "@/lib/query-params";
import { PLATFORMS, REVIEW_STATUSES, SORT_OPTIONS, type Creator } from "@/lib/types";
import { cn } from "@/lib/utils";

const ADVANCED_KEYS = ["minViews", "maxDuration", "minScore", "uploaded", "discovered", "category", "creator"];

export function ClipFilters({
  categories,
  creators,
  hideStatus,
  defaultSort = "discovered_desc",
}: {
  categories: string[];
  creators: Pick<Creator, "id" | "name" | "platform">[];
  /** Hide the review-status filter on pages where status is fixed. */
  hideStatus?: boolean;
  defaultSort?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [showAdvanced, setShowAdvanced] = useState(() => ADVANCED_KEYS.some((k) => params.has(k)));

  useEffect(() => setSearch(params.get("q") ?? ""), [params]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (search === current) return;
    const t = setTimeout(() => update({ q: search.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const activePlatforms = new Set((params.get("platform") ?? "").split(",").filter(Boolean));
  const togglePlatform = (p: string) => {
    const s = new Set(activePlatforms);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    update({ platform: [...s].join(",") || null });
  };

  const view = params.get("view") === "list" ? "list" : "grid";
  const fav = params.get("fav") === "1";
  const hasFilters = [...params.keys()].some((k) => !["view", "sort", "page"].includes(k));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles & creators…" className="pl-8" />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {PLATFORMS.map((p) => {
            const on = activePlatforms.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                aria-pressed={on}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                  on ? "border-zinc-500 bg-zinc-800 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: PLATFORM_META[p].color }} />
                {PLATFORM_META[p].label}
              </button>
            );
          })}
        </div>

        {!hideStatus && (
          <Select value={params.get("status") ?? ""} onChange={(e) => update({ status: e.target.value || null })} className="h-8 w-40 text-xs" aria-label="Review status">
            <option value="">All statuses</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REVIEW_LABEL[s]}
              </option>
            ))}
          </Select>
        )}

        <Button size="sm" variant={fav ? "secondary" : "outline"} onClick={() => update({ fav: fav ? null : "1" })} aria-pressed={fav}>
          <Star className={cn(fav && "fill-amber-400 text-amber-400")} /> Favorites
        </Button>

        <Button size="sm" variant={showAdvanced ? "secondary" : "outline"} onClick={() => setShowAdvanced((v) => !v)}>
          <SlidersHorizontal /> Filters
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Select value={params.get("sort") ?? defaultSort} onChange={(e) => update({ sort: e.target.value })} className="h-8 w-44 text-xs" aria-label="Sort by">
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </Select>
          <div className="flex rounded-md border p-0.5">
            <Button size="icon-sm" variant={view === "grid" ? "secondary" : "ghost"} onClick={() => update({ view: null, page: params.get("page") })} aria-label="Grid view">
              <LayoutGrid />
            </Button>
            <Button size="icon-sm" variant={view === "list" ? "secondary" : "ghost"} onClick={() => update({ view: "list", page: params.get("page") })} aria-label="List view">
              <List />
            </Button>
          </div>
        </div>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-4 xl:grid-cols-7">
          <FilterField label="Min. views">
            <Input
              type="number"
              min={0}
              defaultValue={params.get("minViews") ?? ""}
              onBlur={(e) => update({ minViews: e.target.value || null })}
              onKeyDown={(e) => e.key === "Enter" && update({ minViews: e.currentTarget.value || null })}
              className="h-8 text-xs"
              placeholder="Any"
            />
          </FilterField>
          <FilterField label="Max. duration (s)">
            <Input
              type="number"
              min={0}
              defaultValue={params.get("maxDuration") ?? ""}
              onBlur={(e) => update({ maxDuration: e.target.value || null })}
              onKeyDown={(e) => e.key === "Enter" && update({ maxDuration: e.currentTarget.value || null })}
              className="h-8 text-xs"
              placeholder="Any"
            />
          </FilterField>
          <FilterField label="Min. viral score">
            <Select value={params.get("minScore") ?? ""} onChange={(e) => update({ minScore: e.target.value || null })} className="h-8 text-xs">
              <option value="">Any</option>
              <option value="31">31+ Interesting</option>
              <option value="61">61+ High potential</option>
              <option value="81">81+ Viral candidate</option>
            </Select>
          </FilterField>
          <FilterField label="Uploaded">
            <DateSelect value={params.get("uploaded")} onChange={(v) => update({ uploaded: v })} />
          </FilterField>
          <FilterField label="Discovered">
            <DateSelect value={params.get("discovered")} onChange={(v) => update({ discovered: v })} />
          </FilterField>
          <FilterField label="Category / game">
            <Select value={params.get("category") ?? ""} onChange={(e) => update({ category: e.target.value || null })} className="h-8 text-xs">
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Creator">
            <Select value={params.get("creator") ?? ""} onChange={(e) => update({ creator: e.target.value || null })} className="h-8 text-xs">
              <option value="">All</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({PLATFORM_META[c.platform].short})
                </option>
              ))}
            </Select>
          </FilterField>
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            const keep = new URLSearchParams();
            for (const k of ["view", "sort"]) if (params.get(k)) keep.set(k, params.get(k)!);
            startTransition(() => router.replace(`${pathname}?${keep.toString()}`, { scroll: false }));
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" /> Clear filters
        </button>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function DateSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="h-8 text-xs">
      <option value="">Any time</option>
      <option value="24h">Last 24 hours</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d">Last 90 days</option>
    </Select>
  );
}
