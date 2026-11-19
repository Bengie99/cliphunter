/**
 * ClipHunter PC helper — runs on your PC.  Start: npm run worker   Stop: Ctrl+C
 *
 * Also runs the editor jobs (preview copies, subtitles, renders) — see worker-media.ts.
 *
 * Picks up clips you queued with the Download button, downloads them with
 * yt-dlp, reads duration/resolution with ffprobe and records the file so it
 * shows on the Downloaded Footage page.
 *
 * - Signs in as YOU (email + password from .env.local), so row level security
 *   applies: it can only see and change your own data. No service-role key.
 * - Only downloads clips that are authorized (creator permission granted) or that
 *   you explicitly marked "transformative use". The database enforces this too.
 * - Runs at below-normal CPU priority, one download at a time.
 *
 * Needs on PATH: yt-dlp and ffmpeg/ffprobe
 *   winget install yt-dlp.yt-dlp
 *   winget install Gyan.FFmpeg
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkTool, die, env, FOOTAGE_DIR, log, lowerPriority, probe, run, sha256 } from "./worker-lib";
import { initMedia, runMediaTask } from "./worker-media";

const POLL_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const AUTHORIZED = new Set(["transformative_use", "download_authorized", "republish_authorized"]);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
type Job = {
  id: string;
  platform: string;
  external_clip_id: string;
  original_url: string;
  title: string;
  creator_name: string | null;
  rights_status: string;
  pipeline_status: string;
};

async function main() {
  lowerPriority(process.pid);
  console.log("\nClipHunter download helper\n");

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const email = env("CLIPHUNTER_WORKER_EMAIL");
  const password = env("CLIPHUNTER_WORKER_PASSWORD");
  if (!url || !anon) die("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local");
  if (!email || !password) die("Set CLIPHUNTER_WORKER_EMAIL and CLIPHUNTER_WORKER_PASSWORD (your app login) in .env.local");

  log(`yt-dlp ${await checkTool("yt-dlp", "--version", "winget install yt-dlp.yt-dlp")}`);
  log(await checkTool("ffprobe", "-version", "winget install Gyan.FFmpeg"));

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr || !auth.user) die(`Sign-in failed: ${authErr?.message ?? "unknown error"}`);
  log(`Signed in as ${auth.user.email}`);
  await initMedia(sb, auth.user.id);

  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });
  log(`Saving footage to ${FOOTAGE_DIR}`);

  // A previous run that crashed mid-download leaves clips stuck in 'downloading'.
  const { data: stale } = await sb.from("clips").update({ download_status: "queued" }).eq("download_status", "downloading").select("id");
  if (stale?.length) log(`Re-queued ${stale.length} interrupted download(s)`);

  let current: string | null = null;
  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    log("Stopping…");
    if (current) await sb.from("clips").update({ download_status: "queued" }).eq("id", current).eq("download_status", "downloading");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log("Waiting for work: downloads, editor previews, subtitles, renders (Ctrl+C to stop)…");
  while (!stopping) {
    let job: Job | null = null;
    try {
      job = await claimNext(sb);
    } catch (err) {
      log(`⚠ Couldn't check the queue: ${err instanceof Error ? err.message : err}`);
    }
    if (!job) {
      let didMedia = false;
      try {
        didMedia = await runMediaTask();
      } catch (err) {
        log(`⚠ Editor job error: ${err instanceof Error ? err.message : err}`);
      }
      if (!didMedia) await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    current = job.id;
    try {
      await processJob(sb, job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`✖ Unexpected error: ${message}`);
      await sb.from("clips").update({ download_status: "failed", download_error: message.slice(0, 500) }).eq("id", job.id);
    }
    current = null;
  }
}

async function claimNext(sb: SupabaseClient): Promise<Job | null> {
  const { data, error } = await sb
    .from("clips")
    .select("id, platform, external_clip_id, original_url, title, creator_name, rights_status, pipeline_status")
    .eq("download_status", "queued")
    .order("download_requested_at", { ascending: true, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const next = data?.[0] as Job | undefined;
  if (!next) return null;
  // Claim it — only succeeds if it's still queued (e.g. not cancelled meanwhile).
  const { data: claimed, error: claimErr } = await sb
    .from("clips")
    .update({ download_status: "downloading", download_error: null })
    .eq("id", next.id)
    .eq("download_status", "queued")
    .select("id");
  if (claimErr) throw new Error(claimErr.message);
  return claimed?.length ? next : null;
}

async function processJob(sb: SupabaseClient, job: Job) {
  const label = `"${job.title.slice(0, 60)}"${job.creator_name ? ` (${job.creator_name})` : ""}`;
  const fail = async (message: string) => {
    log(`✖ ${label}: ${message}`);
    await sb.from("clips").update({ download_status: "failed", download_error: message.slice(0, 500) }).eq("id", job.id);
  };

  if (!AUTHORIZED.has(job.rights_status)) return fail("Not downloadable — no permission and not marked for transformative use.");

  log(`↓ ${label}`);
  const dir = path.join(FOOTAGE_DIR, job.platform);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${job.platform}_${job.external_clip_id.replace(/[^\w-]/g, "_")}`;

  let r;
  try {
    r = await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-progress",
        "--no-simulate",
        "--restrict-filenames",
        // best ≤1080p, preferring mp4/m4a so no re-encode is needed
        "-f",
        "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        path.join(dir, `${base}.%(ext)s`),
        "--print",
        "after_move:filepath",
        job.original_url,
      ],
      DOWNLOAD_TIMEOUT_MS,
    );
  } catch (err) {
    return fail(`yt-dlp could not start: ${err instanceof Error ? err.message : err}`);
  }
  const file = r.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (r.code !== 0 || !file || !fs.existsSync(file)) {
    const reason = r.stderr.split(/\r?\n/).reverse().find((l) => l.includes("ERROR")) ?? `yt-dlp exited with code ${r.code}`;
    return fail(reason.replace(/^ERROR:\s*/, ""));
  }

  const [checksum, meta] = await Promise.all([sha256(file), probe(file)]);
  const size = fs.statSync(file).size;

  const { error: fileErr } = await sb.from("clip_files").upsert(
    {
      clip_id: job.id,
      file_name: path.basename(file),
      file_path: file,
      file_size: size,
      duration_seconds: meta.duration,
      resolution: meta.resolution,
      checksum_sha256: checksum,
      source_url: job.original_url,
      rights_status: job.rights_status,
      download_status: "downloaded",
      downloaded_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,checksum_sha256", ignoreDuplicates: true },
  );
  if (fileErr) return fail(`Saved the file but couldn't record it: ${fileErr.message}`);

  const advance = job.pipeline_status === "approved" || job.pipeline_status === "ready_for_download";
  await sb
    .from("clips")
    .update({ download_status: "downloaded", download_error: null, ...(advance ? { pipeline_status: "downloaded" } : {}) })
    .eq("id", job.id);
  log(`✔ ${label} → ${path.relative(FOOTAGE_DIR, file)} (${(size / 1_048_576).toFixed(1)} MB${meta.resolution ? `, ${meta.resolution}` : ""})`);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
