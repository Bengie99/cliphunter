"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RunSummary } from "@/lib/discovery/common";
import { RUNNERS } from "@/lib/discovery/scheduler";
import { DEFAULTS, DISCOVERY_PLATFORMS, getSettings, type DiscoveryPlatform } from "@/lib/discovery/settings";
import { getDataMode } from "@/lib/env";
import { getUsersByLogin, twitchConfigured } from "@/lib/integrations/twitch";
import { getChannelByHandle, getChannelsById, youtubeConfigured, type YouTubeChannel } from "@/lib/integrations/youtube";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PERMISSION_STATUSES } from "@/lib/types";
import type { ActionResult } from "./actions";

async function requireUser() {
  if (getDataMode() !== "supabase") throw new Error("Discovery needs Supabase — it isn't available in demo mode.");
  const sb = createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You're signed out. Sign in again.");
  return { sb, user };
}

const fail = (err: unknown): { ok: false; error: string } => {
  console.error("[cliphunter] discovery action failed:", err);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
};

const platformSchema = z.enum(DISCOVERY_PLATFORMS);
const textList = (max: number, item: z.ZodString) => z.array(item).max(max);

// ---------------------------------------------------------------------------
// Settings + run now
// ---------------------------------------------------------------------------

const settingsSchema = z
  .object({
    discovery_enabled: z.boolean(),
    frequency_minutes: z.number().int().min(15).max(1440),
    minimum_views: z.number().int().min(0).max(1e9),
    minimum_duration: z.number().int().min(0).max(3600).nullable(),
    maximum_duration: z.number().int().min(1).max(3600).nullable(),
    upload_window_hours: z.number().int().min(1).max(24 * 30),
    categories: textList(20, z.string().trim().min(1).max(100)),
    search_terms: textList(5, z.string().trim().min(1).max(100)),
    languages: textList(10, z.string().trim().toLowerCase().regex(/^[a-z]{2}$/, "Languages are 2-letter codes like en, es")),
  })
  .refine((s) => s.minimum_duration == null || s.maximum_duration == null || s.minimum_duration <= s.maximum_duration, {
    message: "Minimum length can't be longer than maximum length.",
  });
export type SettingsForm = z.input<typeof settingsSchema>;

export async function saveDiscoverySettingsAction(platform: DiscoveryPlatform, input: SettingsForm): Promise<ActionResult> {
  const pl = platformSchema.safeParse(platform);
  const p = settingsSchema.safeParse(input);
  if (!pl.success) return { ok: false, error: "Unknown platform" };
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid settings" };
  try {
    const { sb, user } = await requireUser();
    const { error } = await sb
      .from("discovery_settings")
      .upsert({ ...p.data, owner_id: user.id, platform: pl.data }, { onConflict: "owner_id,platform" });
    if (error) throw new Error(`Saving settings failed: ${error.message}`);
    revalidatePath("/integrations");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export async function runDiscoveryNowAction(platform: DiscoveryPlatform): Promise<ActionResult<RunSummary>> {
  const pl = platformSchema.safeParse(platform);
  if (!pl.success) return { ok: false, error: "Unknown platform" };
  try {
    const { sb, user } = await requireUser();
    const saved = await getSettings(sb, pl.data);
    const settings = { ...DEFAULTS[pl.data], last_search_at: null, ...saved, owner_id: user.id };
    const summary = await RUNNERS[pl.data](createSupabaseAdminClient(), settings, "manual");
    revalidatePath("/", "layout");
    return { ok: true, data: summary };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Monitored streamers / channels
// ---------------------------------------------------------------------------

export type AddResult = { added: string[]; notFound: string[]; invalid: string[] };

function splitEntries(text: unknown): string[] | string {
  if (typeof text !== "string" || text.length > 10_000) return "Invalid input";
  const entries = text.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return "Enter at least one channel.";
  if (entries.length > 100) return "Add at most 100 channels at a time.";
  return entries;
}

/** Accepts "xqc", "@xqc", "twitch.tv/xqc", "https://www.twitch.tv/xqc/videos" … */
function toTwitchLogin(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.|m\.)?twitch\.tv\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(s) ? s : null;
}

/** Accepts "@handle", "youtube.com/@handle", "youtube.com/channel/UC…", or a pasted "Name<TAB>URL" row. */
function toYouTubeRef(raw: string): { handle: string } | { channelId: string } | null {
  const url = raw.match(/https?:\/\/\S+/)?.[0] ?? raw.trim();
  const id = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/i)?.[1];
  if (id) return { channelId: id };
  const handle = url.match(/(?:youtube\.com\/)?@([\w.-]{3,30})/i)?.[1] ?? (/^[\w.-]{3,30}$/.test(url) ? url : null);
  return handle ? { handle } : null;
}

export async function addTwitchStreamersAction(text: string): Promise<ActionResult<AddResult>> {
  const entries = splitEntries(text);
  if (typeof entries === "string") return { ok: false, error: entries };
  const invalid = entries.filter((e) => !toTwitchLogin(e));
  const logins = [...new Set(entries.map(toTwitchLogin).filter((l): l is string => Boolean(l)))];
  try {
    const { sb, user } = await requireUser();
    if (!twitchConfigured()) return { ok: false, error: "Twitch keys aren't set in the environment yet." };
    const found = logins.length ? await getUsersByLogin(logins) : [];
    if (found.length) {
      const { error } = await sb.from("creators").upsert(
        found.map((u) => ({
          owner_id: user.id,
          platform: "twitch",
          external_creator_id: u.login,
          name: u.display_name,
          profile_url: `https://www.twitch.tv/${u.login}`,
          profile_image: u.profile_image_url || null,
          is_monitored: true,
        })),
        { onConflict: "owner_id,platform,external_creator_id" },
      );
      if (error) throw new Error(`Saving streamers failed: ${error.message}`);
    }
    revalidatePath("/creators");
    return {
      ok: true,
      data: { added: found.map((u) => u.display_name), notFound: logins.filter((l) => !found.some((u) => u.login === l)), invalid },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function addYouTubeChannelsAction(text: string): Promise<ActionResult<AddResult>> {
  const entries = splitEntries(text);
  if (typeof entries === "string") return { ok: false, error: entries };
  // A pasted table has one row per line ("Name<TAB>URL"); treat each line as one entry.
  const rows = typeof text === "string" && text.includes("\t") ? text.split("\n").map((l) => l.trim()).filter(Boolean) : entries;
  const refs = rows.map((r) => ({ raw: r, ref: toYouTubeRef(r) })).filter((r) => !/^streamer\s/i.test(r.raw)); // skip header row
  const invalid = refs.filter((r) => !r.ref).map((r) => r.raw);
  try {
    const { sb, user } = await requireUser();
    if (!youtubeConfigured()) return { ok: false, error: "YOUTUBE_API_KEY isn't set in the environment yet." };

    const found: YouTubeChannel[] = [];
    const notFound: string[] = [];
    const ids = refs.flatMap((r) => (r.ref && "channelId" in r.ref ? [r.ref.channelId] : []));
    if (ids.length) {
      const got = await getChannelsById(ids);
      found.push(...got);
      ids.filter((id) => !got.some((c) => c.id === id)).forEach((id) => notFound.push(id));
    }
    // forHandle takes one handle per call (1 quota unit each)
    for (const r of refs) {
      if (!r.ref || !("handle" in r.ref)) continue;
      const ch = await getChannelByHandle(r.ref.handle);
      if (ch) found.push(ch);
      else notFound.push(`@${r.ref.handle}`);
    }

    const unique = [...new Map(found.map((c) => [c.id, c])).values()];
    if (unique.length) {
      const { error } = await sb.from("creators").upsert(
        unique.map((c) => ({
          owner_id: user.id,
          platform: "youtube",
          external_creator_id: c.id,
          name: c.title,
          profile_url: c.handle ? `https://www.youtube.com/@${c.handle}` : `https://www.youtube.com/channel/${c.id}`,
          profile_image: c.thumbnail,
          is_monitored: true,
        })),
        { onConflict: "owner_id,platform,external_creator_id" },
      );
      if (error) throw new Error(`Saving channels failed: ${error.message}`);
    }
    revalidatePath("/creators");
    return { ok: true, data: { added: unique.map((c) => c.title), notFound, invalid } };
  } catch (err) {
    return fail(err);
  }
}

export async function setCreatorMonitoredAction(creatorId: string, monitored: boolean): Promise<ActionResult> {
  const p = z.object({ id: z.string().uuid(), monitored: z.boolean() }).safeParse({ id: creatorId, monitored });
  if (!p.success) return { ok: false, error: "Invalid request" };
  try {
    const { sb } = await requireUser();
    const { error } = await sb.from("creators").update({ is_monitored: p.data.monitored }).eq("id", p.data.id);
    if (error) throw new Error(`Updating creator failed: ${error.message}`);
    revalidatePath("/creators");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

const permissionSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(PERMISSION_STATUSES),
    proofUrl: z.string().trim().url("Proof must be a link (screenshot, post or message)").max(1000).nullable(),
    grantedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .refine((p) => p.status !== "granted" || p.proofUrl, { message: "Add a proof link when marking permission as granted." });
export type PermissionForm = z.input<typeof permissionSchema>;

export async function setCreatorPermissionAction(input: PermissionForm): Promise<ActionResult> {
  const p = permissionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid request" };
  try {
    const { sb } = await requireUser();
    const v = p.data;
    const { error } = await sb
      .from("creators")
      .update({
        permission_status: v.status,
        permission_proof_url: v.proofUrl || null,
        permission_granted_at: v.status === "granted" ? (v.grantedAt ?? new Date().toISOString().slice(0, 10)) : v.grantedAt,
        permission_notes: v.notes || null,
      })
      .eq("id", v.id);
    if (error) throw new Error(`Saving permission failed: ${error.message}`);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Bio scan — evidence of a public clipping policy (never sets permission)
// ---------------------------------------------------------------------------

const CLIP_POLICY = /\b(clip(s|ping|per|pers)?|re-?upload(s|ing)?|repost(s|ing)?|copyright|fair use|dmca|content id)\b/i;

/** The sentences/lines of a bio that talk about clipping, joined; null if none. */
function clipExcerpt(bio: string): string | null {
  const parts = bio
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && CLIP_POLICY.test(s));
  if (parts.length === 0) return null;
  const text = parts.slice(0, 3).join(" … ");
  return text.length > 400 ? `${text.slice(0, 397)}…` : text;
}

export async function scanCreatorBiosAction(): Promise<ActionResult<{ scanned: number; mentions: number; failed: string[] }>> {
  try {
    const { sb } = await requireUser();
    const { data: creators, error } = await sb
      .from("creators")
      .select("id, platform, external_creator_id, name")
      .in("platform", ["twitch", "youtube"]);
    if (error) throw new Error(`Loading creators failed: ${error.message}`);

    const bios = new Map<string, string>(); // creator id -> bio
    const failed: string[] = [];

    const twitch = creators.filter((c) => c.platform === "twitch");
    if (twitch.length && twitchConfigured()) {
      try {
        const users = await getUsersByLogin(twitch.map((c) => c.external_creator_id));
        for (const c of twitch) {
          const u = users.find((x) => x.login === c.external_creator_id);
          if (u) bios.set(c.id, u.description ?? "");
        }
      } catch (err) {
        failed.push(`Twitch: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    // YouTube creators found via discovery/channel monitoring use the channel id (UC…)
    const youtube = creators.filter((c) => c.platform === "youtube" && /^UC[\w-]{22}$/.test(c.external_creator_id));
    if (youtube.length && youtubeConfigured()) {
      try {
        for (let i = 0; i < youtube.length; i += 50) {
          const batch = youtube.slice(i, i + 50);
          const channels = await getChannelsById(batch.map((c) => c.external_creator_id));
          for (const c of batch) {
            const ch = channels.find((x) => x.id === c.external_creator_id);
            if (ch) bios.set(c.id, ch.description);
          }
        }
      } catch (err) {
        failed.push(`YouTube: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    const now = new Date().toISOString();
    let mentions = 0;
    for (const [id, bio] of bios) {
      const excerpt = clipExcerpt(bio);
      if (excerpt) mentions++;
      const { error: upErr } = await sb.from("creators").update({ bio_clip_excerpt: excerpt, bio_checked_at: now }).eq("id", id);
      if (upErr) throw new Error(`Saving scan results failed: ${upErr.message}`);
    }
    revalidatePath("/creators");
    return { ok: true, data: { scanned: bios.size, mentions, failed } };
  } catch (err) {
    return fail(err);
  }
}
