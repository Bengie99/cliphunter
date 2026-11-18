"use client";

import { Check, ExternalLink, Eye, MessageSquareText, RotateCcw, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCount, formatDuration, timeAgo } from "@/lib/format";
import type { Clip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlatformBadge, ReviewBadge, ScoreBadge } from "./badges";
import { DownloadButton } from "./clip-dialogs";
import { ClipThumbnail } from "./thumbnail";
import { useClipActions } from "./use-clip-actions";

export interface ClipItemProps {
  clip: Clip;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onPreview: () => void;
  onNotes: () => void;
}

function ReviewButtons({ clip, compact }: { clip: Clip; compact?: boolean }) {
  const { setReview, isPending } = useClipActions();
  const size = compact ? "icon-sm" : "sm";
  if (clip.review_status === "rejected" || clip.review_status === "archived") {
    return (
      <Button size={size} variant="ghost" disabled={isPending} onClick={() => setReview([clip.id], "pending")} title="Restore to review queue">
        <RotateCcw />
        {!compact && "Restore"}
      </Button>
    );
  }
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        className="hover:bg-emerald-500/15 hover:text-emerald-300"
        disabled={isPending || clip.review_status === "approved"}
        onClick={() => setReview([clip.id], "approved")}
        title="Approve"
        aria-label="Approve"
      >
        <Check />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="hover:bg-red-500/15 hover:text-red-300"
        disabled={isPending}
        onClick={() => setReview([clip.id], "rejected")}
        title="Reject"
        aria-label="Reject"
      >
        <X />
      </Button>
    </>
  );
}

function FavoriteButton({ clip, className }: { clip: Clip; className?: string }) {
  const { setFavorite, isPending } = useClipActions();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={isPending}
      onClick={() => setFavorite([clip.id], !clip.is_favorite)}
      title={clip.is_favorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={clip.is_favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={clip.is_favorite}
      className={className}
    >
      <Star className={cn(clip.is_favorite && "fill-amber-400 text-amber-400")} />
    </Button>
  );
}

function NotesButton({ clip, onNotes }: { clip: Clip; onNotes: () => void }) {
  return (
    <Button size="icon-sm" variant="ghost" onClick={onNotes} title="Notes" aria-label="Notes" className="relative">
      <MessageSquareText />
      {clip.note_count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
          {clip.note_count}
        </span>
      )}
    </Button>
  );
}

function OpenOriginal({ clip }: { clip: Clip }) {
  return (
    <Button asChild size="icon-sm" variant="ghost" title="Open original" aria-label="Open original">
      <a href={clip.original_url} target="_blank" rel="noopener noreferrer">
        <ExternalLink />
      </a>
    </Button>
  );
}

export function ClipCard({ clip, selected, onSelectedChange, onPreview, onNotes }: ClipItemProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-zinc-600",
        selected && "border-primary/70 ring-1 ring-primary/40",
      )}
    >
      <div className="relative p-2 pb-0">
        <ClipThumbnail clip={clip} onPlay={onPreview} />
        <div className={cn("absolute left-4 top-4 z-10 opacity-0 transition-opacity group-hover:opacity-100", selected && "opacity-100")}>
          <Checkbox checked={selected} onCheckedChange={(v) => onSelectedChange(v === true)} aria-label="Select clip" className="bg-black/60" />
        </div>
        <div className="absolute right-3.5 top-3.5 z-10 flex items-center gap-1">
          <ScoreBadge score={clip.viral_score} className="bg-black/70 backdrop-blur" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 pt-2.5">
        <button type="button" onClick={onPreview} className="text-left">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug hover:text-violet-300">{clip.title}</h3>
        </button>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{clip.creator_name ?? "Unknown creator"}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3" /> {formatCount(clip.views)}
          </span>
          <span>·</span>
          <span title={clip.uploaded_at ?? undefined}>{clip.uploaded_at ? timeAgo(clip.uploaded_at) : "upload date unknown"}</span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-1 pt-1.5">
          <ReviewBadge status={clip.review_status} />
          <div className="flex items-center">
            <ReviewButtons clip={clip} compact />
            <FavoriteButton clip={clip} />
            <NotesButton clip={clip} onNotes={onNotes} />
            <OpenOriginal clip={clip} />
            <DownloadButton clip={clip} size="icon-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClipRow({ clip, selected, onSelectedChange, onPreview, onNotes }: ClipItemProps) {
  return (
    <div
      className={cn(
        "group grid grid-cols-[auto_112px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 transition-colors last:border-b-0 hover:bg-white/[0.02] md:grid-cols-[auto_112px_minmax(0,1fr)_90px_70px_64px_110px_auto]",
        selected && "bg-primary/5",
      )}
    >
      <Checkbox checked={selected} onCheckedChange={(v) => onSelectedChange(v === true)} aria-label="Select clip" />
      <ClipThumbnail clip={clip} onPlay={onPreview} size="sm" showPlatform={false} className="w-28 rounded-md" />
      <div className="min-w-0">
        <button type="button" onClick={onPreview} className="block max-w-full text-left">
          <p className="truncate text-sm font-medium hover:text-violet-300">{clip.title}</p>
        </button>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <PlatformBadge platform={clip.platform} compact />
          <span className="truncate">{clip.creator_name ?? "Unknown creator"}</span>
          <span className="hidden sm:inline">· {clip.uploaded_at ? timeAgo(clip.uploaded_at) : "—"}</span>
        </div>
      </div>
      <span className="hidden text-sm tabular-nums md:block">{formatCount(clip.views)}</span>
      <span className="hidden text-sm tabular-nums text-muted-foreground md:block">{formatDuration(clip.duration_seconds)}</span>
      <span className="hidden md:block">
        <ScoreBadge score={clip.viral_score} />
      </span>
      <span className="hidden md:block">
        <ReviewBadge status={clip.review_status} />
      </span>
      <div className="flex items-center justify-end">
        <ReviewButtons clip={clip} compact />
        <FavoriteButton clip={clip} />
        <NotesButton clip={clip} onNotes={onNotes} />
        <OpenOriginal clip={clip} />
        <DownloadButton clip={clip} size="icon-sm" />
      </div>
    </div>
  );
}
