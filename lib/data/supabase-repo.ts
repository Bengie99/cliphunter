import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeViralScore, TRENDING_THRESHOLD } from "../scoring";
import {
  PIPELINE_STATUSES,
  PLATFORMS,
  type Clip,
  type ClipNote,
  type ClipPage,
  type ClipQuery,
  type CreatorWithStats,
  type DashboardStats,
  type NewClipInput,
  type Platform,
  type ReviewStatus,
} from "../types";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NotFoundError,
  PIPELINE_STAGES_MOVED_BY_REVIEW,
  type ClipRepository,
} from "./repository";

const CLIP_COLUMNS =
  "id, platform, external_clip_id, creator_id, creator_name, creator_url, title, description, original_url, " +
  "thumbnail_url, duration_seconds, views, likes, comments, category, language, uploaded_at, discovered_at, " +
  "last_checked_at, viral_score, review_status, pipeline_status, rights_status, download_status, source, " +
  "created_at, updated_at";

type ClipRow = Omit<Clip, "is_favorite" | "note_count"> & {
  clip_favorites?: { id: string }[];
  clip_notes?: { count: number }[];
};

function toClip(row: ClipRow): Clip {
  const { clip_favorites, clip_notes, ...rest } = row;
  return {
    ...rest,
    // bigint columns can arrive as strings for very large values
    views: rest.views == null ? null : Number(rest.views),
    likes: rest.likes == null ? null : Number(rest.likes),
    comments: rest.comments == null ? null : Number(rest.comments),
    is_favorite: (clip_favorites?.length ?? 0) > 0,
    note_count: clip_notes?.[0]?.count ?? 0,
  };
}

/** Strip characters that have meaning in PostgREST filter syntax. */
function sanitizeSearch(s: string) {
  return s.replace(/[,()*%\\:."']/g, " ").trim();
}

function fail(context: string, error: { message: string; code?: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

export class SupabaseRepository implements ClipRepository {
  readonly mode = "supabase" as const;

  constructor(private readonly sb: SupabaseClient) {}

  private select(favoritesOnly = false) {
    return `${CLIP_COLUMNS}, clip_favorites${favoritesOnly ? "!inner" : ""}(id), clip_notes(count)`;
  }

  async listClips(q: ClipQuery): Promise<ClipPage> {
    const pageSize = Math.min(q.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const page = Math.max(1, q.page ?? 1);
    let query = this.sb.from("clips").select(this.select(q.favoritesOnly), { count: "exact" });

    const search = q.search ? sanitizeSearch(q.search) : "";
    if (search) query = query.or(`title.ilike.*${search}*,creator_name.ilike.*${search}*`);
    if (q.platforms?.length) query = query.in("platform", q.platforms);
    if (q.reviewStatuses?.length) query = query.in("review_status", q.reviewStatuses);
    if (q.downloadStatus) query = query.eq("download_status", q.downloadStatus);
    if (q.creatorId) query = query.eq("creator_id", q.creatorId);
    if (q.category) query = query.eq("category", q.category);
    if (q.minViews != null) query = query.gte("views", q.minViews);
    if (q.maxDuration != null) query = query.or(`duration_seconds.is.null,duration_seconds.lte.${Math.floor(q.maxDuration)}`);
    if (q.minScore != null) query = query.gte("viral_score", q.minScore);
    if (q.uploadedAfter) query = query.gte("uploaded_at", q.uploadedAfter);
    if (q.discoveredAfter) query = query.gte("discovered_at", q.discoveredAfter);

    switch (q.sort ?? "discovered_desc") {
      case "uploaded_desc":
        query = query.order("uploaded_at", { ascending: false, nullsFirst: false });
        break;
      case "views_desc":
        query = query.order("views", { ascending: false, nullsFirst: false });
        break;
      case "score_desc":
        query = query.order("viral_score", { ascending: false, nullsFirst: false });
        break;
      case "engagement_desc":
        query = query.order("engagement_rate", { ascending: false, nullsFirst: false });
        break;
    }
    query = query.order("discovered_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) fail("Loading clips failed", error);
    return { clips: (data as unknown as ClipRow[]).map(toClip), total: count ?? 0, page, pageSize };
  }

  async getClip(id: string) {
    const { data, error } = await this.sb.from("clips").select(this.select()).eq("id", id).maybeSingle();
    if (error) fail("Loading clip failed", error);
    return data ? toClip(data as unknown as ClipRow) : null;
  }

  async findClipByExternalId(platform: Platform, externalId: string) {
    const { data, error } = await this.sb
      .from("clips")
      .select(this.select())
      .eq("platform", platform)
      .eq("external_clip_id", externalId)
      .maybeSingle();
    if (error) fail("Duplicate check failed", error);
    return data ? toClip(data as unknown as ClipRow) : null;
  }

  async createClip(input: NewClipInput) {
    const existing = await this.findClipByExternalId(input.platform, input.external_clip_id);
    if (existing) return { clip: existing, duplicate: true };

    let creatorId: string | null = null;
    if (input.creator_name) {
      const { data: creator, error } = await this.sb
        .from("creators")
        .upsert(
          {
            platform: input.platform,
            external_creator_id: (input.creator_external_id ?? input.creator_name).toLowerCase(),
            name: input.creator_name,
            profile_url: input.creator_url ?? null,
            category: input.category ?? null,
          },
          { onConflict: "owner_id,platform,external_creator_id", ignoreDuplicates: false },
        )
        .select("id")
        .single();
      if (error) fail("Saving creator failed", error);
      creatorId = creator.id;
    }

    const { data, error } = await this.sb
      .from("clips")
      .insert({
        platform: input.platform,
        external_clip_id: input.external_clip_id,
        creator_id: creatorId,
        creator_name: input.creator_name ?? null,
        creator_url: input.creator_url ?? null,
        title: input.title,
        description: input.description ?? null,
        original_url: input.original_url,
        thumbnail_url: input.thumbnail_url ?? null,
        duration_seconds: input.duration_seconds ?? null,
        views: input.views ?? null,
        likes: input.likes ?? null,
        comments: input.comments ?? null,
        category: input.category ?? null,
        language: input.language ?? null,
        uploaded_at: input.uploaded_at ?? null,
        last_checked_at: new Date().toISOString(),
        viral_score: computeViralScore({
          views: input.views ?? null,
          likes: input.likes ?? null,
          comments: input.comments ?? null,
          uploaded_at: input.uploaded_at ?? null,
        }),
        rights_status: input.rights_status ?? "unknown",
        source: input.source ?? "manual",
      })
      .select(this.select())
      .single();

    if (error) {
      // Lost a race with a concurrent insert of the same clip
      if (error.code === "23505") {
        const dup = await this.findClipByExternalId(input.platform, input.external_clip_id);
        if (dup) return { clip: dup, duplicate: true };
      }
      fail("Saving clip failed", error);
    }
    const clip = toClip(data as unknown as ClipRow);
    if (input.note?.trim()) await this.addNote(clip.id, input.note.trim());
    return { clip: { ...clip, note_count: input.note?.trim() ? 1 : 0 }, duplicate: false };
  }

  async setReviewStatus(ids: string[], status: ReviewStatus) {
    if (!ids.length) return 0;
    const { data, error } = await this.sb.from("clips").update({ review_status: status }).in("id", ids).select("id");
    if (error) fail("Updating review status failed", error);
    const move = PIPELINE_STAGES_MOVED_BY_REVIEW[status];
    if (move) {
      const { error: pErr } = await this.sb
        .from("clips")
        .update({ pipeline_status: move.to })
        .in("id", ids)
        .in("pipeline_status", move.from);
      if (pErr) fail("Updating pipeline stage failed", pErr);
    }
    return data.length;
  }

  async setFavorite(ids: string[], favorite: boolean) {
    if (!ids.length) return;
    if (favorite) {
      const { error } = await this.sb
        .from("clip_favorites")
        .upsert(
          ids.map((clip_id) => ({ clip_id })),
          { onConflict: "owner_id,clip_id", ignoreDuplicates: true },
        );
      if (error) fail("Adding favorite failed", error);
    } else {
      const { error } = await this.sb.from("clip_favorites").delete().in("clip_id", ids);
      if (error) fail("Removing favorite failed", error);
    }
  }

  async listNotes(clipId: string): Promise<ClipNote[]> {
    const { data, error } = await this.sb
      .from("clip_notes")
      .select("id, clip_id, note, created_at, updated_at")
      .eq("clip_id", clipId)
      .order("created_at", { ascending: false });
    if (error) fail("Loading notes failed", error);
    return data;
  }

  async addNote(clipId: string, note: string): Promise<ClipNote> {
    const { data, error } = await this.sb
      .from("clip_notes")
      .insert({ clip_id: clipId, note })
      .select("id, clip_id, note, created_at, updated_at")
      .single();
    if (error) {
      if (error.code === "23503") throw new NotFoundError("Clip not found");
      fail("Saving note failed", error);
    }
    return data;
  }

  async deleteNote(noteId: string) {
    const { error } = await this.sb.from("clip_notes").delete().eq("id", noteId);
    if (error) fail("Deleting note failed", error);
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const { data, error } = await this.sb.rpc("dashboard_stats", { trending_threshold: TRENDING_THRESHOLD, days: 14 });
    if (error) fail("Loading dashboard stats failed", error);
    const d = data as {
      total: number;
      new_today: number;
      trending: number;
      awaiting_review: number;
      approved: number;
      downloaded: number;
      by_platform: Record<string, number>;
      by_pipeline: Record<string, number>;
      per_day: { day: string; count: number }[] | null;
    };
    const byPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, Number(d.by_platform?.[p] ?? 0)])) as DashboardStats["byPlatform"];
    const byPipeline = Object.fromEntries(
      PIPELINE_STATUSES.map((p) => [p, Number(d.by_pipeline?.[p] ?? 0)]),
    ) as DashboardStats["byPipeline"];
    return {
      total: Number(d.total),
      newToday: Number(d.new_today),
      trending: Number(d.trending),
      awaitingReview: Number(d.awaiting_review),
      approved: Number(d.approved),
      downloaded: Number(d.downloaded),
      byPlatform,
      byPipeline,
      perDay: (d.per_day ?? []).map((r) => ({ day: String(r.day).slice(0, 10), count: Number(r.count) })),
    };
  }

  async listCreators(): Promise<CreatorWithStats[]> {
    const { data, error } = await this.sb
      .from("creators")
      .select("id, platform, external_creator_id, name, profile_url, profile_image, category, is_monitored, created_at, " +
          "permission_status, permission_proof_url, permission_granted_at, permission_notes, bio_clip_excerpt, bio_checked_at, clips(viral_score)")
      .order("name");
    if (error) fail("Loading creators failed", error);
    return (data as unknown as (CreatorWithStats & { clips: { viral_score: number | null }[] })[])
      .map(({ clips, ...c }) => {
        const scored = clips.filter((x) => x.viral_score != null);
        return {
          ...c,
          clip_count: clips.length,
          avg_viral_score: scored.length ? Math.round(scored.reduce((s, x) => s + (x.viral_score ?? 0), 0) / scored.length) : null,
        };
      })
      .sort((a, b) => b.clip_count - a.clip_count);
  }

  async listCategories() {
    const { data, error } = await this.sb.from("clips").select("category").not("category", "is", null).limit(1000);
    if (error) fail("Loading categories failed", error);
    return [...new Set(data.map((r) => r.category as string))].sort();
  }
}
