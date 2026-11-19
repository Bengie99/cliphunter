/**
 * Central place for reading environment configuration.
 *
 * Data mode:
 *   - "supabase" when NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are set
 *   - "demo" otherwise (or when CLIPHUNTER_DATA_MODE=demo). Demo mode keeps
 *     sample data in a local JSON file (.data/demo-db.json) and never touches
 *     the production database.
 */
export type DataMode = "demo" | "supabase";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export function getDataMode(): DataMode {
  if (process.env.CLIPHUNTER_DATA_MODE === "demo") return "demo";
  return supabaseConfig() ? "supabase" : "demo";
}

/** Which server-side credentials are present. Never returns the values. */
export function integrationEnvStatus() {
  const has = (...keys: string[]) => keys.every((k) => Boolean(process.env[k]));
  return {
    supabase: has("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRole: has("SUPABASE_SERVICE_ROLE_KEY"),
    twitch: has("TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"),
    youtube: has("YOUTUBE_API_KEY"),
    kick: has("KICK_CLIENT_ID", "KICK_CLIENT_SECRET"),
    tiktok: has("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"),
    instagram: has("INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"),
    redis: has("REDIS_URL"),
    anthropic: has("ANTHROPIC_API_KEY"),
  };
}
