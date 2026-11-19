import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunSummary } from "./common";
import { SETTINGS_COLUMNS, type DiscoveryPlatform, type DiscoverySettings } from "./settings";
import { runTwitchDiscovery } from "./twitch-discovery";
import { runYouTubeDiscovery } from "./youtube-discovery";

export const RUNNERS: Record<
  DiscoveryPlatform,
  (admin: SupabaseClient, s: DiscoverySettings, trigger: "schedule" | "manual") => Promise<RunSummary>
> = {
  twitch: runTwitchDiscovery,
  youtube: runYouTubeDiscovery,
};

/**
 * Entry point for the scheduler: for every enabled (owner, platform), runs
 * discovery if the last run is older than the configured frequency.
 */
export async function runScheduledDiscovery(admin: SupabaseClient): Promise<RunSummary[]> {
  const { data, error } = await admin
    .from("discovery_settings")
    .select(`platform, ${SETTINGS_COLUMNS}`)
    .in("platform", Object.keys(RUNNERS))
    .eq("discovery_enabled", true);
  if (error) throw new Error(`Loading discovery settings failed: ${error.message}`);

  const jobs = ((data ?? []) as unknown as (DiscoverySettings & { platform: DiscoveryPlatform })[]).map(async (s) => {
    const { data: last } = await admin
      .from("discovery_runs")
      .select("started_at, status")
      .eq("owner_id", s.owner_id)
      .eq("platform", s.platform)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const minutesSince = last ? (Date.now() - new Date(last.started_at).getTime()) / 60_000 : Infinity;
    // 1 min of slack so a 15-min schedule doesn't skip every other tick due to jitter
    const tooSoon = minutesSince < s.frequency_minutes - 1;
    const stillRunning = last?.status === "running" && minutesSince < 5;
    if (tooSoon || stillRunning) {
      return { ownerId: s.owner_id, platform: s.platform, status: "skipped", seen: 0, added: 0, updated: 0, messages: [] } satisfies RunSummary;
    }
    return RUNNERS[s.platform](admin, s, "schedule");
  });
  return Promise.all(jobs);
}
