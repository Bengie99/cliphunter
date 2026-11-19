/**
 * Editor jobs for the PC helper (run from scripts/worker.ts between downloads):
 *
 *   1. preview copy  â€” 720p proxy of each downloaded clip, uploaded to Storage so
 *                      the browser editor can play it
 *   2. subtitles     â€” whisper.cpp on this PC (free), word-level timestamps
 *   3. render        â€” Remotion renders the edit spec to a 1080x1920 mp4 using
 *                      the full-quality local file
 *
 * One job per call, in that order of priority. Everything runs as the signed-in
 * user, so row level security applies to every read and write.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FOOTAGE_DIR, checkTool, env, log, run } from "./worker-lib";
import type { EditSpec, Word } from "../remotion/spec";

const WHISPER_VERSION = "1.5.5"; // the Windows build Remotion supports with word timestamps
const WHISPER_DIR = path.join(os.homedir(), ".cliphunter", "whisper");
const WHISPER_MODEL = (env("CLIPHUNTER_WHISPER_MODEL") || "small") as "small";
const TMP_DIR = path.join(FOOTAGE_DIR, ".tmp");
const RENDER_DIR = path.join(FOOTAGE_DIR, "renders");

let ctx: { sb: SupabaseClient; userId: string } | null = null;

export async function initMedia(sb: SupabaseClient, userId: string) {
  ctx = { sb, userId };
  log(await checkTool("ffmpeg", "-version", "winget install Gyan.FFmpeg"));
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  // jobs interrupted by a previous crash go back in the queue
  await sb.from("clip_files").update({ proxy_status: "queued" }).eq("proxy_status", "running");
  await sb.from("clip_edits").update({ transcript_status: "queued" }).eq("transcript_status", "running");
  await sb.from("clip_edits").update({ render_status: "queued" }).eq("render_status", "running");
}

/** Runs at most one editor job. Returns true if it did something. */
export async function runMediaTask(): Promise<boolean> {
  if (!ctx) return false;
  return (await proxyTask()) || (await transcribeTask()) || (await renderTask());
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}â€¦` : s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function localFileFor(clipId: string): Promise<string> {
  const { data, error } = await ctx!.sb
    .from("clip_files")
    .select("file_path")
    .eq("clip_id", clipId)
    .order("downloaded_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This clip hasn't been downloaded.");
  if (!fs.existsSync(data.file_path)) throw new Error(`The downloaded file is missing on this PC: ${data.file_path}`);
  return data.file_path;
}

// ---------------------------------------------------------------------------
// 1. preview copy
// ---------------------------------------------------------------------------

async function proxyTask(): Promise<boolean> {
  const { sb, userId } = ctx!;
  const { data } = await sb
    .from("clip_files")
    .select("id, clip_id, file_path, file_name")
    .in("proxy_status", ["none", "queued"])
    .order("downloaded_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const job = data?.[0];
  if (!job) return false;
  const { data: claimed } = await sb.from("clip_files").update({ proxy_status: "running" }).eq("id", job.id).in("proxy_status", ["none", "queued"]).select("id");
  if (!claimed?.length) return true;

  const fail = async (m: string) => {
    log(`âś– Preview for ${job.file_name}: ${m}`);
    await sb.from("clip_files").update({ proxy_status: "failed", proxy_error: m.slice(0, 500) }).eq("id", job.id);
    return true;
  };
  if (!fs.existsSync(job.file_path)) return fail(`File not found on this PC: ${job.file_path}`);

  log(`â–¶ Preparing editor preview for ${job.file_name}`);
  const out = path.join(TMP_DIR, `proxy-${job.clip_id}.mp4`);
  const r = await run(
    "ffmpeg",
    ["-y", "-i", job.file_path, "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out],
    10 * 60_000,
  );
  if (r.code !== 0 || !fs.existsSync(out)) return fail(r.stderr.trim().split(/\r?\n/).pop() ?? "ffmpeg failed");

  const storagePath = `${userId}/proxies/${job.clip_id}.mp4`;
  const { error } = await sb.storage.from("media").upload(storagePath, fs.readFileSync(out), { contentType: "video/mp4", upsert: true });
  fs.rmSync(out, { force: true });
  if (error) return fail(`Upload failed: ${error.message}`);
  await sb.from("clip_files").update({ proxy_status: "done", proxy_path: storagePath, proxy_error: null }).eq("id", job.id);
  log(`âś” Preview ready for ${job.file_name}`);
  return true;
}

// ---------------------------------------------------------------------------
// 2. subtitles (whisper.cpp, local)
// ---------------------------------------------------------------------------

let whisperReady = false;

/**
 * On Windows we install whisper.cpp ourselves: Remotion's installer can report
 * success without extracting anything, which only surfaces later as
 * "spawn â€¦\main.exe ENOENT". Same official 1.5.5 build it would use.
 */
async function installWhisperWindows() {
  const exe = path.join(WHISPER_DIR, "main.exe");
  if (fs.existsSync(exe)) return;
  log("Installing whisper.cpp (speech-to-text, ~2 MB)â€¦");
  const res = await fetch("https://remotion-ffmpeg-binaries.s3.eu-central-1.amazonaws.com/whisper-bin-x64-1-5-5.zip");
  if (!res.ok) throw new Error(`Downloading whisper.cpp failed (HTTP ${res.status})`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const zip = path.join(TMP_DIR, "whisper-bin-x64.zip");
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const r = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -Force -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${WHISPER_DIR.replace(/'/g, "''")}' -ErrorAction Stop`,
  ]);
  fs.rmSync(zip, { force: true });
  if (r.code !== 0 || !fs.existsSync(exe)) throw new Error(`Couldn't unpack whisper.cpp: ${r.stderr.trim().split(/\r?\n/)[0] ?? "main.exe missing"}`);
}

export async function ensureWhisper() {
  if (whisperReady) return;
  const { installWhisperCpp, downloadWhisperModel } = await import("@remotion/install-whisper-cpp");
  fs.mkdirSync(WHISPER_DIR, { recursive: true });
  if (process.platform === "win32") await installWhisperWindows();
  else await installWhisperCpp({ version: WHISPER_VERSION, to: WHISPER_DIR, printOutput: false });
  let lastPct = -10;
  const model = await downloadWhisperModel({
    model: WHISPER_MODEL,
    folder: WHISPER_DIR,
    printOutput: false,
    onProgress: (downloaded, total) => {
      const pct = Math.floor((downloaded / total) * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        log(`  downloading speech model "${WHISPER_MODEL}": ${pct}%`);
      }
    },
  });
  if (!model.alreadyExisted) log(`Downloaded speech model "${WHISPER_MODEL}"`);
  whisperReady = true;
}

async function transcribeTask(): Promise<boolean> {
  const { sb } = ctx!;
  const { data } = await sb.from("clip_edits").select("id, clip_id").eq("transcript_status", "queued").order("updated_at").limit(1);
  const job = data?.[0];
  if (!job) return false;
  const { data: claimed } = await sb.from("clip_edits").update({ transcript_status: "running" }).eq("id", job.id).eq("transcript_status", "queued").select("id");
  if (!claimed?.length) return true;

  const wav = path.join(TMP_DIR, `audio-${job.clip_id}.wav`);
  try {
    const file = await localFileFor(job.clip_id);
    log(`â–¶ Transcribing ${path.basename(file)}`);
    const r = await run("ffmpeg", ["-y", "-i", file, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], 5 * 60_000);
    if (r.code !== 0) throw new Error(r.stderr.trim().split(/\r?\n/).pop() ?? "Extracting audio failed");

    await ensureWhisper();
    const { transcribe, toCaptions } = await import("@remotion/install-whisper-cpp");
    const output = await transcribe({
      inputPath: wav,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      model: WHISPER_MODEL,
      modelFolder: WHISPER_DIR,
      tokenLevelTimestamps: true,
      language: "auto",
      splitOnWord: true, // whole words with punctuation attached, not sub-word tokens
      printOutput: false,
    });
    const words: Word[] = toCaptions({ whisperCppOutput: output })
      .captions.map((c) => ({ text: c.text.trim(), startMs: Math.round(c.startMs), endMs: Math.round(c.endMs) }))
      .filter((w) => w.text && !/^\[.*\]$/.test(w.text)); // drop "[MUSIC]"-style markers

    await sb.from("clip_edits").update({ transcript: words, transcript_status: "done", transcript_error: null }).eq("id", job.id);
    log(`âś” Transcribed ${words.length} words`);
  } catch (e) {
    log(`âś– Transcription failed: ${errMsg(e)}`);
    await sb.from("clip_edits").update({ transcript_status: "failed", transcript_error: errMsg(e) }).eq("id", job.id);
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3. render (Remotion)
// ---------------------------------------------------------------------------

let bundleUrl: string | null = null;

/** Tiny local server so the renderer's browser can read local files (by token only). */
const served = new Map<string, string>();
let serverBase: string | null = null;

async function ensureServer(): Promise<string> {
  if (serverBase) return serverBase;
  const server = http.createServer((req, res) => {
    const file = served.get(decodeURIComponent((req.url ?? "").replace(/^\/f\//, "").split("?")[0]));
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  serverBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return serverBase;
}

async function renderTask(): Promise<boolean> {
  const { sb } = ctx!;
  const { data } = await sb.from("clip_edits").select("id, clip_id, spec").eq("render_status", "queued").order("updated_at").limit(1);
  const job = data?.[0];
  if (!job) return false;
  const { data: claimed } = await sb
    .from("clip_edits")
    .update({ render_status: "running", render_progress: 0 })
    .eq("id", job.id)
    .eq("render_status", "queued")
    .select("id");
  if (!claimed?.length) return true;

  try {
    const spec = job.spec as EditSpec;
    const file = await localFileFor(job.clip_id);
    const { data: clip } = await sb.from("clips").select("title").eq("id", job.clip_id).single();
    log(`â–¶ Rendering "${short(clip?.title ?? job.clip_id)}"`);

    const { bundle } = await import("@remotion/bundler");
    const { ensureBrowser, renderMedia, selectComposition } = await import("@remotion/renderer");
    if (!bundleUrl) {
      log("  preparing renderer (first render only)â€¦");
      await ensureBrowser();
      bundleUrl = await bundle({ entryPoint: path.join(process.cwd(), "remotion", "index.ts") });
    }

    const token = randomUUID();
    served.set(token, file);
    const videoSrc = `${await ensureServer()}/f/${token}`;

    // signed URLs for the music / sound effects this edit uses
    const ids = [...new Set([spec.audio.music.assetId, ...spec.audio.sfx.map((s) => s.assetId)].filter((x): x is string => Boolean(x)))];
    const audioUrls: Record<string, string> = {};
    if (ids.length) {
      const { data: assets } = await sb.from("audio_assets").select("id, storage_path").in("id", ids);
      const { data: signed } = await sb.storage.from("media").createSignedUrls((assets ?? []).map((a) => a.storage_path), 3600);
      (assets ?? []).forEach((a, i) => signed?.[i]?.signedUrl && (audioUrls[a.id] = signed[i].signedUrl));
    }

    const inputProps = { spec, videoSrc, audioUrls };
    const composition = await selectComposition({ serveUrl: bundleUrl, id: "Short", inputProps });
    const safeTitle = (clip?.title ?? "short").replace(/[^\w-]+/g, "_").slice(0, 50);
    const out = path.join(RENDER_DIR, `${safeTitle}_${job.clip_id.slice(0, 8)}.mp4`);

    let lastSaved = 0;
    await renderMedia({
      composition,
      serveUrl: bundleUrl,
      codec: "h264",
      outputLocation: out,
      inputProps,
      concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
      onProgress: ({ progress }) => {
        if (progress - lastSaved >= 0.05) {
          lastSaved = progress;
          void sb.from("clip_edits").update({ render_progress: progress }).eq("id", job.id);
        }
      },
    });
    served.delete(token);

    const size = fs.statSync(out).size;
    await sb
      .from("clip_edits")
      .update({ render_status: "done", render_progress: 1, render_error: null, output_path: out, output_size: size, rendered_at: new Date().toISOString() })
      .eq("id", job.id);
    await sb.from("clips").update({ pipeline_status: "edited" }).eq("id", job.clip_id).in("pipeline_status", ["downloaded", "ready_for_editing", "editing"]);
    log(`âś” Rendered â†’ ${path.relative(FOOTAGE_DIR, out)} (${(size / 1_048_576).toFixed(1)} MB)`);
  } catch (e) {
    log(`âś– Render failed: ${errMsg(e)}`);
    await sb.from("clip_edits").update({ render_status: "failed", render_error: errMsg(e) }).eq("id", job.id);
  }
  return true;
}
