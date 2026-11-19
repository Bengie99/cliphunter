import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeViralScore } from "../scoring";
import type { Platform } from "../types";

/**
 * Platform-neutral pieces of a discovery run: the run log and saving clips.
 * All queries use the service-role client, so they are scoped to ownerId by hand.
 */

export interface FoundCreator {
  externalId: string;
  name: string;
  profileUrl: string | null;
  profileImage: string | null;
}

export interface FoundClip {
  externalId: string;
  creator: FoundCreator | null;
  title: string;
  originalUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  category: string | null;
  language: string | null;
  uploadedAt: string;
}

export interface RunSummary {
  ownerId: string;
  platform: Platform;
  status: "success" | "partial" | "error" | "skipped";
  seen: number;
  added: number;
  updated: number;
  messages: string[];
}

export const chunk = <T>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export class Run {
  readonly messages: string[] = [];
  partial = false;
  private constructor(
    private readonly admin: SupabaseClient,
    readonly id: string,
    readonly ownerId: string,
    readonly platform: Platform,
  ) {}

  static async start(admin: SupabaseClient, ownerId: string, platform: Platform, trigger: "schedule" | "manual") {
    const { data, error } = await admin
      .from("discovery_runs")
      .insert({ owner_id: ownerId, platform, trigger })
      .select("id")
      .single();
    if (error) throw new Error(`Could not start discovery run: ${error.message}`);
    return new Run(admin, data.id, ownerId, platform);
  }

  warn(message: string) {
    this.partial = true;
    this.messages.push(message);
  }

  async finish(s: { seen: number; added: number; updated: number; failed?: boolean }): Promise<RunSummary> {
    const status = s.failed ? "error" : this.partial ? "partial" : "success";
    await this.admin
      .from("discovery_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        clips_seen: s.seen,
        clips_new: s.added,
        clips_updated: s.updated,
        messages: this.messages.slice(0, 50),
      })
      .eq("id", this.id);
    return { ownerId: this.ownerId, platform: this.platform, status, seen: s.seen, added: s.added, updated: s.updated, messages: this.messages };
  }

  fail(message: string, seen = 0) {
    this.messages.push(message);
    return this.finish({ seen, added: 0, updated: 0, failed: true });
  }
}

/**
 * Upserts creators, inserts new clips (source=discovery) and refreshes metrics on
 * clips already saved. Review/pipeline/rights state and the original source of
 * known clips are not in the payload, so they are never overwritten.
 */
export async function saveClips(admin: SupabaseClient, run: Run, clips: FoundClip[]): Promise<{ added: number; updated: number }> {
  const { ownerId, platform } = run;
  if (clips.length === 0) return { added: 0, updated: 0 };

  // creators — never touches is_monitored, category or permission fields
  const creators = new Map<string, FoundCreator>();
  clips.forEach((c) => c.creator && creators.set(c.creator.externalId, c.creator));
  const creatorIds = new Map<string, string>();
  for (const batch of chunk([...creators.values()], 200)) {
    const { data, error } = await admin
      .from("creators")
      .upsert(
        batch.map((c) => ({
          owner_id: ownerId,
          platform,
          external_creator_id: c.externalId,
          name: c.name,
          profile_url: c.profileUrl,
          profile_image: c.profileImage,
        })),
        { onConflict: "owner_id,platform,external_creator_id" },
      )
      .select("id, external_creator_id");
    if (error) throw new Error(`Saving creators failed: ${error.message}`);
    data.forEach((r) => creatorIds.set(r.external_creator_id, r.id));
  }

  // which clips do we already have?
  const known = new Set<string>();
  for (const batch of chunk(clips.map((c) => c.externalId), 100)) {
    const { data, error } = await admin
      .from("clips")
      .select("external_clip_id")
      .eq("owner_id", ownerId)
      .eq("platform", platform)
      .in("external_clip_id", batch);
    if (error) throw new Error(`Checking existing clips failed: ${error.message}`);
    data.forEach((r) => known.add(r.external_clip_id));
  }

  const now = new Date();
  const row = (c: FoundClip) => ({
    owner_id: ownerId,
    platform,
    external_clip_id: c.externalId,
    creator_id: c.creator ? (creatorIds.get(c.creator.externalId) ?? null) : null,
    creator_name: c.creator?.name ?? null,
    creator_url: c.creator?.profileUrl ?? null,
    title: c.title.trim().slice(0, 300) || "Untitled clip",
    original_url: c.originalUrl,
    thumbnail_url: c.thumbnailUrl,
    duration_seconds: c.durationSeconds,
    views: c.views,
    likes: c.likes,
    comments: c.comments,
    category: c.category,
    language: c.language,
    uploaded_at: c.uploadedAt,
    last_checked_at: now.toISOString(),
    viral_score: computeViralScore({ views: c.views, likes: c.likes, comments: c.comments, uploaded_at: c.uploadedAt, now }),
  });

  let added = 0;
  for (const batch of chunk(clips.filter((c) => !known.has(c.externalId)), 200)) {
    const { data, error } = await admin
      .from("clips")
      .upsert(
        batch.map((c) => ({ ...row(c), source: "discovery", rights_status: "public_discoverable" })),
        // a concurrent run may have inserted the same clip — skip, don't fail
        { onConflict: "owner_id,platform,external_clip_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(`Saving new clips failed: ${error.message}`);
    added += data.length;
  }

  let updated = 0;
  for (const batch of chunk(clips.filter((c) => known.has(c.externalId)), 200)) {
    const { error } = await admin.from("clips").upsert(batch.map(row), { onConflict: "owner_id,platform,external_clip_id" });
    if (error) run.warn(`Refreshing known clips failed: ${error.message}`);
    else updated += batch.length;
  }
  return { added, updated };
}

export async function touchMonitored(admin: SupabaseClient, ownerId: string, platform: Platform) {
  await admin
    .from("creators")
    .update({ last_discovered_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("platform", platform)
    .eq("is_monitored", true);
}
