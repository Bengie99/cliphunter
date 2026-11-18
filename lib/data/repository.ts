import type {
  Clip,
  ClipNote,
  ClipPage,
  ClipQuery,
  CreatorWithStats,
  DashboardStats,
  NewClipInput,
  PipelineStatus,
  Platform,
  ReviewStatus,
} from "../types";

/**
 * Storage-agnostic data access. Pages and server actions only talk to this
 * interface, so the Supabase and demo implementations are interchangeable.
 */
export interface ClipRepository {
  readonly mode: "demo" | "supabase";

  listClips(query: ClipQuery): Promise<ClipPage>;
  getClip(id: string): Promise<Clip | null>;
  findClipByExternalId(platform: Platform, externalId: string): Promise<Clip | null>;
  /** Inserts a clip unless platform+external id already exists. */
  createClip(input: NewClipInput): Promise<{ clip: Clip; duplicate: boolean }>;

  setReviewStatus(ids: string[], status: ReviewStatus): Promise<number>;
  setFavorite(ids: string[], favorite: boolean): Promise<void>;

  listNotes(clipId: string): Promise<ClipNote[]>;
  addNote(clipId: string, note: string): Promise<ClipNote>;
  deleteNote(noteId: string): Promise<void>;

  getDashboardStats(): Promise<DashboardStats>;
  listCreators(): Promise<CreatorWithStats[]>;
  listCategories(): Promise<string[]>;
}

export class NotFoundError extends Error {}

/**
 * How a review decision moves the clip through the content pipeline.
 * Rejecting/archiving leaves the pipeline stage untouched (the review status
 * already hides it from active views), so restoring is lossless.
 */
export function pipelineAfterReview(status: ReviewStatus, current: PipelineStatus): PipelineStatus {
  if (status === "approved" && (current === "discovered" || current === "awaiting_review")) return "approved";
  if (status === "pending" && (current === "discovered" || current === "approved")) return "awaiting_review";
  return current;
}

export const PIPELINE_STAGES_MOVED_BY_REVIEW: Record<ReviewStatus, { from: PipelineStatus[]; to: PipelineStatus } | null> = {
  approved: { from: ["discovered", "awaiting_review"], to: "approved" },
  pending: { from: ["discovered", "approved"], to: "awaiting_review" },
  rejected: null,
  archived: null,
};

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
