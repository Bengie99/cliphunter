/** Shared helpers for the ClipHunter PC helper (scripts/worker.ts and scripts/worker-media.ts). */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
export function loadEnvFile(file: string) {
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

export const env = (k: string) => process.env[k]?.trim() || "";
export const FOOTAGE_DIR = path.resolve(env("CLIPHUNTER_FOOTAGE_DIR") || path.join(process.cwd(), "footage"));

export const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
export function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// child processes (inherit below-normal priority)
// ---------------------------------------------------------------------------
export function lowerPriority(pid: number | undefined) {
  try {
    if (pid) os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* not fatal */
  }
}

export function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
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

export async function checkTool(cmd: string, versionArg: string, install: string) {
  try {
    const r = await run(cmd, [versionArg], 15_000);
    if (r.code !== 0) throw new Error();
    return (r.stdout || r.stderr).split(/\r?\n/)[0].trim();
  } catch {
    die(`${cmd} was not found. Install it with:\n    ${install}\n  then open a NEW terminal (so PATH updates) and run npm run worker again.`);
  }
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

export async function probe(file: string): Promise<{ duration: number | null; resolution: string | null }> {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) return { duration: null, resolution: null };
  const info = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
  const video = info.streams?.find((s) => s.codec_type === "video");
  return {
    duration: info.format?.duration ? Math.round(Number(info.format.duration) * 100) / 100 : null,
    resolution: video?.width && video?.height ? `${video.width}x${video.height}` : null,
  };
}

