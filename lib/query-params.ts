import {
  DOWNLOAD_STATUSES,
  PLATFORMS,
  REVIEW_STATUSES,
  SORT_OPTIONS,
  type ClipQuery,
  type ClipSort,
  type DownloadStatus,
  type Platform,
  type ReviewStatus,
} from "./types";

export type SearchParams = Record<string, string | string[] | undefined>;

export const DATE_PRESETS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90 } as const;
export type DatePreset = keyof typeof DATE_PRESETS;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | undefined) => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const presetToIso = (v: string | undefined) =>
  v && v in DATE_PRESETS ? new Date(Date.now() - DATE_PRESETS[v as DatePreset] * 3_600_000).toISOString() : undefined;

/** Parse URL search params into a validated ClipQuery (unknown values are ignored). */
export function parseClipSearchParams(sp: SearchParams): { query: ClipQuery; view: "grid" | "list" } {
  const platforms = (first(sp.platform) ?? "")
    .split(",")
    .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
  const statuses = (first(sp.status) ?? "")
    .split(",")
    .filter((s): s is ReviewStatus => (REVIEW_STATUSES as readonly string[]).includes(s));
  const sort = first(sp.sort);
  const dl = first(sp.download);

  return {
    view: first(sp.view) === "list" ? "list" : "grid",
    query: {
      search: first(sp.q)?.slice(0, 200) || undefined,
      platforms: platforms.length ? platforms : undefined,
      reviewStatuses: statuses.length ? statuses : undefined,
      downloadStatus: dl && (DOWNLOAD_STATUSES as readonly string[]).includes(dl) ? (dl as DownloadStatus) : undefined,
      creatorId: first(sp.creator)?.slice(0, 100) || undefined,
      category: first(sp.category)?.slice(0, 100) || undefined,
      minViews: num(first(sp.minViews)),
      maxDuration: num(first(sp.maxDuration)),
      minScore: num(first(sp.minScore)),
      uploadedAfter: presetToIso(first(sp.uploaded)),
      discoveredAfter: presetToIso(first(sp.discovered)),
      favoritesOnly: first(sp.fav) === "1" || undefined,
      sort: sort && (SORT_OPTIONS as readonly string[]).includes(sort) ? (sort as ClipSort) : undefined,
      page: Math.max(1, Math.floor(num(first(sp.page)) ?? 1)),
    },
  };
}

export const SORT_LABEL: Record<ClipSort, string> = {
  discovered_desc: "Newest discovered",
  uploaded_desc: "Newest uploaded",
  views_desc: "Most viewed",
  score_desc: "Highest viral score",
  engagement_desc: "Highest engagement",
};
