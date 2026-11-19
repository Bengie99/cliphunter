"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDataMode } from "@/lib/env";
import { getTwitchSettings, TWITCH_DEFAULTS } from "@/lib/discovery/settings";
import { runTwitchDiscovery, type RunSummary } from "@/lib/discovery/twitch-discovery";
import { getUsersByLogin, twitchConfigured } from "@/lib/integrations/twitch";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsSchema = z
  .object({
    discovery_enabled: z.boolean(),
    frequency_minutes: z.number().int().min(15).max(1440),
    minimum_views: z.number().int().min(0).max(1e9),
    minimum_duration: z.number().int().min(0).max(3600).nullable(),
    maximum_duration: z.number().int().min(1).max(3600).nullable(),
    upload_window_hours: z.number().int().min(1).max(24 * 30),
    categories: z.array(z.string().trim().min(1).max(100)).max(10),
    languages: z.array(z.string().trim().toLowerCase().regex(/^[a-z]{2}$/, "Languages are 2-letter codes like en, es")).max(10),
  })
  .refine((s) => s.minimum_duration == null || s.maximum_duration == null || s.minimum_duration <= s.maximum_duration, {
    message: "Minimum length can't be longer than maximum length.",
  });
export type TwitchSettingsForm = z.input<typeof settingsSchema>;

export async function saveTwitchSettingsAction(input: TwitchSettingsForm): Promise<ActionResult> {
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid settings" };
  try {
    const { sb, user } = await requireUser();
    const { error } = await sb
      .from("discovery_settings")
      .upsert({ ...p.data, owner_id: user.id, platform: "twitch" }, { onConflict: "owner_id,platform" });
    if (error) throw new Error(`Saving settings failed: ${error.message}`);
    revalidatePath("/integrations");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Run now
// ---------------------------------------------------------------------------

export async function runTwitchDiscoveryNowAction(): Promise<ActionResult<RunSummary>> {
  try {
    const { sb, user } = await requireUser();
    const settings = (await getTwitchSettings(sb)) ?? { ...TWITCH_DEFAULTS, owner_id: user.id };
    const summary = await runTwitchDiscovery(createSupabaseAdminClient(), { ...settings, owner_id: user.id }, "manual");
    revalidatePath("/", "layout");
    return { ok: true, data: summary };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Monitored streamers
// ---------------------------------------------------------------------------

/** Accepts "xqc", "@xqc", "twitch.tv/xqc", "https://www.twitch.tv/xqc/videos" … */
function toLogin(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.|m\.)?twitch\.tv\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(s) ? s : null;
}

export async function addTwitchStreamersAction(
  text: string,
): Promise<ActionResult<{ added: string[]; notFound: string[]; invalid: string[] }>> {
  if (typeof text !== "string" || text.length > 5000) return { ok: false, error: "Invalid input" };
  const entries = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return { ok: false, error: "Enter at least one Twitch channel name." };
  if (entries.length > 100) return { ok: false, error: "Add at most 100 channels at a time." };

  const invalid = entries.filter((e) => !toLogin(e));
  const logins = [...new Set(entries.map(toLogin).filter((l): l is string => Boolean(l)))];
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
      data: {
        added: found.map((u) => u.display_name),
        notFound: logins.filter((l) => !found.some((u) => u.login === l)),
        invalid,
      },
    };
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
