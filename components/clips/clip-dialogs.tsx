"use client";

import { Check, Download, ExternalLink, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCount, formatDate, formatDuration, timeAgo } from "@/lib/format";
import { PLATFORM_META } from "@/lib/platforms";
import type { Clip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlatformBadge, ReviewBadge, RightsBadge, ScoreBadge } from "./badges";
import { EmbedPlayer, isVerticalClip } from "./embed-player";
import { NotesPanel } from "./notes-panel";
import { useClipActions } from "./use-clip-actions";

/**
 * Download is a Phase 4 feature and must only ever be enabled for clips with
 * an authorized source. Until then it is rendered disabled with the reason.
 */
export function DownloadButton({ clip, size = "sm" }: { clip: Clip; size?: "sm" | "icon-sm" }) {
  const reason =
    clip.rights_status === "download_authorized" || clip.rights_status === "republish_authorized"
      ? "Authorized downloads are implemented in Phase 4 (footage management)."
      : "Download unavailable: no authorized download source for this clip.";
  return (
    <span title={reason} className="inline-flex">
      <Button size={size} variant="ghost" disabled aria-label="Download footage (unavailable)">
        <Download />
        {size === "sm" && "Download"}
      </Button>
    </span>
  );
}

export function ClipStats({ clip, className }: { clip: Clip; className?: string }) {
  const engagement =
    clip.views && (clip.likes != null || clip.comments != null)
      ? `${((((clip.likes ?? 0) + (clip.comments ?? 0)) / clip.views) * 100).toFixed(1)}%`
      : "—";
  const items: [string, string][] = [
    ["Views", formatCount(clip.views)],
    ["Likes", formatCount(clip.likes)],
    ["Comments", formatCount(clip.comments)],
    ["Engagement", engagement],
    ["Duration", formatDuration(clip.duration_seconds)],
    ["Uploaded", clip.uploaded_at ? timeAgo(clip.uploaded_at) : "—"],
  ];
  return (
    <dl className={cn("grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="bg-card px-3 py-2">
          <dt className="text-[11px] text-muted-foreground">{k}</dt>
          <dd className="text-sm font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PreviewDialog({ clip, onOpenChange }: { clip: Clip | null; onOpenChange: (open: boolean) => void }) {
  const { setReview, setFavorite, isPending } = useClipActions();
  if (!clip) return null;
  const vertical = isVerticalClip(clip);
  return (
    <Dialog open={!!clip} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-4xl", vertical && "max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>{clip.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <PlatformBadge platform={clip.platform} />
            <span>{clip.creator_name ?? "Unknown creator"}</span>
            <span>·</span>
            <span>Discovered {timeAgo(clip.discovered_at)}</span>
          </DialogDescription>
        </DialogHeader>
        <div className={cn("grid gap-4", vertical && "md:grid-cols-[minmax(0,1fr)_260px]")}>
          <EmbedPlayer clip={clip} />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ScoreBadge score={clip.viral_score} showLabel />
              <ReviewBadge status={clip.review_status} />
              <RightsBadge status={clip.rights_status} />
            </div>
            <ClipStats clip={clip} className={vertical ? "grid-cols-2" : undefined} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button size="sm" variant="success" disabled={isPending || clip.review_status === "approved"} onClick={() => setReview([clip.id], "approved", { onDone: () => onOpenChange(false) })}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={isPending || clip.review_status === "rejected"} onClick={() => setReview([clip.id], "rejected", { onDone: () => onOpenChange(false) })}>
            <X /> Reject
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setFavorite([clip.id], !clip.is_favorite)}>
            <Star className={cn(clip.is_favorite && "fill-amber-400 text-amber-400")} />
            {clip.is_favorite ? "Favorited" : "Favorite"}
          </Button>
          <DownloadButton clip={clip} />
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <a href={clip.original_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open on {PLATFORM_META[clip.platform].label}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NotesDialog({ clip, onOpenChange }: { clip: Clip | null; onOpenChange: (open: boolean) => void }) {
  if (!clip) return null;
  return (
    <Dialog open={!!clip} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription className="line-clamp-1">
            {clip.title} · {formatDate(clip.discovered_at)}
          </DialogDescription>
        </DialogHeader>
        <NotesPanel clipId={clip.id} autoFocus />
      </DialogContent>
    </Dialog>
  );
}
