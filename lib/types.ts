// Shared domain types. These mirror the Postgres schema in supabase/migrations.

export const PLATFORMS = ["twitch", "youtube", "kick", "tiktok", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected", "archived"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PIPELINE_STATUSES = [
  "discovered",
  "awaiting_review",
  "approved",
  "ready_for_download",
  "downloaded",
  "ready_for_editing",
  "editing",
  "edited",
  "ready_to_publish",
  "published",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/**
 * Rights are tracked separately from discovery: finding a clip publicly
 * never implies permission to download or republish it.
 */
export const RIGHTS_STATUSES = [
  "unknown",
  "public_discoverable",
  "preview_allowed",
  "download_authorized",
  "republish_authorized",
] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export const DOWNLOAD_STATUSES = [
  "not_available",
  "awaiting_authorization",
  "ready",
  "queued",
  "downloading",
  "downloaded",
  "failed",
] as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];

export type ClipSource = "manual" | "discovery";

/** Whether a creator has allowed us to clip/republish their content (with proof on file). */
export const PERMISSION_STATUSES = ["none", "requested", "granted", "denied"] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

export interface Creator {
  id: string;
  platform: Platform;
  external_creator_id: string;
  name: string;
  profile_url: string | null;
  profile_image: string | null;
  category: string | null;
  is_monitored: boolean;
  created_at: string;
  // Supabase only (absent in demo mode)
  permission_status?: PermissionStatus;
  permission_proof_url?: string | null;
  permission_granted_at?: string | null;
  permission_notes?: string | null;
}

export interface CreatorWithStats extends Creator {
  clip_count: number;
  avg_viral_score: number | null;
}

export interface Clip {
  id: string;
  platform: Platform;
  external_clip_id: string;
  creator_id: string | null;
  creator_name: string | null;
  creator_url: string | null;
  title: string;
  description: string | null;
  original_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  category: string | null;
  language: string | null;
  uploaded_at: string | null;
  discovered_at: string;
  last_checked_at: string | null;
  viral_score: number | null;
  review_status: ReviewStatus;
  pipeline_status: PipelineStatus;
  rights_status: RightsStatus;
  download_status: DownloadStatus;
  source: ClipSource;
  created_at: string;
  updated_at: string;
  // Derived for the current user
  is_favorite: boolean;
  note_count: number;
}

export interface ClipNote {
  id: string;
  clip_id: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export const SORT_OPTIONS = [
  "discovered_desc",
  "uploaded_desc",
  "views_desc",
  "score_desc",
  "engagement_desc",
] as const;
export type ClipSort = (typeof SORT_OPTIONS)[number];

export interface ClipQuery {
  search?: string;
  platforms?: Platform[];
  reviewStatuses?: ReviewStatus[];
  downloadStatus?: DownloadStatus;
  creatorId?: string;
  category?: string;
  minViews?: number;
  maxDuration?: number;
  minScore?: number;
  uploadedAfter?: string;
  discoveredAfter?: string;
  favoritesOnly?: boolean;
  sort?: ClipSort;
  page?: number;
  pageSize?: number;
}

export interface ClipPage {
  clips: Clip[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NewClipInput {
  platform: Platform;
  external_clip_id: string;
  original_url: string;
  title: string;
  creator_name?: string | null;
  creator_url?: string | null;
  creator_external_id?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  category?: string | null;
  language?: string | null;
  uploaded_at?: string | null;
  rights_status?: RightsStatus;
  source?: ClipSource;
  note?: string | null;
}

export interface DashboardStats {
  total: number;
  newToday: number;
  trending: number;
  awaitingReview: number;
  approved: number;
  downloaded: number;
  byPlatform: Record<Platform, number>;
  byPipeline: Record<PipelineStatus, number>;
  perDay: { day: string; count: number }[];
}
