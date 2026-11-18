import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DOWNLOAD_LABEL, REVIEW_LABEL, RIGHTS_HINT, RIGHTS_LABEL } from "@/lib/format";
import { PLATFORM_META } from "@/lib/platforms";
import { SCORE_TIER_META, scoreTier } from "@/lib/scoring";
import type { DownloadStatus, Platform, ReviewStatus, RightsStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PlatformBadge({ platform, className, compact }: { platform: Platform; className?: string; compact?: boolean }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[11px] font-medium leading-none text-zinc-100 backdrop-blur",
        className,
      )}
      title={meta.label}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {compact ? meta.short : meta.label}
    </span>
  );
}

export function ScoreBadge({ score, className, showLabel }: { score: number | null; className?: string; showLabel?: boolean }) {
  const tier = scoreTier(score);
  if (!tier) {
    return (
      <span className={cn("inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground", className)} title="Not enough metrics to score yet">
        No score
      </span>
    );
  }
  const meta = SCORE_TIER_META[tier];
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none", meta.className, className)}
      title={`Viral score ${score} — ${meta.label}`}
    >
      {tier === "viral" && <Flame className="size-3" />}
      {score}
      {showLabel && <span className="font-normal opacity-80">· {meta.label}</span>}
    </span>
  );
}

const REVIEW_VARIANT: Record<ReviewStatus, "warning" | "success" | "danger" | "outline"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  archived: "outline",
};

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <Badge variant={REVIEW_VARIANT[status]}>{REVIEW_LABEL[status]}</Badge>;
}

export function RightsBadge({ status }: { status: RightsStatus }) {
  const variant = status === "republish_authorized" || status === "download_authorized" ? "success" : status === "unknown" ? "outline" : "secondary";
  return (
    <Badge variant={variant} title={RIGHTS_HINT[status]}>
      {RIGHTS_LABEL[status]}
    </Badge>
  );
}

export function DownloadBadge({ status }: { status: DownloadStatus }) {
  const variant = status === "downloaded" ? "success" : status === "failed" ? "danger" : "outline";
  return <Badge variant={variant}>{DOWNLOAD_LABEL[status]}</Badge>;
}
