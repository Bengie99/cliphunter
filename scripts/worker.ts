/**
 * ClipHunter download helper — runs on your PC.  Start: npm run worker   Stop: Ctrl+C
 *
 * Picks up clips you queued with the Download button, downloads them with
 * yt-dlp, reads duration/resolution with ffprobe and records the file so it
 * shows on the Downloaded Footage page.
 *
 * - Signs in as YOU (email + password from .env.local), so row level security
 *   applies: it can only see and change your own data. No service-role key.
 * - Only downloads clips whose rights status is authorized (creator permission
 *   granted). The database refuses to queue anything else as well.
 * - Runs at below-normal CPU priority, one download at a time.
 *
 * Needs on PATH: yt-dlp and ffmpeg/ffprobe
 *   winget install yt-dlp.yt-dlp
 *   winget install Gyan.FFmpeg
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const POLL_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const AUTHORIZED = new Set(["download_authorized", "republish_authorized"]);

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const env = (k: string) => process.env[k]?.trim() || "";
const FOOTAGE_DIR = path.resolve(env("CLIPHUNTER_FOOTAGE_DIR") || path.join(process.cwd(), "footage"));

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// child processes (inherit below-normal priority)
// ---------------------------------------------------------------------------
function lowerPriority(pid: number | undefined) {
  try {
    if (pid) os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* not fatal */
  }
}

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    lowerPriority(child.pid);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function checkTool(cmd: string, versionArg: string, install: string) {
  try {
    const r = await run(cmd, [versionArg], 15_000);
    if (r.code !== 0) throw new Error();
    return (r.stdout || r.stderr).split(/\r?\n/)[0].trim();
  } catch {
    die(`${cmd} was not found. Install it with:\n    ${install}\n  then open a NEW terminal (so PATH updates) and run npm run worker again.`);
  }
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

async function probe(file: string): Promise<{ duration: number | null; resolution: string | null }> {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) return { duration: null, resolution: null };
  const info = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
  const video = info.streams?.find((s) => s.codec_type === "video");
  return {
    duration: info.format?.duration ? Math.round(Number(info.format.duration) * 100) / 100 : null,
    resolution: video?.width && video?.height ? `${video.width}x${video.height}` : null,
  };
}

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

  log("Waiting for queued downloads (Ctrl+C to stop)…");
  while (!stopping) {
    let job: Job | null = null;
    try {
      job = await claimNext(sb);
    } catch (err) {
      log(`⚠ Couldn't check the queue: ${err instanceof Error ? err.message : err}`);
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, POLL_MS));
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

  if (!AUTHORIZED.has(job.rights_status)) return fail("Not authorized — creator permission is not granted.");

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
