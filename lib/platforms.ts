import type { Platform } from "./types";

export interface PlatformMeta {
  label: string;
  /** Brand color used only for small badges/accents. */
  color: string;
  /** Short abbreviation shown in compact badges. */
  short: string;
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  twitch: { label: "Twitch", color: "#9146FF", short: "TW" },
  youtube: { label: "YouTube", color: "#FF0033", short: "YT" },
  kick: { label: "Kick", color: "#53FC18", short: "KK" },
  tiktok: { label: "TikTok", color: "#25F4EE", short: "TT" },
  instagram: { label: "Instagram", color: "#E1306C", short: "IG" },
};

export interface ParsedClipUrl {
  platform: Platform;
  externalId: string;
  /** Canonical URL we store as original_url. */
  canonicalUrl: string;
  /** Channel / handle if it can be read from the URL itself. */
  creatorHandle: string | null;
  creatorUrl: string | null;
  kind: "clip" | "short" | "video" | "reel" | "post";
}

function stripWww(host: string) {
  return host.replace(/^(www\.|m\.)/, "").toLowerCase();
}

/**
 * Parse a pasted URL into platform + external id. Pure string parsing — no
 * network access. Returns null if the URL is not a recognised clip/video URL.
 */
export function parseClipUrl(raw: string): ParsedClipUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = stripWww(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);

  // ---- Twitch -------------------------------------------------------------
  if (host === "clips.twitch.tv" && parts[0] && parts[0] !== "embed") {
    const slug = parts[0];
    return {
      platform: "twitch",
      externalId: slug,
      canonicalUrl: `https://clips.twitch.tv/${slug}`,
      creatorHandle: null,
      creatorUrl: null,
      kind: "clip",
    };
  }
  if (host === "twitch.tv") {
    if (parts.length >= 3 && parts[1] === "clip") {
      const [channel, , slug] = parts;
      return {
        platform: "twitch",
        externalId: slug,
        canonicalUrl: `https://www.twitch.tv/${channel}/clip/${slug}`,
        creatorHandle: channel,
        creatorUrl: `https://www.twitch.tv/${channel}`,
        kind: "clip",
      };
    }
    if (parts[0] === "videos" && parts[1]) {
      return {
        platform: "twitch",
        externalId: `v${parts[1]}`,
        canonicalUrl: `https://www.twitch.tv/videos/${parts[1]}`,
        creatorHandle: null,
        creatorUrl: null,
        kind: "video",
      };
    }
  }

  // ---- YouTube ------------------------------------------------------------
  if (host === "youtu.be" && parts[0]) {
    return yt(parts[0], "video");
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (parts[0] === "shorts" && parts[1]) return yt(parts[1], "short");
    if (parts[0] === "watch") {
      const v = url.searchParams.get("v");
      if (v) return yt(v, "video");
    }
    if ((parts[0] === "embed" || parts[0] === "live") && parts[1]) return yt(parts[1], "video");
  }

  // ---- Kick ---------------------------------------------------------------
  if (host === "kick.com" && parts[0]) {
    const channel = parts[0];
    const clipParam = url.searchParams.get("clip");
    const clipId = parts[1] === "clips" && parts[2] ? parts[2] : clipParam;
    if (clipId) {
      return {
        platform: "kick",
        externalId: clipId,
        canonicalUrl: `https://kick.com/${channel}/clips/${clipId}`,
        creatorHandle: channel,
        creatorUrl: `https://kick.com/${channel}`,
        kind: "clip",
      };
    }
  }

  // ---- TikTok -------------------------------------------------------------
  if (host === "tiktok.com" && parts[0]?.startsWith("@") && parts[1] === "video" && parts[2]) {
    const handle = parts[0].slice(1);
    return {
      platform: "tiktok",
      externalId: parts[2],
      canonicalUrl: `https://www.tiktok.com/@${handle}/video/${parts[2]}`,
      creatorHandle: handle,
      creatorUrl: `https://www.tiktok.com/@${handle}`,
      kind: "short",
    };
  }

  // ---- Instagram ----------------------------------------------------------
  if (host === "instagram.com") {
    const idx = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p");
    if (idx >= 0 && parts[idx + 1]) {
      const id = parts[idx + 1];
      const kind = parts[idx] === "p" ? "post" : "reel";
      return {
        platform: "instagram",
        externalId: id,
        canonicalUrl: `https://www.instagram.com/${kind === "post" ? "p" : "reel"}/${id}/`,
        creatorHandle: idx > 0 ? parts[0] : null,
        creatorUrl: idx > 0 ? `https://www.instagram.com/${parts[0]}/` : null,
        kind,
      };
    }
  }

  return null;
}

function yt(id: string, kind: "short" | "video"): ParsedClipUrl {
  return {
    platform: "youtube",
    externalId: id,
    canonicalUrl: kind === "short" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    creatorHandle: null,
    creatorUrl: null,
    kind,
  };
}

/** Short-link hosts that must be resolved (redirect followed) before parsing. */
export function isShortLink(raw: string): boolean {
  try {
    const host = stripWww(new URL(raw.trim()).hostname);
    return host === "vm.tiktok.com" || host === "vt.tiktok.com";
  } catch {
    return false;
  }
}

/**
 * Official embed player URL for previews. Embeds are the platform-sanctioned
 * way to play content inside another site; we never proxy or download video.
 * Returns null when the platform offers no embeddable player for this content.
 */
export function getEmbedUrl(platform: Platform, externalId: string, parentHost: string): string | null {
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/embed/${encodeURIComponent(externalId)}?rel=0`;
    case "twitch":
      if (externalId.startsWith("v") && /^v\d+$/.test(externalId)) {
        return `https://player.twitch.tv/?video=${externalId}&parent=${parentHost}&autoplay=false`;
      }
      return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(externalId)}&parent=${parentHost}&autoplay=false`;
    case "tiktok":
      return `https://www.tiktok.com/embed/v2/${encodeURIComponent(externalId)}`;
    case "instagram":
      return `https://www.instagram.com/reel/${encodeURIComponent(externalId)}/embed`;
    case "kick":
      // Kick has no documented embed player for clips.
      return null;
  }
}
