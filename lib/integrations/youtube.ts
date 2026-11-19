import "server-only";

/**
 * Minimal YouTube Data API v3 client (API key, public data only).
 * Quota (default 10,000 units/day): channels/playlistItems/videos = 1 unit,
 * search = 100 units. https://developers.google.com/youtube/v3/determine_quota_cost
 */

const API = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly quotaExceeded = false,
  ) {
    super(message);
  }
}

export function youtubeConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

export interface YouTubeChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  uploadsPlaylistId: string;
  description: string;
}

export interface YouTubeVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: string;
  durationSeconds: number;
  thumbnail: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  language: string | null;
  live: boolean;
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new YouTubeError("YOUTUBE_API_KEY is not set.");
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[]; message?: string } } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new YouTubeError("YouTube daily quota used up — discovery resumes after midnight Pacific time.", true);
    }
    if (res.status >= 500 || reason === "rateLimitExceeded") {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    // Never echo the URL: it contains the API key.
    throw new YouTubeError(`YouTube ${path} failed (HTTP ${res.status}${reason ? `, ${reason}` : ""}).`);
  }
  throw new YouTubeError(`YouTube ${path} failed after retries.`);
}

/** "PT1M5S" -> 65. Returns 0 for live/upcoming ("P0D"). */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Math.round(Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0));
}

type Thumbs = Record<string, { url: string } | undefined>;
const bestThumb = (t: Thumbs | undefined) => t?.maxres?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? null;

interface ChannelItem {
  id: string;
  snippet: { title: string; customUrl?: string; description?: string; thumbnails?: Thumbs };
  contentDetails: { relatedPlaylists: { uploads: string } };
}

const toChannel = (c: ChannelItem): YouTubeChannel => ({
  id: c.id,
  title: c.snippet.title,
  handle: c.snippet.customUrl?.replace(/^@/, "") ?? null,
  thumbnail: bestThumb(c.snippet.thumbnails),
  uploadsPlaylistId: c.contentDetails.relatedPlaylists.uploads,
  description: c.snippet.description ?? "",
});

/** Resolve one @handle (without the @). 1 unit. */
export async function getChannelByHandle(handle: string): Promise<YouTubeChannel | null> {
  const body = await call<{ items?: ChannelItem[] }>("channels", { part: "snippet,contentDetails", forHandle: `@${handle}` });
  return body.items?.[0] ? toChannel(body.items[0]) : null;
}

/** Resolve up to 50 channel ids. 1 unit. */
export async function getChannelsById(ids: string[]): Promise<YouTubeChannel[]> {
  if (ids.length === 0) return [];
  const body = await call<{ items?: ChannelItem[] }>("channels", { part: "snippet,contentDetails", id: ids.slice(0, 50).join(","), maxResults: "50" });
  return (body.items ?? []).map(toChannel);
}

/** Newest video ids in an uploads playlist published after `since`. 1 unit per page of 50. */
export async function getRecentUploadIds(playlistId: string, since: Date, maxPages = 2): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body = await call<{
      items?: { contentDetails: { videoId: string; videoPublishedAt?: string } }[];
      nextPageToken?: string;
    }>("playlistItems", { part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    const items = body.items ?? [];
    let reachedOld = false;
    for (const it of items) {
      const at = it.contentDetails.videoPublishedAt;
      if (at && new Date(at) < since) reachedOld = true;
      else ids.push(it.contentDetails.videoId);
    }
    // Uploads playlists are newest-first, so stop once we pass the window.
    if (reachedOld || !body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return ids;
}

/** Keyword search for short videos, most-viewed first. 100 units. */
export async function searchShortVideoIds(query: string, since: Date, opts: { language?: string } = {}): Promise<string[]> {
  const body = await call<{ items?: { id: { videoId?: string } }[] }>("search", {
    part: "id",
    type: "video",
    q: query,
    videoDuration: "short", // under 4 minutes
    order: "viewCount",
    publishedAfter: since.toISOString(),
    maxResults: "50",
    ...(opts.language ? { relevanceLanguage: opts.language } : {}),
  });
  return (body.items ?? []).map((i) => i.id.videoId).filter((id): id is string => Boolean(id));
}

/** Full details for up to any number of ids (batched by 50, 1 unit per batch). */
export async function getVideos(ids: string[]): Promise<YouTubeVideo[]> {
  const out: YouTubeVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await call<{
      items?: {
        id: string;
        snippet: {
          channelId: string;
          channelTitle: string;
          title: string;
          description?: string;
          tags?: string[];
          publishedAt: string;
          thumbnails?: Thumbs;
          defaultAudioLanguage?: string;
          defaultLanguage?: string;
          liveBroadcastContent?: string;
        };
        contentDetails: { duration: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }[];
    }>("videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: "50" });
    for (const v of body.items ?? []) {
      const n = (s?: string) => (s == null ? null : Number(s));
      out.push({
        id: v.id,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        title: v.snippet.title,
        description: v.snippet.description ?? "",
        tags: v.snippet.tags ?? [],
        publishedAt: v.snippet.publishedAt,
        durationSeconds: parseIsoDuration(v.contentDetails.duration),
        thumbnail: bestThumb(v.snippet.thumbnails),
        views: n(v.statistics?.viewCount),
        likes: n(v.statistics?.likeCount),
        comments: n(v.statistics?.commentCount),
        language: (v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? "").split("-")[0] || null,
        live: (v.snippet.liveBroadcastContent ?? "none") !== "none",
      });
    }
  }
  return out;
}
