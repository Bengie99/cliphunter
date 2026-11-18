import "server-only";
import { isShortLink, parseClipUrl, type ParsedClipUrl } from "../platforms";

export interface UrlMetadata {
  parsed: ParsedClipUrl;
  title: string | null;
  creatorName: string | null;
  creatorUrl: string | null;
  thumbnailUrl: string | null;
  /** Where the metadata came from, shown to the user. */
  source: "oembed" | "url";
  warning: string | null;
}

const TIMEOUT_MS = 6000;

/** Follow a short-link redirect (only for allow-listed short-link hosts). */
async function resolveShortLink(raw: string): Promise<string> {
  const res = await fetch(raw, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.url;
}

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

async function fetchOEmbed(endpoint: string): Promise<OEmbed | null> {
  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as OEmbed;
}

/**
 * Turn a pasted URL into prefilled clip metadata.
 *
 * Uses only public, keyless oEmbed endpoints (YouTube, TikTok). Twitch, Kick
 * and Instagram need API credentials for metadata — those arrive with the
 * Phase 2 integrations; until then the user fills in details by hand.
 */
export async function lookupClipUrl(raw: string): Promise<{ ok: true; data: UrlMetadata } | { ok: false; error: string }> {
  let url = raw.trim();
  if (isShortLink(url)) {
    try {
      url = await resolveShortLink(url);
    } catch {
      return { ok: false, error: "Couldn't resolve that short link. Paste the full video URL instead." };
    }
  }

  const parsed = parseClipUrl(url);
  if (!parsed) {
    return {
      ok: false,
      error: "Unrecognised URL. Supported: Twitch clips/VODs, YouTube videos/Shorts, Kick clips, TikTok videos, Instagram Reels.",
    };
  }

  const base: UrlMetadata = {
    parsed,
    title: null,
    creatorName: parsed.creatorHandle,
    creatorUrl: parsed.creatorUrl,
    thumbnailUrl: null,
    source: "url",
    warning: null,
  };

  const endpoint =
    parsed.platform === "youtube"
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(parsed.canonicalUrl)}`
      : parsed.platform === "tiktok"
        ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}`
        : null;

  if (!endpoint) {
    base.warning = "Automatic metadata for this platform needs its API integration (Phase 2). Fill in the details below.";
    return { ok: true, data: base };
  }

  try {
    const o = await fetchOEmbed(endpoint);
    if (!o) {
      base.warning = "The platform didn't return metadata (the video may be private, removed or region-locked).";
      return { ok: true, data: base };
    }
    return {
      ok: true,
      data: {
        ...base,
        title: o.title?.trim() || null,
        creatorName: o.author_name?.trim() || base.creatorName,
        creatorUrl: o.author_url || base.creatorUrl,
        thumbnailUrl: o.thumbnail_url || null,
        source: "oembed",
      },
    };
  } catch {
    base.warning = "Metadata lookup timed out. You can still fill in the details manually.";
    return { ok: true, data: base };
  }
}
