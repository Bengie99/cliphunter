"use client";

import { useState } from "react";
import { Film, Play } from "lucide-react";
import { formatDuration } from "@/lib/format";
import type { Clip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlatformBadge } from "./badges";

// Deterministic gradient for clips without a thumbnail.
function gradientFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 40 + (h % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 45% 22%), hsl(${b} 55% 12%))`;
}

export function ClipThumbnail({
  clip,
  onPlay,
  className,
  showPlatform = true,
  size = "md",
}: {
  clip: Pick<Clip, "id" | "thumbnail_url" | "duration_seconds" | "platform" | "title">;
  onPlay?: () => void;
  className?: string;
  showPlatform?: boolean;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const hasImage = clip.thumbnail_url && !failed;

  return (
    <div
      className={cn("group/thumb relative aspect-video overflow-hidden rounded-lg bg-muted", className)}
      style={hasImage ? undefined : { background: gradientFor(clip.id) }}
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={clip.thumbnail_url!}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03]"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Film className={cn("text-white/25", size === "sm" ? "size-5" : "size-8")} />
        </div>
      )}
      {showPlatform && size === "md" && <PlatformBadge platform={clip.platform} className="absolute left-2 top-2" />}
      {clip.duration_seconds != null && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatDuration(clip.duration_seconds)}
        </span>
      )}
      {onPlay && (
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Preview ${clip.title}`}
          className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all hover:bg-black/40 group-hover/thumb:opacity-100 focus-visible:opacity-100"
        >
          <span className={cn("flex items-center justify-center rounded-full bg-white/90 text-black shadow-lg", size === "sm" ? "size-7" : "size-11")}>
            <Play className={cn("fill-current", size === "sm" ? "size-3.5" : "size-5")} />
          </span>
        </button>
      )}
    </div>
  );
}
