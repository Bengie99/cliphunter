/**
 * Viral score — first version of the model from the brief (section 7).
 *
 *   Views per hour ............ 35%
 *   Engagement rate ........... 25%
 *   Recent view growth ........ 25%   (needs >= 2 metric snapshots)
 *   Creator relevance ......... 15%   (needs creator stats — Phase 3)
 *
 * Each component is normalised to 0–100 on a log scale so that a clip with
 * 2M views doesn't trivially dwarf one with 20k. Components whose inputs are
 * missing are dropped and the remaining weights are re-normalised, so a clip
 * is never penalised for metrics a platform doesn't expose.
 *
 * Clip age is accounted for because the dominant term is views *per hour*,
 * not total views — an old clip with many total views scores below a fresh
 * clip that is accumulating views quickly.
 */

export interface ScoreWeights {
  viewsPerHour: number;
  engagement: number;
  growth: number;
  creator: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  viewsPerHour: 0.35,
  engagement: 0.25,
  growth: 0.25,
  creator: 0.15,
};

export interface MetricSnapshot {
  views: number;
  recorded_at: string;
}

export interface ScoreInput {
  views: number | null;
  likes: number | null;
  comments: number | null;
  uploaded_at: string | null;
  /** Ordered oldest → newest. */
  history?: MetricSnapshot[];
  /** 0–100 relevance for the creator, if known. */
  creatorRelevance?: number | null;
  now?: Date;
}

// Reference points that map to a component score of 100.
const VPH_CEILING = 50_000; // 50k views/hour ⇒ max
const ENGAGEMENT_CEILING = 0.12; // 12% (likes+comments)/views ⇒ max
const GROWTH_CEILING = 20_000; // +20k views/hour between snapshots ⇒ max

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const logNorm = (value: number, ceiling: number) =>
  clamp((Math.log10(Math.max(0, value) + 1) / Math.log10(ceiling + 1)) * 100);

export function computeViralScore(input: ScoreInput, weights: ScoreWeights = DEFAULT_WEIGHTS): number | null {
  const now = input.now ?? new Date();
  const parts: { score: number; weight: number }[] = [];

  if (input.views != null && input.uploaded_at) {
    const ageHours = Math.max(1, (now.getTime() - new Date(input.uploaded_at).getTime()) / 3_600_000);
    parts.push({ score: logNorm(input.views / ageHours, VPH_CEILING), weight: weights.viewsPerHour });
  }

  if (input.views && input.views > 0 && (input.likes != null || input.comments != null)) {
    const rate = ((input.likes ?? 0) + (input.comments ?? 0)) / input.views;
    parts.push({ score: clamp((rate / ENGAGEMENT_CEILING) * 100), weight: weights.engagement });
  }

  const h = input.history ?? [];
  if (h.length >= 2) {
    const a = h[h.length - 2];
    const b = h[h.length - 1];
    const hours = (new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()) / 3_600_000;
    if (hours > 0) {
      parts.push({ score: logNorm((b.views - a.views) / hours, GROWTH_CEILING), weight: weights.growth });
    }
  }

  if (input.creatorRelevance != null) {
    parts.push({ score: clamp(input.creatorRelevance), weight: weights.creator });
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (parts.length === 0 || totalWeight === 0) return null;
  return Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight);
}

export type ScoreTier = "low" | "interesting" | "high" | "viral";

export function scoreTier(score: number | null): ScoreTier | null {
  if (score == null) return null;
  if (score <= 30) return "low";
  if (score <= 60) return "interesting";
  if (score <= 80) return "high";
  return "viral";
}

export const SCORE_TIER_META: Record<ScoreTier, { label: string; className: string }> = {
  low: { label: "Low potential", className: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
  interesting: { label: "Interesting", className: "text-sky-300 bg-sky-500/10 border-sky-500/25" },
  high: { label: "High potential", className: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  viral: { label: "Viral candidate", className: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30" },
};

/** Score >= this counts as "trending" on the dashboard. */
export const TRENDING_THRESHOLD = 61;
