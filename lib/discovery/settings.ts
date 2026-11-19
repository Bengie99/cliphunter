import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiscoverySettings {
  owner_id: string;
  discovery_enabled: boolean;
  frequency_minutes: number;
  minimum_views: number;
  minimum_duration: number | null;
  maximum_duration: number | null;
  upload_window_hours: number | null;
  languages: string[];
  categories: string[];
}

export interface DiscoveryRun {
  id: string;
  platform: string;
  trigger: "schedule" | "manual";
  status: "running" | "success" | "partial" | "error";
  started_at: string;
  finished_at: string | null;
  clips_seen: number;
  clips_new: number;
  clips_updated: number;
  messages: string[];
}

/** Defaults for a first-time setup: GTA VI, YouTube-Shorts-length clips, last 7 days. */
export const TWITCH_DEFAULTS: Omit<DiscoverySettings, "owner_id"> = {
  discovery_enabled: true,
  frequency_minutes: 15,
  minimum_views: 0,
  minimum_duration: 25,
  maximum_duration: 60,
  upload_window_hours: 168,
  languages: [],
  categories: ["Grand Theft Auto VI"],
};

export const SETTINGS_COLUMNS =
  "owner_id, discovery_enabled, frequency_minutes, minimum_views, minimum_duration, maximum_duration, upload_window_hours, languages, categories";

export async function getTwitchSettings(sb: SupabaseClient): Promise<DiscoverySettings | null> {
  const { data, error } = await sb.from("discovery_settings").select(SETTINGS_COLUMNS).eq("platform", "twitch").maybeSingle();
  if (error) throw new Error(`Loading discovery settings failed: ${error.message}`);
  return data as DiscoverySettings | null;
}

export async function listRecentRuns(sb: SupabaseClient, limit = 10): Promise<DiscoveryRun[]> {
  const { data, error } = await sb
    .from("discovery_runs")
    .select("id, platform, trigger, status, started_at, finished_at, clips_seen, clips_new, clips_updated, messages")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Loading discovery runs failed: ${error.message}`);
  return (data ?? []) as DiscoveryRun[];
}
