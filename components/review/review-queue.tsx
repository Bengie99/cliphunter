"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Inbox, Keyboard, Star, X } from "lucide-react";
import { toast } from "sonner";
import { setFavoriteAction, setReviewStatusAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PlatformBadge, ReviewBadge, RightsBadge, ScoreBadge } from "@/components/clips/badges";
import { ClipStats, DownloadButton } from "@/components/clips/clip-dialogs";
import { EmbedPlayer } from "@/components/clips/embed-player";
import { NotesPanel } from "@/components/clips/notes-panel";
import { ClipThumbnail } from "@/components/clips/thumbnail";
import { formatCount, formatDateTime, RIGHTS_HINT, timeAgo } from "@/lib/format";
import { PLATFORM_META } from "@/lib/platforms";
import type { Clip } from "@/lib/types";
import { cn } from "@/lib/utils";

type Decision = "approved" | "rejected";

export function ReviewQueue({ clips, total, initialClipId }: { clips: Clip[]; total: number; initialClipId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Clips decided in this session are hidden immediately (optimistic), even
  // before the server re-renders the list without them.
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});
  const queue = useMemo(
    () => clips.filter((c) => !decided.has(c.id)).map((c) => (c.id in favOverride ? { ...c, is_favorite: favOverride[c.id] } : c)),
    [clips, decided, favOverride],
  );

  const [currentId, setCurrentId] = useState<string | null>(initialClipId ?? clips[0]?.id ?? null);
  const indexRef = useRef(0);
  const currentIndex = queue.findIndex((c) => c.id === currentId);
  if (currentIndex >= 0) indexRef.current = currentIndex;
  // If the current clip left the queue, fall back to whatever is now at its position
  const current = currentIndex >= 0 ? queue[currentIndex] : queue[Math.min(indexRef.current, queue.length - 1)] ?? null;
  const idx = current ? queue.indexOf(current) : -1;

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!current) return;
    listRef.current?.querySelector(`[data-clip-id="${current.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const go = useCallback(
    (delta: number) => {
      if (!queue.length) return;
      const next = queue[Math.min(queue.length - 1, Math.max(0, idx + delta))];
      setCurrentId(next.id);
    },
    [queue, idx],
  );

  const decide = useCallback(
    async (clip: Clip, status: Decision) => {
      const nextClip = queue[idx + 1] ?? queue[idx - 1] ?? null;
      setDecided((s) => new Set(s).add(clip.id));
      setCurrentId(nextClip?.id ?? null);
      const res = await setReviewStatusAction([clip.id], status);
      if (!res.ok) {
        toast.error(res.error);
        setDecided((s) => {
          const n = new Set(s);
          n.delete(clip.id);
          return n;
        });
        return;
      }
      toast.success(status === "approved" ? "Approved" : "Rejected", {
        description: clip.title,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await setReviewStatusAction([clip.id], "pending");
            if (!undo.ok) return toast.error(undo.error);
            setDecided((s) => {
              const n = new Set(s);
              n.delete(clip.id);
              return n;
            });
            setCurrentId(clip.id);
            router.refresh();
          },
        },
      });
    },
    [queue, idx, router],
  );

  const saveForLater = useCallback(
    async (clip: Clip) => {
      const fav = !clip.is_favorite;
      setFavOverride((o) => ({ ...o, [clip.id]: fav }));
      const res = await setFavoriteAction([clip.id], fav);
      if (!res.ok) {
        setFavOverride((o) => ({ ...o, [clip.id]: !fav }));
        return toast.error(res.error);
      }
      toast.success(fav ? "Saved for later (favorites)" : "Removed from favorites");
      if (fav) go(1);
    },
    [go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (!current) return;
      const key = e.key.toLowerCase();
      if (key === "a") void decide(current, "approved");
      else if (key === "r") void decide(current, "rejected");
      else if (key === "s") void saveForLater(current);
      else if (key === "n" || e.key === "ArrowDown" || e.key === "j") go(1);
      else if (key === "p" || e.key === "ArrowUp" || e.key === "k") go(-1);
      else if (key === "o") window.open(current.original_url, "_blank", "noopener,noreferrer");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, decide, saveForLater, go]);

  const sort = params.get("sort") ?? "score_desc";
  // Clips beyond the loaded batch + what's still visible locally
  const remaining = queue.length + Math.max(0, total - clips.length);

  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* Queue list */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <span className="text-sm font-medium">
            {Math.max(0, remaining)} <span className="font-normal text-muted-foreground">awaiting review</span>
          </span>
          <Select
            value={sort}
            onChange={(e) => {
              const sp = new URLSearchParams(params.toString());
              sp.set("sort", e.target.value);
              sp.delete("clip");
              router.replace(`${pathname}?${sp.toString()}`);
            }}
            className="h-7 w-36 text-xs"
            aria-label="Queue order"
          >
            <option value="score_desc">Highest score</option>
            <option value="discovered_desc">Newest first</option>
            <option value="views_desc">Most viewed</option>
          </Select>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {queue.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Inbox className="size-7" />
              Queue is empty.
            </div>
          )}
          {queue.map((c) => (
            <button
              key={c.id}
              data-clip-id={c.id}
              type="button"
              onClick={() => setCurrentId(c.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-white/[0.04]",
                current?.id === c.id && "bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/10",
              )}
            >
              <ClipThumbnail clip={c} size="sm" showPlatform={false} className="w-24 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs font-medium leading-snug">{c.title}</p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <PlatformBadge platform={c.platform} compact />
                  <span className="truncate">{formatCount(c.views)} views</span>
                </div>
              </div>
              <ScoreBadge score={c.viral_score} className="shrink-0" />
            </button>
          ))}
          {total > clips.length && (
            <p className="p-3 text-center text-[11px] text-muted-foreground">
              Showing the first {clips.length}. Decide on these to load more.
            </p>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="min-h-0 overflow-y-auto rounded-xl border bg-card">
        {!current ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="size-6 text-emerald-400" />
            </div>
            <p className="font-medium">All caught up</p>
            <p className="max-w-sm text-sm text-muted-foreground">No clips are waiting for review. Add a clip by URL, or check your approved clips.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/approved">View approved clips</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4 p-4 lg:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <h2 className="text-lg font-semibold leading-tight">{current.title}</h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <PlatformBadge platform={current.platform} />
                  {current.creator_url ? (
                    <a href={current.creator_url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                      {current.creator_name ?? "Unknown creator"}
                    </a>
                  ) : (
                    <span>{current.creator_name ?? "Unknown creator"}</span>
                  )}
                  {current.category && <span>· {current.category}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Button size="icon-sm" variant="outline" onClick={() => go(-1)} disabled={idx <= 0} aria-label="Previous clip (P)">
                  <ChevronLeft />
                </Button>
                <span className="px-1 tabular-nums">
                  {idx + 1} / {queue.length}
                </span>
                <Button size="icon-sm" variant="outline" onClick={() => go(1)} disabled={idx >= queue.length - 1} aria-label="Next clip (N)">
                  <ChevronRight />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-3">
                <EmbedPlayer clip={current} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="success" onClick={() => decide(current, "approved")}>
                    <Check /> Approve <Kbd>A</Kbd>
                  </Button>
                  <Button variant="secondary" className="hover:bg-red-500/20 hover:text-red-200" onClick={() => decide(current, "rejected")}>
                    <X /> Reject <Kbd>R</Kbd>
                  </Button>
                  <Button variant="outline" onClick={() => saveForLater(current)} aria-pressed={current.is_favorite}>
                    <Star className={cn(current.is_favorite && "fill-amber-400 text-amber-400")} />
                    {current.is_favorite ? "Saved" : "Save for later"} <Kbd>S</Kbd>
                  </Button>
                  <DownloadButton clip={current} />
                  <Button asChild variant="ghost" className="ml-auto">
                    <a href={current.original_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Open on {PLATFORM_META[current.platform].label}
                    </a>
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ScoreBadge score={current.viral_score} showLabel />
                  <ReviewBadge status={current.review_status} />
                </div>
                <ClipStats clip={current} className="grid-cols-2" />
                <dl className="space-y-1.5 text-xs">
                  <Row k="Uploaded" v={current.uploaded_at ? `${formatDateTime(current.uploaded_at)} (${timeAgo(current.uploaded_at)})` : "Unknown"} />
                  <Row k="Discovered" v={`${formatDateTime(current.discovered_at)} (${timeAgo(current.discovered_at)})`} />
                  <Row k="Source" v={current.source === "manual" ? "Manual submission" : "Automated discovery"} />
                  <Row
                    k="Original URL"
                    v={
                      <a href={current.original_url} target="_blank" rel="noopener noreferrer" className="break-all text-violet-300 hover:underline">
                        {current.original_url}
                      </a>
                    }
                  />
                </dl>
                <div className="space-y-1.5 rounded-lg border bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Rights / permission</span>
                    <RightsBadge status={current.rights_status} />
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{RIGHTS_HINT[current.rights_status]}</p>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-medium">Internal notes</h3>
                  <NotesPanel key={current.id} clipId={current.id} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
              <Keyboard className="size-3.5" />
              <span><Kbd>A</Kbd> approve</span>
              <span><Kbd>R</Kbd> reject</span>
              <span><Kbd>S</Kbd> save for later</span>
              <span><Kbd>N</Kbd>/<Kbd>P</Kbd> next / previous</span>
              <span><Kbd>O</Kbd> open original</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-0.5 rounded border border-white/15 bg-black/30 px-1 font-mono text-[10px] font-medium leading-4 text-current opacity-80">
      {children}
    </kbd>
  );
}
