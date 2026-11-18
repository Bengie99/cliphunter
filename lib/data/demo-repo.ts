/**
 * Demo repository — a local JSON file at .data/demo-db.json.
 *
 * Active when Supabase isn't configured. It exists so the UI can be developed
 * and tried with realistic sample data, kept strictly apart from production.
 * Reset with `npm run demo:reset`.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { computeViralScore, TRENDING_THRESHOLD } from "../scoring";
import {
  PIPELINE_STATUSES,
  PLATFORMS,
  type Clip,
  type ClipNote,
  type ClipPage,
  type ClipQuery,
  type Creator,
  type CreatorWithStats,
  type DashboardStats,
  type NewClipInput,
  type Platform,
  type ReviewStatus,
} from "../types";
import { buildDemoDb } from "./demo-seed";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NotFoundError,
  pipelineAfterReview,
  type ClipRepository,
} from "./repository";

export type DemoClipRow = Omit<Clip, "is_favorite" | "note_count">;
export type DemoCreatorRow = Creator;

export interface DemoDb {
  version: 1;
  seededAt: string;
  creators: DemoCreatorRow[];
  clips: DemoClipRow[];
  favorites: string[];
  notes: ClipNote[];
  metricsHistory: { clip_id: string; views: number | null; likes: number | null; comments: number | null; recorded_at: string }[];
  pipelineHistory: { clip_id: string; previous_status: string | null; new_status: string; changed_at: string }[];
}

export class DemoRepository implements ClipRepository {
  readonly mode = "demo" as const;

  constructor(private readonly file = path.join(process.cwd(), ".data", "demo-db.json")) {}

  // -- persistence ----------------------------------------------------------
  private load(): DemoDb {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as DemoDb;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const db = buildDemoDb();
      this.save(db);
      return db;
    }
  }

  private save(db: DemoDb) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, this.file);
  }

  private hydrate(db: DemoDb, row: DemoClipRow): Clip {
    return {
      ...row,
      is_favorite: db.favorites.includes(row.id),
      note_count: db.notes.filter((n) => n.clip_id === row.id).length,
    };
  }

  // -- clips ----------------------------------------------------------------
  async listClips(q: ClipQuery): Promise<ClipPage> {
    const db = this.load();
    const search = q.search?.trim().toLowerCase();
    let rows = db.clips.filter((c) => {
      if (search && !c.title.toLowerCase().includes(search) && !(c.creator_name ?? "").toLowerCase().includes(search)) return false;
      if (q.platforms?.length && !q.platforms.includes(c.platform)) return false;
      if (q.reviewStatuses?.length && !q.reviewStatuses.includes(c.review_status)) return false;
      if (q.downloadStatus && c.download_status !== q.downloadStatus) return false;
      if (q.creatorId && c.creator_id !== q.creatorId) return false;
      if (q.category && c.category !== q.category) return false;
      if (q.minViews != null && (c.views ?? 0) < q.minViews) return false;
      if (q.maxDuration != null && c.duration_seconds != null && c.duration_seconds > q.maxDuration) return false;
      if (q.minScore != null && (c.viral_score ?? -1) < q.minScore) return false;
      if (q.uploadedAfter && (!c.uploaded_at || c.uploaded_at < q.uploadedAfter)) return false;
      if (q.discoveredAfter && c.discovered_at < q.discoveredAfter) return false;
      if (q.favoritesOnly && !db.favorites.includes(c.id)) return false;
      return true;
    });

    const nullsLast = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity);
    const engagement = (c: DemoClipRow) =>
      c.views && (c.likes != null || c.comments != null) ? ((c.likes ?? 0) + (c.comments ?? 0)) / c.views : null;
    const sorters: Record<NonNullable<ClipQuery["sort"]>, (a: DemoClipRow, b: DemoClipRow) => number> = {
      discovered_desc: (a, b) => b.discovered_at.localeCompare(a.discovered_at),
      uploaded_desc: (a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""),
      views_desc: (a, b) => nullsLast(a.views, b.views),
      score_desc: (a, b) => nullsLast(a.viral_score, b.viral_score),
      engagement_desc: (a, b) => nullsLast(engagement(a), engagement(b)),
    };
    rows = [...rows].sort((a, b) => sorters[q.sort ?? "discovered_desc"](a, b) || b.discovered_at.localeCompare(a.discovered_at));

    const pageSize = Math.min(q.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const page = Math.max(1, q.page ?? 1);
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return { clips: slice.map((r) => this.hydrate(db, r)), total: rows.length, page, pageSize };
  }

  async getClip(id: string) {
    const db = this.load();
    const row = db.clips.find((c) => c.id === id);
    return row ? this.hydrate(db, row) : null;
  }

  async findClipByExternalId(platform: Platform, externalId: string) {
    const db = this.load();
    const row = db.clips.find((c) => c.platform === platform && c.external_clip_id === externalId);
    return row ? this.hydrate(db, row) : null;
  }

  async createClip(input: NewClipInput) {
    const db = this.load();
    const existing = db.clips.find((c) => c.platform === input.platform && c.external_clip_id === input.external_clip_id);
    if (existing) return { clip: this.hydrate(db, existing), duplicate: true };

    const now = new Date().toISOString();
    let creatorId: string | null = null;
    if (input.creator_name) {
      const extId = (input.creator_external_id ?? input.creator_name).toLowerCase();
      let creator = db.creators.find((c) => c.platform === input.platform && c.external_creator_id === extId);
      if (!creator) {
        creator = {
          id: randomUUID(),
          platform: input.platform,
          external_creator_id: extId,
          name: input.creator_name,
          profile_url: input.creator_url ?? null,
          profile_image: null,
          category: input.category ?? null,
          is_monitored: false,
          created_at: now,
        };
        db.creators.push(creator);
      }
      creatorId = creator.id;
    }

    const row: DemoClipRow = {
      id: randomUUID(),
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
      discovered_at: now,
      last_checked_at: now,
      viral_score: computeViralScore({
        views: input.views ?? null,
        likes: input.likes ?? null,
        comments: input.comments ?? null,
        uploaded_at: input.uploaded_at ?? null,
      }),
      review_status: "pending",
      pipeline_status: "awaiting_review",
      rights_status: input.rights_status ?? "unknown",
      download_status: "not_available",
      source: input.source ?? "manual",
      created_at: now,
      updated_at: now,
    };
    db.clips.push(row);
    db.pipelineHistory.push({ clip_id: row.id, previous_status: null, new_status: row.pipeline_status, changed_at: now });
    if (row.views != null || row.likes != null || row.comments != null) {
      db.metricsHistory.push({ clip_id: row.id, views: row.views, likes: row.likes, comments: row.comments, recorded_at: now });
    }
    if (input.note?.trim()) {
      db.notes.push({ id: randomUUID(), clip_id: row.id, note: input.note.trim(), created_at: now, updated_at: now });
    }
    this.save(db);
    return { clip: this.hydrate(db, row), duplicate: false };
  }

  async setReviewStatus(ids: string[], status: ReviewStatus) {
    const db = this.load();
    const now = new Date().toISOString();
    let changed = 0;
    for (const c of db.clips) {
      if (!ids.includes(c.id)) continue;
      const nextPipeline = pipelineAfterReview(status, c.pipeline_status);
      if (nextPipeline !== c.pipeline_status) {
        db.pipelineHistory.push({ clip_id: c.id, previous_status: c.pipeline_status, new_status: nextPipeline, changed_at: now });
        c.pipeline_status = nextPipeline;
      }
      c.review_status = status;
      c.updated_at = now;
      changed++;
    }
    this.save(db);
    return changed;
  }

  async setFavorite(ids: string[], favorite: boolean) {
    const db = this.load();
    const known = new Set(db.clips.map((c) => c.id));
    const set = new Set(db.favorites);
    for (const id of ids) {
      if (!known.has(id)) continue;
      if (favorite) set.add(id);
      else set.delete(id);
    }
    db.favorites = [...set];
    this.save(db);
  }

  // -- notes ----------------------------------------------------------------
  async listNotes(clipId: string) {
    return this.load()
      .notes.filter((n) => n.clip_id === clipId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addNote(clipId: string, note: string) {
    const db = this.load();
    if (!db.clips.some((c) => c.id === clipId)) throw new NotFoundError("Clip not found");
    const now = new Date().toISOString();
    const row: ClipNote = { id: randomUUID(), clip_id: clipId, note, created_at: now, updated_at: now };
    db.notes.push(row);
    this.save(db);
    return row;
  }

  async deleteNote(noteId: string) {
    const db = this.load();
    db.notes = db.notes.filter((n) => n.id !== noteId);
    this.save(db);
  }

  // -- aggregates -----------------------------------------------------------
  async getDashboardStats(): Promise<DashboardStats> {
    const db = this.load();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const byPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as DashboardStats["byPlatform"];
    const byPipeline = Object.fromEntries(PIPELINE_STATUSES.map((p) => [p, 0])) as DashboardStats["byPipeline"];
    const days = 14;
    const perDayMap = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(startOfToday.getTime() - i * 86_400_000);
      perDayMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const c of db.clips) {
      byPlatform[c.platform]++;
      if (c.review_status !== "rejected" && c.review_status !== "archived") byPipeline[c.pipeline_status]++;
      const day = c.discovered_at.slice(0, 10);
      if (perDayMap.has(day)) perDayMap.set(day, perDayMap.get(day)! + 1);
    }
    return {
      total: db.clips.length,
      newToday: db.clips.filter((c) => new Date(c.discovered_at) >= startOfToday).length,
      trending: db.clips.filter(
        (c) => (c.viral_score ?? 0) >= TRENDING_THRESHOLD && (c.review_status === "pending" || c.review_status === "approved"),
      ).length,
      awaitingReview: db.clips.filter((c) => c.review_status === "pending").length,
      approved: db.clips.filter((c) => c.review_status === "approved").length,
      downloaded: db.clips.filter((c) => c.download_status === "downloaded").length,
      byPlatform,
      byPipeline,
      perDay: [...perDayMap].map(([day, count]) => ({ day, count })),
    };
  }

  async listCreators(): Promise<CreatorWithStats[]> {
    const db = this.load();
    return db.creators
      .map((cr) => {
        const clips = db.clips.filter((c) => c.creator_id === cr.id);
        const scored = clips.filter((c) => c.viral_score != null);
        return {
          ...cr,
          clip_count: clips.length,
          avg_viral_score: scored.length
            ? Math.round(scored.reduce((s, c) => s + (c.viral_score ?? 0), 0) / scored.length)
            : null,
        };
      })
      .sort((a, b) => b.clip_count - a.clip_count);
  }

  async listCategories() {
    const set = new Set(this.load().clips.map((c) => c.category).filter((c): c is string => Boolean(c)));
    return [...set].sort();
  }
}
