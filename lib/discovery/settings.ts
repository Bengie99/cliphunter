import type { SupabaseClient } from "@supabase/supabase-js";

export const DISCOVERY_PLATFORMS = ["twitch", "youtube"] as const;
export type DiscoveryPlatform = (typeof DISCOVERY_PLATFORMS)[number];

export interface DiscoverySettings {
  owner_id: string;
  discovery_enabled: boolean;
  frequency_minutes: number;
  minimum_views: number;
  minimum_duration: number | null;
  maximum_duration: number | null;
  upload_window_hours: number | null;
  languages: string[];
  /** Twitch: game/category names. YouTube: keywords a video must mention (title/tags/description). */
  categories: string[];
  /** YouTube only: keyword searches, run every SEARCH_INTERVAL_HOURS. */
  search_terms: string[];
  last_search_at: string | null;
}

export type EditableSettings = Omit<DiscoverySettings, "owner_id" | "last_search_at">;

export interface DiscoveryRun {
  id: string;
  platform: DiscoveryPlatform;
  trigger: "schedule" | "manual";
  status: "running" | "success" | "partial" | "error";
  started_at: string;
  finished_at: string | null;
  clips_seen: number;
  clips_new: number;
  clips_updated: number;
  messages: string[];
}

/** YouTube search costs 100 of 10,000 daily quota units, so it runs at most this often. */
export const SEARCH_INTERVAL_HOURS = 6;

const GTA6 = ["GTA 6", "GTA VI", "GTA6", "Grand Theft Auto VI", "Grand Theft Auto 6"];

export const DEFAULTS: Record<DiscoveryPlatform, EditableSettings> = {
  // GTA VI, YouTube-Shorts-length clips, last 7 days
  twitch: {
    discovery_enabled: true,
    frequency_minutes: 15,
    minimum_views: 0,
    minimum_duration: 25,
    maximum_duration: 60,
    upload_window_hours: 168,
    languages: [],
    categories: ["Grand Theft Auto VI"],
    search_terms: [],
  },
  youtube: {
    discovery_enabled: true,
    frequency_minutes: 15,
    minimum_views: 0,
    minimum_duration: 25,
    maximum_duration: 60,
    upload_window_hours: 168,
    languages: [],
    categories: GTA6,
    search_terms: ["GTA 6 funny", "GTA 6 clips", "GTA VI moments"],
  },
};

export const SETTINGS_COLUMNS =
  "owner_id, discovery_enabled, frequency_minutes, minimum_views, minimum_duration, maximum_duration, upload_window_hours, languages, categories, search_terms, last_search_at";

export async function getSettings(sb: SupabaseClient, platform: DiscoveryPlatform): Promise<DiscoverySettings | null> {
  const { data, error } = await sb.from("discovery_settings").select(SETTINGS_COLUMNS).eq("platform", platform).maybeSingle();
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
