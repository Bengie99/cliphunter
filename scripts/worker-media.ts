/**
 * Editor jobs for the PC helper (run from scripts/worker.ts between downloads):
 *
 *   1. preview copy  — 720p proxy of each downloaded clip, uploaded to Storage so
 *                      the browser editor can play it; then queues the analysis
 *   2. analysis      — audio envelope + loudness + scene changes (ffmpeg) and
 *                      subtitles with whisper.cpp on this PC (free)
 *   3. render        — Remotion renders the edit spec to a 1080x1920 mp4 using
 *                      the full-quality local file, then loudness-normalises it
 *                      and renders the cover frame
 *   4. Save MP4      — uploads a temporary copy the browser downloads
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
import { FOOTAGE_DIR, checkTool, env, log, probe, run, setActivity } from "./worker-lib";
import type { Analysis, EditSpec, Word } from "../remotion/spec";
import { FPS, outputDuration, upgradeSpec, defaultSpec } from "../remotion/spec";

const WHISPER_VERSION = "1.5.5"; // the Windows build Remotion supports with word timestamps
const WHISPER_DIR = path.join(os.homedir(), ".cliphunter", "whisper");
const WHISPER_MODEL = (env("CLIPHUNTER_WHISPER_MODEL") || "small") as "small";
const TMP_DIR = path.join(FOOTAGE_DIR, ".tmp");
const RENDER_DIR = path.join(FOOTAGE_DIR, "renders");
/** Supabase's per-file limit on the free plan. */
const STORAGE_MAX = 49 * 1024 * 1024;
const TEMP_LINK_HOURS = 2;

/**
 * workspaceId: the team's shared id (Storage paths live under it).
 * userId: this person — editor jobs only run for files downloaded on THIS PC.
 */
let ctx: { sb: SupabaseClient; workspaceId: string; userId: string } | null = null;

const MINE = (userId: string) => `downloaded_by.is.null,downloaded_by.eq.${userId}`;

export async function initMedia(sb: SupabaseClient, workspaceId: string, userId: string) {
  ctx = { sb, workspaceId, userId };
  log(await checkTool("ffmpeg", "-version", "winget install Gyan.FFmpeg"));
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  // jobs interrupted by a previous crash of THIS helper go back in the queue
  await sb.from("clip_files").update({ proxy_status: "queued" }).eq("proxy_status", "running").or(MINE(userId));
  for (const col of ["transcript_status", "render_status"] as const) {
    const { data } = await sb.from("clip_edits").select("id, clip_id").eq(col, "running");
    for (const job of data ?? []) {
      if (await isOnThisPc(job.clip_id)) await sb.from("clip_edits").update({ [col]: "queued" }).eq("id", job.id);
    }
  }
  await sb.from("file_requests").update({ status: "queued" }).eq("status", "uploading");
}

/** The clip's newest file was downloaded by this person and exists on this PC. */
async function isOnThisPc(clipId: string): Promise<boolean> {
  const { data } = await ctx!.sb
    .from("clip_files")
    .select("file_path, downloaded_by")
    .eq("clip_id", clipId)
    .order("downloaded_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data && (data.downloaded_by == null || data.downloaded_by === ctx!.userId) && fs.existsSync(data.file_path));
}

/** First queued edit job whose clip lives on this PC (teammates' files are skipped). */
async function nextJobOnThisPc<T extends { clip_id: string }>(rows: T[] | null): Promise<T | null> {
  for (const row of rows ?? []) if (await isOnThisPc(row.clip_id)) return row;
  return null;
}

/** Runs at most one editor job. Returns true if it did something. */
export async function runMediaTask(): Promise<boolean> {
  if (!ctx) return false;
  return (await fileRequestTask()) || (await proxyTask()) || (await analyzeTask()) || (await renderTask()) || (await cleanupTask());
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const lastLine = (s: string) => s.trim().split(/\r?\n/).pop() ?? "";

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
  const { sb, workspaceId, userId } = ctx!;
  const { data } = await sb
    .from("clip_files")
    .select("id, clip_id, file_path, file_name")
    .in("proxy_status", ["none", "queued"])
    .or(MINE(userId))
    .order("downloaded_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const job = data?.[0];
  if (!job) return false;
  const { data: claimed } = await sb.from("clip_files").update({ proxy_status: "running" }).eq("id", job.id).in("proxy_status", ["none", "queued"]).select("id");
  if (!claimed?.length) return true;

  const fail = async (m: string) => {
    log(`✖ Preview for ${job.file_name}: ${m}`);
    await sb.from("clip_files").update({ proxy_status: "failed", proxy_error: m.slice(0, 500) }).eq("id", job.id);
    return true;
  };
  if (!fs.existsSync(job.file_path)) return fail(`File not found on this PC: ${job.file_path}`);

  setActivity(`Preparing preview: ${job.file_name}`);
  log(`▶ Preparing editor preview for ${job.file_name}`);
  const out = path.join(TMP_DIR, `proxy-${job.clip_id}.mp4`);
  const r = await run(
    "ffmpeg",
    ["-y", "-i", job.file_path, "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out],
    10 * 60_000,
  );
  if (r.code !== 0 || !fs.existsSync(out)) return fail(lastLine(r.stderr) || "ffmpeg failed");

  const storagePath = `${workspaceId}/proxies/${job.clip_id}.mp4`;
  const { error } = await sb.storage.from("media").upload(storagePath, fs.readFileSync(out), { contentType: "video/mp4", upsert: true });
  fs.rmSync(out, { force: true });
  if (error) return fail(`Upload failed: ${error.message}`);
  await sb.from("clip_files").update({ proxy_status: "done", proxy_path: storagePath, proxy_error: null }).eq("id", job.id);
  log(`✔ Preview ready for ${job.file_name}`);

  // Start the analysis right away, so subtitles / silences are ready when the editor opens.
  await sb
    .from("clip_edits")
    .upsert({ clip_id: job.clip_id, transcript_status: "queued" }, { onConflict: "owner_id,clip_id", ignoreDuplicates: true });
  return true;
}

// ---------------------------------------------------------------------------
// 2. analysis: audio envelope, loudness, scene changes, subtitles
// ---------------------------------------------------------------------------

let whisperReady = false;

/**
 * On Windows we install whisper.cpp ourselves: Remotion's installer can report
 * success without extracting anything, which only surfaces later as
 * "spawn …\main.exe ENOENT". Same official 1.5.5 build it would use.
 */
async function installWhisperWindows() {
  const exe = path.join(WHISPER_DIR, "main.exe");
  if (fs.existsSync(exe)) return;
  log("Installing whisper.cpp (speech-to-text, ~2 MB)…");
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

const ENV_STEP = 0.05;

/** Loudness envelope (dBFS per 50 ms) from a 16 kHz mono 16-bit WAV. */
export function envelopeFromWav(file: string): number[] {
  const buf = fs.readFileSync(file);
  let off = 12;
  let dataStart = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === "data") {
      dataStart = off + 8;
      dataLen = Math.min(len, buf.length - dataStart);
      break;
    }
    off += 8 + len + (len % 2);
  }
  if (dataStart < 0) throw new Error("Couldn't read the extracted audio");
  const samples = Math.floor(dataLen / 2);
  const win = Math.round(16000 * ENV_STEP);
  const out: number[] = [];
  for (let i = 0; i + win <= samples; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) {
      const v = buf.readInt16LE(dataStart + (i + j) * 2) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / win);
    out.push(Math.round(Math.max(-90, 20 * Math.log10(rms + 1e-9)) * 10) / 10);
  }
  return out;
}

async function measureLufs(file: string): Promise<number | null> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], 5 * 60_000);
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(r.stderr);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > -70 ? v : null;
}

async function detectScenes(file: string): Promise<number[]> {
  const r = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-f", "null", "-"],
    10 * 60_000,
  );
  const times = [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
  // ignore flicker: keep changes at least 0.5 s apart
  return times.filter((t, i) => i === 0 || t - times[i - 1] >= 0.5);
}

async function analyzeTask(): Promise<boolean> {
  const { sb } = ctx!;
  const { data } = await sb.from("clip_edits").select("id, clip_id").eq("transcript_status", "queued").order("updated_at").limit(20);
  const job = await nextJobOnThisPc(data);
  if (!job) return false;
  const { data: claimed } = await sb.from("clip_edits").update({ transcript_status: "running" }).eq("id", job.id).eq("transcript_status", "queued").select("id");
  if (!claimed?.length) return true;

  const wav = path.join(TMP_DIR, `audio-${job.clip_id}.wav`);
  try {
    const file = await localFileFor(job.clip_id);
    setActivity(`Analyzing ${path.basename(file)}`);
    log(`▶ Analyzing ${path.basename(file)} (audio, scenes, subtitles)`);
    const r = await run("ffmpeg", ["-y", "-i", file, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], 5 * 60_000);
    if (r.code !== 0) throw new Error(lastLine(r.stderr) || "Extracting audio failed");

    // audio + scenes first: cheap, and useful even if speech recognition fails
    const [lufs, scenes] = await Promise.all([measureLufs(wav), detectScenes(file)]);
    const analysis: Analysis = { step: ENV_STEP, env: envelopeFromWav(wav), lufs, scenes };
    await sb.from("clip_edits").update({ analysis }).eq("id", job.id);
    log(`  audio ${lufs == null ? "silent" : `${lufs.toFixed(1)} LUFS`}, ${scenes.length} scene change(s)`);

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
    log(`✔ Analyzed: ${words.length} words`);
  } catch (e) {
    log(`✖ Analysis failed: ${errMsg(e)}`);
    await sb.from("clip_edits").update({ transcript_status: "failed", transcript_error: errMsg(e) }).eq("id", job.id);
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3. render (Remotion) + audio finishing + cover
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

/** Copy of the source with background noise reduced (video stream untouched). */
async function denoisedCopy(file: string, clipId: string): Promise<string> {
  const out = path.join(TMP_DIR, `clean-${clipId}.mp4`);
  const r = await run(
    "ffmpeg",
    ["-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-af", "highpass=f=70,afftdn=nf=-25:tn=1", "-c:a", "aac", "-b:a", "192k", out],
    10 * 60_000,
  );
  if (r.code !== 0 || !fs.existsSync(out)) {
    log(`  noise reduction skipped: ${lastLine(r.stderr)}`);
    return file;
  }
  return out;
}

/** Two-pass loudness normalisation to YouTube's -14 LUFS (video copied as-is). */
export async function normalizeLoudness(file: string): Promise<boolean> {
  const target = "I=-14:TP=-1.5:LRA=11";
  const p1 = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], 5 * 60_000);
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(p1.stderr)?.[0];
  if (!json) return false;
  const m = JSON.parse(json) as Record<string, string>;
  if (!Number.isFinite(Number(m.input_i)) || Number(m.input_i) < -70) return false; // silent
  const tmp = `${file}.norm.mp4`;
  const filter = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const p2 = await run(
    "ffmpeg",
    ["-y", "-i", file, "-c:v", "copy", "-af", filter, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp],
    10 * 60_000,
  );
  if (p2.code !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    return false;
  }
  fs.renameSync(tmp, file);
  return true;
}

async function renderTask(): Promise<boolean> {
  const { sb, workspaceId } = ctx!;
  const { data } = await sb.from("clip_edits").select("id, clip_id, spec").eq("render_status", "queued").order("updated_at").limit(20);
  const job = await nextJobOnThisPc(data);
  if (!job) return false;
  const { data: claimed } = await sb
    .from("clip_edits")
    .update({ render_status: "running", render_progress: 0 })
    .eq("id", job.id)
    .eq("render_status", "queued")
    .select("id");
  if (!claimed?.length) return true;

  const cleanups: string[] = [];
  try {
    const raw = job.spec as EditSpec;
    const spec = upgradeSpec(raw, defaultSpec({ duration: raw.sourceDuration, width: raw.sourceWidth, height: raw.sourceHeight }));
    const file = await localFileFor(job.clip_id);
    const { data: clip } = await sb.from("clips").select("title").eq("id", job.clip_id).single();
    setActivity(`Rendering "${short(clip?.title ?? job.clip_id, 40)}"`);
    log(`▶ Rendering "${short(clip?.title ?? job.clip_id)}"`);

    const { ensureBrowser, renderMedia, renderStill, selectComposition } = await import("@remotion/renderer");
    if (!bundleUrl) {
      log("  preparing renderer (first render only)…");
      await ensureBrowser();
      // The packaged ClipHunter Helper ships a pre-built bundle (and no bundler); from the code we build it.
      const prebuilt = env("CLIPHUNTER_REMOTION_BUNDLE");
      if (prebuilt) bundleUrl = prebuilt;
      else {
        const { bundle } = await import("@remotion/bundler");
        bundleUrl = await bundle({ entryPoint: path.join(process.cwd(), "remotion", "index.ts") });
      }
    }

    let source = file;
    if (spec.audio.denoise) {
      log("  reducing background noise…");
      source = await denoisedCopy(file, job.clip_id);
      if (source !== file) cleanups.push(source);
    }
    const token = randomUUID();
    served.set(token, source);
    const videoSrc = `${await ensureServer()}/f/${token}`;

    // signed URLs for the music / sound effects / overlays this edit uses
    const ids = [
      ...new Set([spec.audio.music.assetId, ...spec.audio.sfx.map((s) => s.assetId), ...spec.overlays.map((o) => o.assetId)].filter((x): x is string => Boolean(x))),
    ];
    const assetUrls: Record<string, string> = {};
    if (ids.length) {
      const { data: assets } = await sb.from("audio_assets").select("id, storage_path").in("id", ids);
      const { data: signed } = await sb.storage.from("media").createSignedUrls((assets ?? []).map((a) => a.storage_path), 3600);
      (assets ?? []).forEach((a, i) => signed?.[i]?.signedUrl && (assetUrls[a.id] = signed[i].signedUrl));
    }

    const inputProps = { spec, videoSrc, assetUrls };
    const composition = await selectComposition({ serveUrl: bundleUrl, id: "Short", inputProps });
    const safeTitle = (clip?.title ?? "short").replace(/[^\w-]+/g, "_").slice(0, 50);
    const out = path.join(RENDER_DIR, `${safeTitle}_${job.clip_id.slice(0, 8)}.mp4`);

    let lastSaved = 0;
    await renderMedia({
      composition,
      serveUrl: bundleUrl,
      codec: "h264",
      audioBitrate: "192k",
      outputLocation: out,
      inputProps,
      concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
      onProgress: ({ progress }) => {
        // the last 10% is kept for loudness + cover
        const p = progress * 0.9;
        if (p - lastSaved >= 0.05) {
          lastSaved = p;
          void sb.from("clip_edits").update({ render_progress: p }).eq("id", job.id);
        }
      },
    });

    if (spec.audio.normalize) {
      log("  normalising loudness to -14 LUFS…");
      if (!(await normalizeLoudness(out))) log("  loudness: nothing to normalise (silent audio?)");
    }

    let coverPath: string | null = null;
    if (spec.cover.t != null) {
      const frame = Math.min(Math.max(0, Math.round(spec.cover.t * FPS)), Math.round(outputDuration(spec) * FPS) - 1);
      const jpg = out.replace(/\.mp4$/, ".jpg");
      await renderStill({ composition, serveUrl: bundleUrl, inputProps, frame, output: jpg, imageFormat: "jpeg", jpegQuality: 90 });
      const storagePath = `${workspaceId}/covers/${job.clip_id}.jpg`;
      const { error } = await sb.storage.from("media").upload(storagePath, fs.readFileSync(jpg), { contentType: "image/jpeg", upsert: true });
      if (!error) coverPath = storagePath;
    }
    served.delete(token);

    const size = fs.statSync(out).size;
    await sb
      .from("clip_edits")
      .update({
        render_status: "done",
        render_progress: 1,
        render_error: null,
        output_path: out,
        output_size: size,
        rendered_at: new Date().toISOString(),
        cover_path: coverPath,
      })
      .eq("id", job.id);
    await sb.from("clips").update({ pipeline_status: "edited" }).eq("id", job.clip_id).in("pipeline_status", ["downloaded", "ready_for_editing", "editing"]);
    log(`✔ Rendered → ${path.relative(FOOTAGE_DIR, out)} (${(size / 1_048_576).toFixed(1)} MB)`);
  } catch (e) {
    log(`✖ Render failed: ${errMsg(e)}`);
    await sb.from("clip_edits").update({ render_status: "failed", render_error: errMsg(e) }).eq("id", job.id);
  } finally {
    for (const f of cleanups) fs.rmSync(f, { force: true });
  }
  return true;
}

// ---------------------------------------------------------------------------
// 4. Save MP4: temporary upload the browser downloads
// ---------------------------------------------------------------------------

/** Re-encodes to fit Supabase's 50 MB file limit (only when needed). */
async function fitForUpload(file: string, id: string): Promise<string> {
  if (fs.statSync(file).size <= STORAGE_MAX) return file;
  const { duration } = await probe(file);
  if (!duration) throw new Error("Couldn't read the video length to compress it");
  const kbps = Math.floor((STORAGE_MAX * 8 * 0.92) / duration / 1000) - 160;
  if (kbps < 400) throw new Error("Too long to fit the 50 MB web download limit — use the file on the PC instead");
  log(`  compressing to fit the 50 MB web limit (${kbps} kbps)…`);
  const out = path.join(TMP_DIR, `web-${id}.mp4`);
  const r = await run(
    "ffmpeg",
    ["-y", "-i", file, "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.3)}k`, "-bufsize", `${kbps * 2}k`, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out],
    20 * 60_000,
  );
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(lastLine(r.stderr) || "Compressing failed");
  return out;
}

async function fileRequestTask(): Promise<boolean> {
  const { sb, workspaceId } = ctx!;
  const { data } = await sb.from("file_requests").select("id, clip_id, kind").eq("status", "queued").order("created_at").limit(20);
  for (const req of data ?? []) {
    let file: string | null = null;
    if (req.kind === "source") {
      if (await isOnThisPc(req.clip_id)) file = await localFileFor(req.clip_id);
    } else {
      const { data: edit } = await sb.from("clip_edits").select("output_path").eq("clip_id", req.clip_id).maybeSingle();
      if (edit?.output_path && fs.existsSync(edit.output_path)) file = edit.output_path;
    }
    if (!file) continue; // a teammate's PC has it

    const { data: claimed } = await sb.from("file_requests").update({ status: "uploading" }).eq("id", req.id).eq("status", "queued").select("id");
    if (!claimed?.length) return true;
    let upload: string | null = null;
    try {
      setActivity(`Preparing download: ${path.basename(file)}`);
      log(`▶ Preparing browser download of ${path.basename(file)}`);
      upload = await fitForUpload(file, req.id);
      const name = path.basename(file);
      const storagePath = `${workspaceId}/tmp/${req.id}.mp4`;
      const { error } = await sb.storage.from("media").upload(storagePath, fs.readFileSync(upload), { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      await sb.from("file_requests").update({ status: "ready", storage_path: storagePath, file_name: name, error: null }).eq("id", req.id);
      log(`✔ Ready to download in the browser: ${name}`);
    } catch (e) {
      log(`✖ Browser download failed: ${errMsg(e)}`);
      await sb.from("file_requests").update({ status: "failed", error: errMsg(e) }).eq("id", req.id);
    } finally {
      if (upload && upload !== file) fs.rmSync(upload, { force: true });
    }
    return true;
  }
  return false;
}

let lastCleanup = 0;

/** Removes temporary browser downloads after a couple of hours (keeps Storage small). */
async function cleanupTask(): Promise<boolean> {
  if (Date.now() - lastCleanup < 10 * 60_000) return false;
  lastCleanup = Date.now();
  const { sb } = ctx!;
  const cutoff = new Date(Date.now() - TEMP_LINK_HOURS * 3600_000).toISOString();
  const { data } = await sb.from("file_requests").select("id, storage_path").lt("created_at", cutoff).limit(100);
  if (!data?.length) return false;
  const paths = data.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) await sb.storage.from("media").remove(paths);
  await sb.from("file_requests").delete().in("id", data.map((r) => r.id));
  return false;
}
