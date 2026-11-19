import "server-only";

/**
 * Minimal Twitch Helix client using an app access token (client credentials).
 * App tokens only read public data — no user ever signs in through Twitch.
 * https://dev.twitch.tv/docs/api/reference
 */

const HELIX = "https://api.twitch.tv/helix";

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchGame {
  id: string;
  name: string;
}

export interface TwitchClip {
  id: string;
  url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
}

export class TwitchError extends Error {}

export function twitchConfigured() {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

// App tokens last ~60 days; cache per serverless instance.
let token: { value: string; expiresAt: number } | null = null;

async function getAppToken(force = false): Promise<string> {
  if (!force && token && token.expiresAt > Date.now() + 60_000) return token.value;
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new TwitchError("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set.");
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
    cache: "no-store",
  });
  if (!res.ok) throw new TwitchError(`Twitch rejected the app credentials (HTTP ${res.status}). Check the client ID and secret.`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function helix<T>(path: string, params: [string, string][]): Promise<{ data: T[]; cursor?: string }> {
  const url = `${HELIX}/${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { "Client-Id": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${await getAppToken()}` },
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { data: T[]; pagination?: { cursor?: string } };
      return { data: body.data, cursor: body.pagination?.cursor };
    }
    if (res.status === 401) {
      token = null; // expired or revoked — fetch a new one and retry
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const reset = Number(res.headers.get("Ratelimit-Reset")) * 1000;
      const wait = reset > Date.now() ? Math.min(reset - Date.now(), 5_000) : 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new TwitchError(`Twitch ${path} failed (HTTP ${res.status}).`);
  }
  throw new TwitchError(`Twitch ${path} failed after retries.`);
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Look up channels by login name (the part after twitch.tv/). */
export async function getUsersByLogin(logins: string[]): Promise<TwitchUser[]> {
  const out: TwitchUser[] = [];
  for (const batch of chunks(logins, 100)) {
    out.push(...(await helix<TwitchUser>("users", batch.map((l) => ["login", l]))).data);
  }
  return out;
}

export async function getUsersById(ids: string[]): Promise<TwitchUser[]> {
  const out: TwitchUser[] = [];
  for (const batch of chunks(ids, 100)) {
    out.push(...(await helix<TwitchUser>("users", batch.map((id) => ["id", id]))).data);
  }
  return out;
}

export async function getGamesByName(names: string[]): Promise<TwitchGame[]> {
  if (names.length === 0) return [];
  return (await helix<TwitchGame>("games", names.map((n) => ["name", n]))).data;
}

export async function getGamesById(ids: string[]): Promise<TwitchGame[]> {
  const out: TwitchGame[] = [];
  for (const batch of chunks(ids, 100)) {
    out.push(...(await helix<TwitchGame>("games", batch.map((id) => ["id", id]))).data);
  }
  return out;
}

/**
 * Clips for one broadcaster or one game created in [startedAt, endedAt],
 * most-viewed first. `limit` caps the total across pages.
 */
export async function getClips(
  by: { broadcasterId: string } | { gameId: string },
  window: { startedAt: Date; endedAt: Date },
  limit = 100,
): Promise<TwitchClip[]> {
  const base: [string, string][] = [
    "broadcasterId" in by ? ["broadcaster_id", by.broadcasterId] : ["game_id", by.gameId],
    ["started_at", window.startedAt.toISOString()],
    ["ended_at", window.endedAt.toISOString()],
  ];
  const out: TwitchClip[] = [];
  let cursor: string | undefined;
  do {
    const page = await helix<TwitchClip>("clips", [
      ...base,
      ["first", String(Math.min(100, limit - out.length))],
      ...(cursor ? ([["after", cursor]] as [string, string][]) : []),
    ]);
    out.push(...page.data);
    cursor = page.data.length ? page.cursor : undefined;
  } while (cursor && out.length < limit);
  return out;
}
