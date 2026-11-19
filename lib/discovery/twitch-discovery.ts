import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getClips,
  getGamesById,
  getGamesByName,
  getUsersById,
  getUsersByLogin,
  twitchConfigured,
  type TwitchClip,
  type TwitchUser,
} from "../integrations/twitch";
import { Run, saveClips, touchMonitored, type FoundClip, type RunSummary } from "./common";
import type { DiscoverySettings } from "./settings";

/**
 * Twitch discovery for one owner:
 *   1. clips from every monitored Twitch streamer (only in the configured games, if any)
 *   2. the most-viewed clips in each configured game across all of Twitch
 * filtered by length / views / language, then saved.
 */

const PER_STREAMER_LIMIT = 100;
const PER_GAME_LIMIT = 100;

export async function runTwitchDiscovery(
  admin: SupabaseClient,
  settings: DiscoverySettings,
  trigger: "schedule" | "manual",
): Promise<RunSummary> {
  const ownerId = settings.owner_id;
  const run = await Run.start(admin, ownerId, "twitch", trigger);

  try {
    if (!twitchConfigured()) return await run.fail("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set in the environment.");

    const endedAt = new Date();
    const window = { startedAt: new Date(endedAt.getTime() - (settings.upload_window_hours ?? 168) * 3_600_000), endedAt };

    // -- games ----------------------------------------------------------------
    const games = await getGamesByName(settings.categories);
    for (const name of settings.categories) {
      if (!games.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        run.warn(`Game "${name}" was not found on Twitch — check the exact category name.`);
      }
    }
    const gameNames = new Map(games.map((g) => [g.id, g.name]));
    const gameFilter = new Set(games.map((g) => g.id));
    if (settings.categories.length > 0 && gameFilter.size === 0) {
      return await run.fail("None of the configured games exist on Twitch, so nothing was searched.");
    }

    // -- monitored streamers --------------------------------------------------
    const { data: monitored, error: monErr } = await admin
      .from("creators")
      .select("external_creator_id")
      .eq("owner_id", ownerId)
      .eq("platform", "twitch")
      .eq("is_monitored", true);
    if (monErr) throw new Error(`Loading monitored streamers failed: ${monErr.message}`);

    const users = new Map<string, TwitchUser>(); // by broadcaster id
    if (monitored?.length) {
      const found = await getUsersByLogin(monitored.map((m) => m.external_creator_id));
      found.forEach((u) => users.set(u.id, u));
      for (const m of monitored) {
        if (!found.some((u) => u.login === m.external_creator_id)) run.warn(`Streamer "${m.external_creator_id}" was not found on Twitch.`);
      }
    }

    // -- fetch ----------------------------------------------------------------
    const sources: { label: string; load: () => Promise<TwitchClip[]> }[] = [
      ...[...users.values()].map((u) => ({
        label: u.display_name,
        load: async () => {
          const clips = await getClips({ broadcasterId: u.id }, window, PER_STREAMER_LIMIT);
          return gameFilter.size ? clips.filter((c) => gameFilter.has(c.game_id)) : clips;
        },
      })),
      ...games.map((g) => ({ label: g.name, load: () => getClips({ gameId: g.id }, window, PER_GAME_LIMIT) })),
    ];
    if (sources.length === 0) return await run.fail("Nothing to search: add streamers on the Creators page or a game in the settings.");

    const collected = new Map<string, TwitchClip>();
    const results = await Promise.allSettled(sources.map((s) => s.load()));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") r.value.forEach((c) => collected.set(c.id, c));
      else run.warn(`${sources[i].label}: ${r.reason instanceof Error ? r.reason.message : "request failed"}`);
    });
    if (results.every((r) => r.status === "rejected")) return await run.fail("Every Twitch request failed.");

    // -- filter ---------------------------------------------------------------
    const langs = settings.languages.map((l) => l.toLowerCase());
    const clips = [...collected.values()].filter(
      (c) =>
        (settings.minimum_duration == null || c.duration >= settings.minimum_duration) &&
        (settings.maximum_duration == null || c.duration <= settings.maximum_duration) &&
        c.view_count >= settings.minimum_views &&
        (langs.length === 0 || langs.includes(c.language.toLowerCase())),
    );

    // -- resolve broadcaster logins + game names we don't have yet ------------
    const missingUsers = [...new Set(clips.map((c) => c.broadcaster_id))].filter((id) => !users.has(id));
    if (missingUsers.length) (await getUsersById(missingUsers)).forEach((u) => users.set(u.id, u));
    const missingGames = [...new Set(clips.map((c) => c.game_id))].filter((id) => id && !gameNames.has(id));
    if (missingGames.length) (await getGamesById(missingGames)).forEach((g) => gameNames.set(g.id, g.name));

    const found: FoundClip[] = clips.map((c) => {
      const u = users.get(c.broadcaster_id);
      return {
        externalId: c.id,
        creator: u
          ? { externalId: u.login, name: u.display_name, profileUrl: `https://www.twitch.tv/${u.login}`, profileImage: u.profile_image_url || null }
          : null,
        title: c.title,
        originalUrl: c.url,
        thumbnailUrl: c.thumbnail_url || null,
        durationSeconds: Math.round(c.duration),
        views: c.view_count,
        likes: null, // Twitch doesn't expose likes/comments on clips
        comments: null,
        category: gameNames.get(c.game_id) ?? null,
        language: c.language || null,
        uploadedAt: c.created_at,
      };
    });

    const { added, updated } = await saveClips(admin, run, found);
    await touchMonitored(admin, ownerId, "twitch");
    return await run.finish({ seen: collected.size, added, updated });
  } catch (err) {
    return await run.fail(err instanceof Error ? err.message : "Unexpected error");
  }
}
