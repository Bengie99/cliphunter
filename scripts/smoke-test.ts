/**
 * Smoke tests for Phase 1 core logic. Run: npm test
 * Uses a throwaway demo database in the OS temp dir — never touches .data/ or Supabase.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DemoRepository } from "../lib/data/demo-repo";
import { pipelineAfterReview } from "../lib/data/repository";
import { parseDuration } from "../lib/format";
import { getEmbedUrl, parseClipUrl } from "../lib/platforms";
import { parseClipSearchParams } from "../lib/query-params";
import { computeViralScore, scoreTier } from "../lib/scoring";

const results: { name: string; ok: boolean; err?: unknown }[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

async function main() {
  // --- URL parsing ---------------------------------------------------------
  await test("parses Twitch clip URLs", () => {
    const a = parseClipUrl("https://clips.twitch.tv/FunnyClipSlug-abc123");
    assert.equal(a?.platform, "twitch");
    assert.equal(a?.externalId, "FunnyClipSlug-abc123");
    const b = parseClipUrl("https://www.twitch.tv/somestreamer/clip/Slug-XYZ?filter=clips");
    assert.equal(b?.externalId, "Slug-XYZ");
    assert.equal(b?.creatorHandle, "somestreamer");
    assert.equal(parseClipUrl("https://www.twitch.tv/videos/123456")?.externalId, "v123456");
  });
  await test("parses YouTube URLs", () => {
    assert.equal(parseClipUrl("https://youtube.com/shorts/abcDEF12345?feature=share")?.externalId, "abcDEF12345");
    assert.equal(parseClipUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")?.externalId, "dQw4w9WgXcQ");
    assert.equal(parseClipUrl("https://youtu.be/dQw4w9WgXcQ")?.platform, "youtube");
    assert.equal(parseClipUrl("https://m.youtube.com/shorts/xyz")?.kind, "short");
  });
  await test("parses Kick, TikTok, Instagram URLs", () => {
    const k = parseClipUrl("https://kick.com/streamer/clips/clip_01ABC");
    assert.deepEqual([k?.platform, k?.externalId, k?.creatorHandle], ["kick", "clip_01ABC", "streamer"]);
    assert.equal(parseClipUrl("https://kick.com/streamer?clip=clip_02DEF")?.externalId, "clip_02DEF");
    const t = parseClipUrl("https://www.tiktok.com/@user.name/video/7300000000000000000?lang=en");
    assert.deepEqual([t?.platform, t?.externalId, t?.creatorHandle], ["tiktok", "7300000000000000000", "user.name"]);
    assert.equal(parseClipUrl("https://www.instagram.com/reel/C1a2b3c4/")?.externalId, "C1a2b3c4");
    assert.equal(parseClipUrl("https://www.instagram.com/someone/reel/C1a2b3c4/")?.creatorHandle, "someone");
  });
  await test("rejects unsupported URLs", () => {
    assert.equal(parseClipUrl("not a url"), null);
    assert.equal(parseClipUrl("https://example.com/video/1"), null);
    assert.equal(parseClipUrl("https://www.twitch.tv/somestreamer"), null);
    assert.equal(parseClipUrl("https://kick.com/streamer"), null);
  });
  await test("builds embed URLs with Twitch parent and none for Kick", () => {
    assert.match(getEmbedUrl("twitch", "Slug", "localhost")!, /parent=localhost/);
    assert.equal(getEmbedUrl("kick", "clip_1", "localhost"), null);
  });

  // --- formatting / params --------------------------------------------------
  await test("parses durations", () => {
    assert.equal(parseDuration("0:45"), 45);
    assert.equal(parseDuration("1:02:03"), 3723);
    assert.equal(parseDuration("30"), 30);
    assert.equal(parseDuration(""), null);
    assert.equal(parseDuration("abc"), null);
  });
  await test("parses search params and ignores junk", () => {
    const { query, view } = parseClipSearchParams({ platform: "twitch,bogus", status: "pending", sort: "nope", page: "-3", view: "list", minViews: "abc" });
    assert.deepEqual(query.platforms, ["twitch"]);
    assert.deepEqual(query.reviewStatuses, ["pending"]);
    assert.equal(query.sort, undefined);
    assert.equal(query.page, 1);
    assert.equal(query.minViews, undefined);
    assert.equal(view, "list");
  });

  // --- scoring ---------------------------------------------------------------
  const now = new Date("2026-11-18T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  await test("viral score is 0–100 and null without metrics", () => {
    assert.equal(computeViralScore({ views: null, likes: null, comments: null, uploaded_at: null }), null);
    const s = computeViralScore({ views: 1e9, likes: 1e9, comments: 0, uploaded_at: hoursAgo(1), now })!;
    assert.ok(s >= 0 && s <= 100);
  });
  await test("fresh fast-growing clip beats old clip with more total views", () => {
    const fresh = computeViralScore({ views: 80_000, likes: null, comments: null, uploaded_at: hoursAgo(4), now })!;
    const old = computeViralScore({ views: 400_000, likes: null, comments: null, uploaded_at: hoursAgo(24 * 60), now })!;
    assert.ok(fresh > old, `fresh=${fresh} old=${old}`);
  });
  await test("missing metrics don't penalise (weights re-normalise)", () => {
    const withoutEng = computeViralScore({ views: 50_000, likes: null, comments: null, uploaded_at: hoursAgo(5), now })!;
    const withZeroEng = computeViralScore({ views: 50_000, likes: 0, comments: 0, uploaded_at: hoursAgo(5), now })!;
    assert.ok(withoutEng > withZeroEng);
  });
  await test("score tiers match the brief", () => {
    assert.deepEqual([30, 31, 60, 61, 80, 81].map(scoreTier), ["low", "interesting", "interesting", "high", "high", "viral"]);
  });

  // --- review → pipeline rules --------------------------------------------
  await test("approval advances pipeline only from early stages", () => {
    assert.equal(pipelineAfterReview("approved", "awaiting_review"), "approved");
    assert.equal(pipelineAfterReview("approved", "editing"), "editing");
    assert.equal(pipelineAfterReview("rejected", "approved"), "approved");
    assert.equal(pipelineAfterReview("pending", "approved"), "awaiting_review");
  });

  // --- demo repository -------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cliphunter-test-"));
  const repo = new DemoRepository(path.join(dir, "db.json"));
  try {
    await test("seeds demo data with demo- ids", async () => {
      const page = await repo.listClips({ pageSize: 100 });
      assert.ok(page.total >= 50);
      assert.ok(page.clips.every((c) => c.external_clip_id.startsWith("demo-")));
    });

    let createdId = "";
    await test("creates a clip, then detects the duplicate", async () => {
      const input = {
        platform: "twitch" as const,
        external_clip_id: "TestSlug",
        original_url: "https://clips.twitch.tv/TestSlug",
        title: "Test clip",
        creator_name: "Tester",
        views: 1000,
        uploaded_at: new Date(Date.now() - 3_600_000).toISOString(),
        note: "first note",
      };
      const a = await repo.createClip(input);
      assert.equal(a.duplicate, false);
      assert.equal(a.clip.review_status, "pending");
      assert.equal(a.clip.pipeline_status, "awaiting_review");
      assert.equal(a.clip.note_count, 1);
      assert.ok(a.clip.viral_score != null);
      createdId = a.clip.id;
      const b = await repo.createClip({ ...input, title: "Different title" });
      assert.equal(b.duplicate, true);
      assert.equal(b.clip.id, createdId);
      assert.equal(b.clip.title, "Test clip");
    });
    await test("search finds by title and creator", async () => {
      assert.equal((await repo.listClips({ search: "test clip" })).clips[0]?.id, createdId);
      assert.ok((await repo.listClips({ search: "TESTER" })).clips.some((c) => c.id === createdId));
    });
    await test("approve moves pipeline and leaves the queue", async () => {
      await repo.setReviewStatus([createdId], "approved");
      const c = await repo.getClip(createdId);
      assert.equal(c?.review_status, "approved");
      assert.equal(c?.pipeline_status, "approved");
      const queue = await repo.listClips({ reviewStatuses: ["pending"], pageSize: 100 });
      assert.ok(!queue.clips.some((x) => x.id === createdId));
    });
    await test("bulk reject + restore", async () => {
      const ids = (await repo.listClips({ reviewStatuses: ["pending"], pageSize: 3 })).clips.map((c) => c.id);
      assert.equal(await repo.setReviewStatus(ids, "rejected"), 3);
      const rejected = await repo.listClips({ reviewStatuses: ["rejected"], pageSize: 100 });
      assert.ok(ids.every((id) => rejected.clips.some((c) => c.id === id)));
      await repo.setReviewStatus(ids, "pending");
      assert.equal((await repo.getClip(ids[0]))?.review_status, "pending");
    });
    await test("favorites toggle and filter", async () => {
      await repo.setFavorite([createdId], true);
      assert.equal((await repo.getClip(createdId))?.is_favorite, true);
      assert.ok((await repo.listClips({ favoritesOnly: true, pageSize: 100 })).clips.some((c) => c.id === createdId));
      await repo.setFavorite([createdId], false);
      assert.equal((await repo.getClip(createdId))?.is_favorite, false);
    });
    await test("notes add / list / delete", async () => {
      const n = await repo.addNote(createdId, "second note");
      assert.equal((await repo.listNotes(createdId)).length, 2);
      await repo.deleteNote(n.id);
      assert.equal((await repo.listNotes(createdId)).length, 1);
      await assert.rejects(repo.addNote("nope", "x"));
    });
    await test("filters and sorts", async () => {
      const byScore = (await repo.listClips({ sort: "score_desc", pageSize: 100 })).clips.map((c) => c.viral_score ?? -1);
      assert.deepEqual(byScore, [...byScore].sort((a, b) => b - a));
      const tw = await repo.listClips({ platforms: ["twitch"], pageSize: 100 });
      assert.ok(tw.clips.every((c) => c.platform === "twitch"));
      const big = await repo.listClips({ minViews: 100_000, pageSize: 100 });
      assert.ok(big.clips.every((c) => (c.views ?? 0) >= 100_000));
      const p2 = await repo.listClips({ page: 2, pageSize: 10 });
      assert.equal(p2.clips.length, 10);
    });
    await test("dashboard stats are consistent with the data", async () => {
      const s = await repo.getDashboardStats();
      const all = await repo.listClips({ pageSize: 100 });
      assert.equal(s.total, all.total);
      assert.equal(Object.values(s.byPlatform).reduce((a, b) => a + b, 0), s.total);
      assert.equal(s.awaitingReview, (await repo.listClips({ reviewStatuses: ["pending"] })).total);
      assert.equal(s.perDay.length, 14);
      assert.ok(s.newToday >= 1); // the clip we created
    });
    await test("creators are created from submissions", async () => {
      const creators = await repo.listCreators();
      assert.ok(creators.some((c) => c.name === "Tester" && c.clip_count === 1));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.ok) console.log("      ", r.err instanceof Error ? r.err.message : r.err);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

void main();
