/**
 * DEMO DATA ONLY. Used exclusively by the demo repository (local JSON file).
 * It is never written to Supabase. All creators are fictional, and every
 * external id starts with "demo-" so the UI can tell these apart from real
 * clips (e.g. no embed player is loaded for them).
 */
import { computeViralScore } from "../scoring";
import type { Platform, PipelineStatus, ReviewStatus, RightsStatus } from "../types";
import type { DemoClipRow, DemoCreatorRow, DemoDb } from "./demo-repo";

// Small deterministic PRNG so the seed looks the same on every machine.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CREATORS: { name: string; platform: Platform; relevance: number }[] = [
  { name: "LibertyLarry", platform: "twitch", relevance: 82 },
  { name: "BohanBandit", platform: "twitch", relevance: 64 },
  { name: "AlgonquinAce", platform: "youtube", relevance: 71 },
  { name: "DukesDrifter", platform: "kick", relevance: 48 },
  { name: "BrokerBuster", platform: "tiktok", relevance: 55 },
  { name: "StarJunctionSam", platform: "youtube", relevance: 38 },
  { name: "AldernyAndy", platform: "instagram", relevance: 30 },
  { name: "HoveBeachHank", platform: "twitch", relevance: 58 },
  { name: "ChaseCamCarla", platform: "kick", relevance: 44 },
];

const TITLES = [
  "Car flew off the Broker Bridge and landed on a bus",
  "5-star wanted level escape through Algonquin subway",
  "Euphoria ragdoll down the stairs is pure comedy",
  "Helicopter crash right on top of Star Junction",
  "Cops crash into each other at the worst possible moment",
  "Perfect bike stunt off the Middle Park jump",
  "Taxi ride turns into full-scale police chase",
  "Bowling night goes horribly wrong",
  "Fell off the Rotterdam Tower and somehow survived",
  "Most chaotic multiplayer cops 'n crooks round ever",
  "Rocket launcher vs. NOOSE APC — who wins?",
  "Boat jump over the Humboldt River in one take",
  "Physics glitch launches truck into the stratosphere",
  "Drunk driving minigame is still the funniest thing ever",
  "Speedrunner clips through the Bohan safehouse wall",
  "Car lands perfectly in parking spot after 200m jump",
  "Pedestrian AI fights back and wins",
  "Insane 1v8 shootout on Happiness Island",
  "Cop car slides across the frozen street for 30 seconds",
  "Ragdoll chain reaction knocks over 12 people",
  "Unlucky motorcycle wheelie into a lamppost",
  "Police helicopter follows a stolen garbage truck",
  "Funniest Brucie phone call reaction",
  "Final mission chase but everything goes wrong",
  "No-damage run through the hospital shootout",
  "Mod makes every car a monster truck",
  "Streamer screams as plane clips the Statue of Happiness",
  "Bus full of NPCs drives off the pier",
  "Precision parking challenge — 1 attempt",
  "Liberty City rush hour pile-up of the century",
];

const CATEGORY = "Grand Theft Auto IV";

export function buildDemoDb(now = new Date()): DemoDb {
  const rand = mulberry32(4);
  const iso = (d: Date) => d.toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  const creators: DemoCreatorRow[] = CREATORS.map((c, i) => ({
    id: `demo-creator-${i + 1}`,
    platform: c.platform,
    external_creator_id: `demo-${c.name.toLowerCase()}`,
    name: c.name,
    profile_url: null,
    profile_image: null,
    category: CATEGORY,
    is_monitored: i < 5,
    created_at: iso(hoursAgo(24 * 20)),
  }));

  const clips: DemoClipRow[] = [];
  const metricsHistory: DemoDb["metricsHistory"] = [];
  const pipelineHistory: DemoDb["pipelineHistory"] = [];
  const favorites: string[] = [];
  const notes: DemoDb["notes"] = [];

  const COUNT = 64;
  for (let i = 0; i < COUNT; i++) {
    const ci = Math.floor(rand() * CREATORS.length);
    const creatorMeta = CREATORS[ci];
    const creator = creators[ci];
    // A few "breakout" clips: fresh and blowing up — these become viral candidates.
    const breakout = rand() < 0.1;
    const discoveredHoursAgo = breakout ? Math.floor(rand() * 20) : Math.floor(Math.pow(rand(), 1.4) * 24 * 14);
    const uploadedHoursAgo = discoveredHoursAgo + 1 + Math.floor(rand() * (breakout ? 4 : 36));
    const isShortForm = creatorMeta.platform !== "twitch" && creatorMeta.platform !== "kick";
    const popularity = breakout ? 0.5 + rand() * 0.5 : Math.pow(rand(), 3);
    const views = Math.round(500 + popularity * (isShortForm ? 900_000 : 150_000) * (breakout ? 2 : 1));
    const hasEngagement = creatorMeta.platform !== "twitch" && creatorMeta.platform !== "kick";
    const likes = hasEngagement ? Math.round(views * (0.02 + rand() * 0.09)) : null;
    const comments = hasEngagement ? Math.round(views * (0.001 + rand() * 0.008)) : null;

    // Two synthetic snapshots so growth contributes to the score.
    const prevViews = Math.round(views * (0.8 + rand() * 0.19));
    const snapA = { views: prevViews, recorded_at: iso(hoursAgo(discoveredHoursAgo + 6)) };
    const snapB = { views, recorded_at: iso(hoursAgo(Math.max(0, discoveredHoursAgo - 3))) };

    const score = computeViralScore({
      views,
      likes,
      comments,
      uploaded_at: iso(hoursAgo(uploadedHoursAgo)),
      history: [snapA, snapB],
      creatorRelevance: creatorMeta.relevance,
      now,
    });

    // Older clips are more likely to have been reviewed already.
    const r = rand();
    let review: ReviewStatus = "pending";
    if (discoveredHoursAgo > 30) {
      review = r < 0.35 ? "approved" : r < 0.6 ? "rejected" : r < 0.68 ? "archived" : "pending";
    }
    let pipeline: PipelineStatus = review === "approved" ? "approved" : "awaiting_review";
    if (review === "approved" && discoveredHoursAgo > 120) {
      const advanced: PipelineStatus[] = ["ready_for_download", "ready_for_editing", "editing", "edited", "published"];
      pipeline = advanced[Math.floor(rand() * advanced.length)];
    }
    const rights: RightsStatus = rand() < 0.15 ? "republish_authorized" : rand() < 0.5 ? "preview_allowed" : "public_discoverable";

    const id = `demo-clip-${String(i + 1).padStart(3, "0")}`;
    const discoveredAt = iso(hoursAgo(discoveredHoursAgo));
    clips.push({
      id,
      platform: creatorMeta.platform,
      external_clip_id: `demo-${i + 1}`,
      creator_id: creator.id,
      creator_name: creator.name,
      creator_url: null,
      title: TITLES[i % TITLES.length],
      description: null,
      original_url: `https://example.com/demo-clip/${i + 1}`,
      thumbnail_url: null,
      duration_seconds: isShortForm ? 12 + Math.floor(rand() * 48) : 15 + Math.floor(rand() * 45),
      views,
      likes,
      comments,
      category: CATEGORY,
      language: rand() < 0.85 ? "en" : "de",
      uploaded_at: iso(hoursAgo(uploadedHoursAgo)),
      discovered_at: discoveredAt,
      last_checked_at: snapB.recorded_at,
      viral_score: score,
      review_status: review,
      pipeline_status: pipeline,
      rights_status: rights,
      download_status: "not_available",
      source: "discovery",
      created_at: discoveredAt,
      updated_at: discoveredAt,
    });
    metricsHistory.push({ clip_id: id, views: snapA.views, likes: null, comments: null, recorded_at: snapA.recorded_at });
    metricsHistory.push({ clip_id: id, views, likes, comments, recorded_at: snapB.recorded_at });
    pipelineHistory.push({ clip_id: id, previous_status: null, new_status: pipeline, changed_at: discoveredAt });
    if (rand() < 0.12) favorites.push(id);
    if (i % 9 === 0) {
      notes.push({
        id: `demo-note-${i}`,
        clip_id: id,
        note: "Good hook in the first 3 seconds — could open a compilation.",
        created_at: discoveredAt,
        updated_at: discoveredAt,
      });
    }
  }

  return { version: 1, seededAt: iso(now), creators, clips, favorites, notes, metricsHistory, pipelineHistory };
}
