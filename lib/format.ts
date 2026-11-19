import type { DownloadStatus, PipelineStatus, ReviewStatus, RightsStatus } from "./types";

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Parses "mm:ss", "h:mm:ss" or plain seconds. Returns null when empty/invalid. */
export function parseDuration(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
  const parts = v.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p) || p < 0) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function timeAgo(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "y"],
    [60 * 60 * 24 * 30, "mo"],
    [60 * 60 * 24 * 7, "w"],
    [60 * 60 * 24, "d"],
    [60 * 60, "h"],
    [60, "m"],
  ];
  for (const [secs, label] of units) {
    if (diff >= secs) return `${Math.floor(diff / secs)}${label} ago`;
  }
  return "just now";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
};

export const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  discovered: "Discovered",
  awaiting_review: "Awaiting Review",
  approved: "Approved",
  ready_for_download: "Ready for Download",
  downloaded: "Downloaded",
  ready_for_editing: "Ready for Editing",
  editing: "Editing in Progress",
  edited: "Edited",
  ready_to_publish: "Ready to Publish",
  published: "Published",
};

export const RIGHTS_LABEL: Record<RightsStatus, string> = {
  unknown: "Unknown",
  public_discoverable: "Publicly discoverable",
  preview_allowed: "Preview allowed",
  download_authorized: "Download authorized",
  republish_authorized: "Republish authorized",
};

export const RIGHTS_HINT: Record<RightsStatus, string> = {
  unknown: "No rights information recorded yet.",
  public_discoverable: "Publicly visible. Discovery does not imply permission to download or republish.",
  preview_allowed: "Can be previewed via the platform's official embed.",
  download_authorized: "You have permission to download the source footage.",
  republish_authorized: "You have permission to republish (e.g. creator approval or licence on file).",
};

export const DOWNLOAD_LABEL: Record<DownloadStatus, string> = {
  not_available: "Not available",
  awaiting_authorization: "Awaiting authorization",
  ready: "Ready to download",
  queued: "Queued",
  downloading: "Downloading",
  downloaded: "Downloaded",
  failed: "Failed",
};
