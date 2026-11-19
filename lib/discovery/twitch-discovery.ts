import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeViralScore } from "../scoring";
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
import { SETTINGS_COLUMNS, type DiscoverySettings } from "./settings";

/**
 * Twitch discovery for one owner:
 *   1. clips from every monitored Twitch streamer (only in the configured games, if any)
 *   2. the most-viewed clips in each configured game across all of Twitch
 * filtered by length / views / language, then inserted (new) or refreshed (known).
 *
 * Uses the service-role client, so every query is scoped to `ownerId` by hand.
 */

const PER_STREAMER_LIMIT = 100;
const PER_GAME_LIMIT = 100;

export interface RunSummary {
  ownerId: string;
  status: "success" | "partial" | "error" | "skipped";
  seen: number;
  added: number;
  updated: number;
  messages: string[];
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function runTwitchDiscovery(
  admin: SupabaseClient,
  settings: DiscoverySettings,
  trigger: "schedule" | "manual",
): Promise<RunSummary> {
  const ownerId = settings.owner_id;
  const messages: string[] = [];
  let partial = false;

  const { data: run, error: runErr } = await admin
    .from("discovery_runs")
    .insert({ owner_id: ownerId, platform: "twitch", trigger })
    .select("id")
    .single();
  if (runErr) throw new Error(`Could not start discovery run: ${runErr.message}`);

  const finish = async (s: Omit<RunSummary, "ownerId" | "messages">) => {
    await admin
      .from("discovery_runs")
      .update({
        status: s.status,
        finished_at: new Date().toISOString(),
        clips_seen: s.seen,
        clips_new: s.added,
        clips_updated: s.updated,
        messages: messages.slice(0, 50),
      })
      .eq("id", run.id);
    return { ownerId, messages, ...s };
  };

  try {
    if (!twitchConfigured()) {
      messages.push("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set in the environment.");
      return await finish({ status: "error", seen: 0, added: 0, updated: 0 });
    }

    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - (settings.upload_window_hours ?? 168) * 3_600_000);
    const window = { startedAt, endedAt };

    // -- games ----------------------------------------------------------------
    const games = await getGamesByName(settings.categories);
    for (const name of settings.categories) {
      if (!games.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        messages.push(`Game "${name}" was not found on Twitch — check the exact category name.`);
        partial = true;
      }
    }
    const gameNames = new Map(games.map((g) => [g.id, g.name]));
    const gameFilter = new Set(games.map((g) => g.id));
    if (settings.categories.length > 0 && gameFilter.size === 0) {
      messages.push("None of the configured games exist on Twitch, so nothing was searched.");
      return await finish({ status: "error", seen: 0, added: 0, updated: 0 });
    }

    // -- monitored streamers --------------------------------------------------
    const { data: monitored, error: monErr } = await admin
      .from("creators")
      .select("id, external_creator_id")
      .eq("owner_id", ownerId)
      .eq("platform", "twitch")
      .eq("is_monitored", true);
    if (monErr) throw new Error(`Loading monitored streamers failed: ${monErr.message}`);

    const users = new Map<string, TwitchUser>(); // by broadcaster id
    if (monitored?.length) {
      const found = await getUsersByLogin(monitored.map((m) => m.external_creator_id));
      for (const u of found) users.set(u.id, u);
      for (const m of monitored) {
        if (!found.some((u) => u.login === m.external_creator_id)) {
          messages.push(`Streamer "${m.external_creator_id}" was not found on Twitch.`);
          partial = true;
        }
      }
    }

    // -- fetch clips ----------------------------------------------------------
    const collected = new Map<string, TwitchClip>();
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
    if (sources.length === 0) {
      messages.push("Nothing to search: add streamers on the Creators page or a game in the settings.");
      return await finish({ status: "error", seen: 0, added: 0, updated: 0 });
    }

    const results = await Promise.allSettled(sources.map((s) => s.load()));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") r.value.forEach((c) => collected.set(c.id, c));
      else {
        partial = true;
        messages.push(`${sources[i].label}: ${r.reason instanceof Error ? r.reason.message : "request failed"}`);
      }
    });
    if (results.every((r) => r.status === "rejected")) {
      return await finish({ status: "error", seen: 0, added: 0, updated: 0 });
    }

    // -- filters --------------------------------------------------------------
    const langs = settings.languages.map((l) => l.toLowerCase());
    const clips = [...collected.values()].filter(
      (c) =>
        (settings.minimum_duration == null || c.duration >= settings.minimum_duration) &&
        (settings.maximum_duration == null || c.duration <= settings.maximum_duration) &&
        c.view_count >= settings.minimum_views &&
        (langs.length === 0 || langs.includes(c.language.toLowerCase())),
    );
    if (clips.length === 0) {
      await touchMonitored(admin, ownerId);
      return await finish({ status: partial ? "partial" : "success", seen: collected.size, added: 0, updated: 0 });
    }

    // -- resolve broadcaster logins + game names we don't have yet ------------
    const missingUsers = [...new Set(clips.map((c) => c.broadcaster_id))].filter((id) => !users.has(id));
    if (missingUsers.length) (await getUsersById(missingUsers)).forEach((u) => users.set(u.id, u));
    const missingGames = [...new Set(clips.map((c) => c.game_id))].filter((id) => id && !gameNames.has(id));
    if (missingGames.length) (await getGamesById(missingGames)).forEach((g) => gameNames.set(g.id, g.name));

    // -- creators (never touches is_monitored or category) --------------------
    const creatorRows = [...new Set(clips.map((c) => c.broadcaster_id))]
      .map((id) => users.get(id))
      .filter((u): u is TwitchUser => Boolean(u))
      .map((u) => ({
        owner_id: ownerId,
        platform: "twitch",
        external_creator_id: u.login,
        name: u.display_name,
        profile_url: `https://www.twitch.tv/${u.login}`,
        profile_image: u.profile_image_url || null,
      }));
    const creatorIds = new Map<string, string>(); // login -> creators.id
    for (const batch of chunk(creatorRows, 200)) {
      const { data, error } = await admin
        .from("creators")
        .upsert(batch, { onConflict: "owner_id,platform,external_creator_id" })
        .select("id, external_creator_id");
      if (error) throw new Error(`Saving creators failed: ${error.message}`);
      data.forEach((r) => creatorIds.set(r.external_creator_id, r.id));
    }

    // -- split new vs known clips ---------------------------------------------
    const known = new Set<string>();
    for (const batch of chunk(clips.map((c) => c.id), 100)) {
      const { data, error } = await admin
        .from("clips")
        .select("external_clip_id")
        .eq("owner_id", ownerId)
        .eq("platform", "twitch")
        .in("external_clip_id", batch);
      if (error) throw new Error(`Checking existing clips failed: ${error.message}`);
      data.forEach((r) => known.add(r.external_clip_id));
    }

    const now = new Date();
    const fields = (c: TwitchClip) => {
      const user = users.get(c.broadcaster_id);
      return {
        owner_id: ownerId,
        platform: "twitch",
        external_clip_id: c.id,
        creator_id: user ? (creatorIds.get(user.login) ?? null) : null,
        creator_name: user?.display_name ?? c.broadcaster_name,
        creator_url: user ? `https://www.twitch.tv/${user.login}` : null,
        title: c.title.trim() || "Untitled clip",
        original_url: c.url,
        thumbnail_url: c.thumbnail_url || null,
        duration_seconds: Math.round(c.duration),
        views: c.view_count,
        category: gameNames.get(c.game_id) ?? null,
        language: c.language || null,
        uploaded_at: c.created_at,
        last_checked_at: now.toISOString(),
        viral_score: computeViralScore({ views: c.view_count, likes: null, comments: null, uploaded_at: c.created_at, now }),
      };
    };

    const fresh = clips.filter((c) => !known.has(c.id));
    const stale = clips.filter((c) => known.has(c.id));

    let added = 0;
    for (const batch of chunk(fresh, 200)) {
      const { data, error } = await admin
        .from("clips")
        .upsert(
          batch.map((c) => ({ ...fields(c), source: "discovery", rights_status: "public_discoverable" })),
          // a concurrent run may have inserted the same clip — skip, don't fail
          { onConflict: "owner_id,platform,external_clip_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`Saving new clips failed: ${error.message}`);
      added += data.length;
    }

    // Refresh metrics on clips we already have. Review/pipeline/rights state and
    // the original source are not in the payload, so they are left untouched.
    let updated = 0;
    for (const batch of chunk(stale, 200)) {
      const { error } = await admin
        .from("clips")
        .upsert(batch.map(fields), { onConflict: "owner_id,platform,external_clip_id" });
      if (error) {
        partial = true;
        messages.push(`Refreshing known clips failed: ${error.message}`);
      } else updated += batch.length;
    }

    await touchMonitored(admin, ownerId);
    return await finish({ status: partial ? "partial" : "success", seen: collected.size, added, updated });
  } catch (err) {
    messages.push(err instanceof Error ? err.message : "Unexpected error");
    return await finish({ status: "error", seen: 0, added: 0, updated: 0 });
  }
}

async function touchMonitored(admin: SupabaseClient, ownerId: string) {
  await admin
    .from("creators")
    .update({ last_discovered_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("platform", "twitch")
    .eq("is_monitored", true);
}

/**
 * Entry point for the scheduler: runs Twitch discovery for every owner who has
 * it enabled and whose last run is older than their configured frequency.
 */
export async function runScheduledTwitchDiscovery(admin: SupabaseClient): Promise<RunSummary[]> {
  const { data: all, error } = await admin
    .from("discovery_settings")
    .select(SETTINGS_COLUMNS)
    .eq("platform", "twitch")
    .eq("discovery_enabled", true);
  if (error) throw new Error(`Loading discovery settings failed: ${error.message}`);

  const out: RunSummary[] = [];
  for (const s of (all ?? []) as DiscoverySettings[]) {
    const { data: last } = await admin
      .from("discovery_runs")
      .select("started_at, status")
      .eq("owner_id", s.owner_id)
      .eq("platform", "twitch")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const minutesSince = last ? (Date.now() - new Date(last.started_at).getTime()) / 60_000 : Infinity;
    // 1 min of slack so a 15-min schedule doesn't skip every other tick due to jitter
    const tooSoon = minutesSince < s.frequency_minutes - 1;
    const stillRunning = last?.status === "running" && minutesSince < 5;
    if (tooSoon || stillRunning) {
      out.push({ ownerId: s.owner_id, status: "skipped", seen: 0, added: 0, updated: 0, messages: [] });
      continue;
    }
    out.push(await runTwitchDiscovery(admin, s, "schedule"));
  }
  return out;
}
