"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Download, ExternalLink, HardDriveDownload, Loader2, RotateCcw, Star, X } from "lucide-react";
import { toast } from "sonner";
import { cancelDownloadAction, queueDownloadsAction } from "@/app/download-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
 * Queues an authorized clip for the download helper on the user's PC.
 * Clips without creator permission stay disabled, with the reason as tooltip.
 */
const SKIP_CONFIRM_KEY = "cliphunter:skip-transformative-confirm";

export function DownloadButton({ clip, size = "sm" }: { clip: Clip; size?: "sm" | "icon-sm" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const authorized =
    clip.rights_status === "download_authorized" ||
    clip.rights_status === "republish_authorized" ||
    clip.rights_status === "transformative_use";
  const status = clip.download_status;

  const queue = (withoutPermission: boolean) =>
    start(async () => {
      const res = await queueDownloadsAction([clip.id], { withoutPermission });
      if (!res.ok) toast.error(res.error);
      else if (res.data.queued === 0) toast.warning("This clip couldn't be queued.");
      else {
        toast.success("Queued — the download helper on your PC will pick it up.");
        router.refresh();
      }
    });

  const askThenQueue = () => {
    let skip = false;
    try {
      skip = localStorage.getItem(SKIP_CONFIRM_KEY) === "1";
    } catch {
      /* storage unavailable — just ask */
    }
    if (skip) queue(true);
    else setConfirmOpen(true);
  };

  const state: { label: string; title: string; icon: React.ReactNode; disabled: boolean; onClick?: () => void } = !authorized
    ? {
        label: "Download",
        title: "No permission on file — you'll be asked to confirm transformative use.",
        icon: <Download />,
        disabled: pending,
        onClick: askThenQueue,
      }
    : status === "queued"
      ? {
          label: "Queued",
          title: "Waiting for the download helper (npm run worker). Click to cancel.",
          icon: <Clock />,
          disabled: pending,
          onClick: () =>
            start(async () => {
              const res = await cancelDownloadAction(clip.id);
              if (!res.ok) toast.error(res.error);
              else router.refresh();
            }),
        }
      : status === "downloading"
        ? { label: "Downloading", title: "The helper is downloading this clip.", icon: <Loader2 className="animate-spin" />, disabled: true }
        : status === "downloaded"
          ? { label: "Edit", title: "Downloaded — open it in the editor.", icon: <HardDriveDownload />, disabled: false, onClick: () => router.push(`/editor/${clip.id}`) }
          : {
              label: status === "failed" ? "Retry" : "Download",
              title: status === "failed" ? "The last download failed — click to retry. Details on Downloaded Footage." : "Queue this clip for download",
              icon: status === "failed" ? <RotateCcw /> : <Download />,
              disabled: pending,
              onClick: () => queue(false),
            };

  return (
    <>
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download without permission?</DialogTitle>
          <DialogDescription>
            {clip.creator_name ?? "This creator"} hasn&apos;t granted permission. The clip will be marked{" "}
            <span className="font-medium text-amber-300">Transformative use</span> so you can always see which footage has no
            permission behind it.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Edit it substantially (your own hook, captions, cuts, commentary). A straight re-upload is the most likely to get claimed.</li>
          <li>Mute or replace background music: Content ID flags it regardless of edits.</li>
          <li>If the creator asks you to take it down, remove it. Three copyright strikes and YouTube deletes the channel.</li>
        </ul>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={dontAsk} onCheckedChange={(v) => setDontAsk(v === true)} />
          Don&apos;t ask again on this browser
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (dontAsk) {
                try {
                  localStorage.setItem(SKIP_CONFIRM_KEY, "1");
                } catch {
                  /* ignore */
                }
              }
              setConfirmOpen(false);
              queue(true);
            }}
          >
            <Download /> Download for transformative use
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <span title={state.title} className="inline-flex">
      <Button
        size={size}
        variant="ghost"
        disabled={state.disabled}
        onClick={state.onClick}
        aria-label={state.label}
        className={cn(status === "downloaded" && authorized && "text-emerald-300", status === "failed" && authorized && "text-red-300")}
      >
        {pending ? <Loader2 className="animate-spin" /> : state.icon}
        {size === "sm" && state.label}
      </Button>
    </span>
    </>
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
