import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getChannelsById,
  getRecentUploadIds,
  getVideos,
  searchShortVideoIds,
  youtubeConfigured,
  YouTubeError,
  type YouTubeChannel,
} from "../integrations/youtube";
import { chunk, Run, saveClips, touchMonitored, type FoundClip, type RunSummary } from "./common";
import { SEARCH_INTERVAL_HOURS, type DiscoverySettings } from "./settings";

/**
 * YouTube discovery for one owner:
 *   1. new uploads from every monitored channel (uploads playlist, 1 quota unit/page)
 *   2. keyword searches for short videos, at most every SEARCH_INTERVAL_HOURS (100 units each)
 * Videos must mention one of the configured keywords (if any) and fit the length window.
 * YouTube has no "is Short" flag; videos up to 3 minutes are linked as /shorts/.
 */

const SHORTS_MAX_SECONDS = 180;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

export async function runYouTubeDiscovery(
  admin: SupabaseClient,
  settings: DiscoverySettings,
  trigger: "schedule" | "manual",
): Promise<RunSummary> {
  const ownerId = settings.owner_id;
  const run = await Run.start(admin, ownerId, "youtube", trigger);

  try {
    if (!youtubeConfigured()) return await run.fail("YOUTUBE_API_KEY is not set in the environment.");
    const since = new Date(Date.now() - (settings.upload_window_hours ?? 168) * 3_600_000);

    // -- monitored channels ---------------------------------------------------
    const { data: monitored, error: monErr } = await admin
      .from("creators")
      .select("external_creator_id, name")
      .eq("owner_id", ownerId)
      .eq("platform", "youtube")
      .eq("is_monitored", true);
    if (monErr) throw new Error(`Loading monitored channels failed: ${monErr.message}`);

    const channels = new Map<string, YouTubeChannel>();
    for (const batch of chunk((monitored ?? []).map((m) => m.external_creator_id), 50)) {
      (await getChannelsById(batch)).forEach((c) => channels.set(c.id, c));
    }
    for (const m of monitored ?? []) if (!channels.has(m.external_creator_id)) run.warn(`Channel "${m.name}" no longer exists on YouTube.`);

    const ids = new Set<string>();
    const uploads = await Promise.allSettled([...channels.values()].map((c) => getRecentUploadIds(c.uploadsPlaylistId, since)));
    uploads.forEach((r, i) => {
      if (r.status === "fulfilled") r.value.forEach((id) => ids.add(id));
      else run.warn(`${[...channels.values()][i].title}: ${r.reason instanceof Error ? r.reason.message : "request failed"}`);
    });

    // -- keyword search (quota-expensive, rate-limited) ------------------------
    const searchDue =
      settings.search_terms.length > 0 &&
      (trigger === "manual" ||
        !settings.last_search_at ||
        Date.now() - new Date(settings.last_search_at).getTime() >= SEARCH_INTERVAL_HOURS * 3_600_000);
    if (searchDue) {
      for (const term of settings.search_terms) {
        try {
          (await searchShortVideoIds(term, since, { language: settings.languages[0] })).forEach((id) => ids.add(id));
        } catch (err) {
          run.warn(`Search "${term}": ${err instanceof Error ? err.message : "failed"}`);
          if (err instanceof YouTubeError && err.quotaExceeded) break;
        }
      }
      await admin
        .from("discovery_settings")
        .update({ last_search_at: new Date().toISOString() })
        .eq("owner_id", ownerId)
        .eq("platform", "youtube");
    }

    if (channels.size === 0 && !searchDue && settings.search_terms.length === 0) {
      return await run.fail("Nothing to search: add YouTube channels on the Creators page or search terms in the settings.");
    }

    // -- details + filters ----------------------------------------------------
    const videos = await getVideos([...ids]);
    const keywords = settings.categories.map(norm);
    const langs = settings.languages.map((l) => l.toLowerCase());
    const matches = videos
      .map((v) => {
        const haystack = norm(`${v.title} ${v.tags.join(" ")} ${v.description}`);
        const keyword = keywords.length ? settings.categories.find((_, i) => haystack.includes(keywords[i])) : undefined;
        return { v, keyword };
      })
      .filter(
        ({ v, keyword }) =>
          !v.live &&
          v.durationSeconds > 0 &&
          (keywords.length === 0 || keyword) &&
          (settings.minimum_duration == null || v.durationSeconds >= settings.minimum_duration) &&
          (settings.maximum_duration == null || v.durationSeconds <= settings.maximum_duration) &&
          (v.views ?? 0) >= settings.minimum_views &&
          (langs.length === 0 || !v.language || langs.includes(v.language)),
      );

    // channel details for search results from channels we don't monitor (1 unit / 50)
    const unknown = [...new Set(matches.map(({ v }) => v.channelId))].filter((id) => !channels.has(id));
    for (const batch of chunk(unknown, 50)) {
      try {
        (await getChannelsById(batch)).forEach((c) => channels.set(c.id, c));
      } catch {
        /* non-essential: fall back to the channel title from the video */
      }
    }

    const found: FoundClip[] = matches.map(({ v, keyword }) => {
      const ch = channels.get(v.channelId);
      return {
        externalId: v.id,
        creator: {
          externalId: v.channelId,
          name: ch?.title ?? v.channelTitle,
          profileUrl: ch?.handle ? `https://www.youtube.com/@${ch.handle}` : `https://www.youtube.com/channel/${v.channelId}`,
          profileImage: ch?.thumbnail ?? null,
        },
        title: v.title,
        originalUrl:
          v.durationSeconds <= SHORTS_MAX_SECONDS ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
        thumbnailUrl: v.thumbnail,
        durationSeconds: v.durationSeconds,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        category: keyword ?? null,
        language: v.language,
        uploadedAt: v.publishedAt,
      };
    });

    const { added, updated } = await saveClips(admin, run, found);
    await touchMonitored(admin, ownerId, "youtube");
    return await run.finish({ seen: videos.length, added, updated });
  } catch (err) {
    return await run.fail(err instanceof Error ? err.message : "Unexpected error");
  }
}
