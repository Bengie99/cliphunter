"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmbedUrl, PLATFORM_META } from "@/lib/platforms";
import type { Clip } from "@/lib/types";
import { cn } from "@/lib/utils";

export function isVerticalClip(clip: Pick<Clip, "platform" | "original_url">) {
  return clip.platform === "tiktok" || clip.platform === "instagram" || clip.original_url.includes("/shorts/");
}

/**
 * Plays a clip through the platform's official embed player. No video is
 * proxied or downloaded. Falls back to a link-out when no embed exists.
 */
export function EmbedPlayer({
  clip,
  className,
}: {
  clip: Pick<Clip, "id" | "platform" | "external_clip_id" | "original_url" | "title">;
  className?: string;
}) {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => setHost(window.location.hostname), []);

  const vertical = isVerticalClip(clip);
  const isDemo = clip.external_clip_id.startsWith("demo-");
  const src = host && !isDemo ? getEmbedUrl(clip.platform, clip.external_clip_id, host) : null;

  return (
    <div
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-lg border bg-black",
        vertical ? "aspect-[9/16] max-h-[70vh] max-w-[min(100%,calc(70vh*9/16))]" : "aspect-video",
        className,
      )}
    >
      {src ? (
        <iframe
          key={src}
          src={src}
          title={clip.title}
          className="absolute inset-0 size-full"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : host === null ? null : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <MonitorPlay className="size-8 text-muted-foreground" />
          <p className="max-w-xs text-sm text-muted-foreground">
            {isDemo
              ? "This is a sample clip from demo data — there's no real video behind it."
              : `${PLATFORM_META[clip.platform].label} doesn't offer an embeddable player for this content.`}
          </p>
          {!isDemo && (
            <Button asChild variant="outline" size="sm">
              <a href={clip.original_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open on {PLATFORM_META[clip.platform].label}
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
