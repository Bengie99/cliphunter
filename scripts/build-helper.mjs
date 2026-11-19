/**
 * Builds "ClipHunter Helper" — a self-contained Windows folder + zip that a
 * teammate can run without the code, Node, VS Code or a terminal.
 *
 *   npm run build:helper      ->  dist/ClipHunter Helper.zip
 *
 * Contents:
 *   Start ClipHunter Helper.cmd   double-click to run (asks for the app login once)
 *   Sign out.cmd                  forget the saved login on this PC
 *   README.txt
 *   node/node.exe                 portable Node.js LTS
 *   bin/yt-dlp.exe                downloader (ffmpeg/ffprobe come with Remotion's renderer)
 *   app/helper.cjs                the helper (scripts/worker.ts bundled with esbuild)
 *   app/remotion-bundle/          pre-built Shorts composition for rendering
 *   app/node_modules/             only the renderer + speech-to-text packages
 *   app/config.json               public Supabase URL + anon key (RLS protects the data)
 *
 * Run on Windows from a terminal opened after installing yt-dlp (winget).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { bundle } from "@remotion/bundler";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "ClipHunter Helper");
const APP = path.join(OUT, "app");
const CACHE = path.join(DIST, ".cache");
const step = (m) => console.log(`\n▶ ${m}`);

// --- settings from .env.local (public values only) -------------------------
const envFile = fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : "";
const readEnv = (k) => process.env[k] || envFile.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+?)\\s*$`, "m"))?.[1]?.replace(/^(['"])(.*)\1$/, "$2");
const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be in .env.local");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const versionOf = (name) => {
  const v = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!v) throw new Error(`${name} is not in package.json`);
  return v.replace(/^[\^~]/, "");
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
fs.mkdirSync(path.join(OUT, "bin"), { recursive: true });
fs.mkdirSync(path.join(OUT, "node"), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

// --- 1. helper code ----------------------------------------------------------
step("Bundling the helper (esbuild)");
await build({
  entryPoints: [path.join(ROOT, "scripts", "worker.ts")],
  outfile: path.join(APP, "helper.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // native binaries / dynamic requires — shipped in app/node_modules instead
  external: ["@remotion/renderer", "@remotion/install-whisper-cpp", "@remotion/bundler"],
  logLevel: "warning",
});

// --- 2. pre-built composition ------------------------------------------------
step("Pre-building the Shorts composition (Remotion)");
await bundle({ entryPoint: path.join(ROOT, "remotion", "index.ts"), outDir: path.join(APP, "remotion-bundle") });

// --- 3. runtime packages -----------------------------------------------------
step("Installing renderer + speech-to-text packages");
const runtimeDeps = ["@remotion/renderer", "@remotion/install-whisper-cpp", "remotion", "react", "react-dom"];
fs.writeFileSync(
  path.join(APP, "package.json"),
  JSON.stringify(
    { name: "cliphunter-helper", private: true, version: pkg.version, dependencies: Object.fromEntries(runtimeDeps.map((d) => [d, versionOf(d)])) },
    null,
    2,
  ),
);
const npm = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: APP, stdio: "inherit", shell: true });
if (npm.status !== 0) throw new Error("npm install failed");
const compositorDir = path.join(APP, "node_modules", "@remotion", "compositor-win32-x64-msvc");
if (!fs.existsSync(path.join(compositorDir, "ffmpeg.exe"))) throw new Error("Remotion's Windows ffmpeg wasn't installed — build on Windows x64.");

fs.writeFileSync(
  path.join(APP, "config.json"),
  JSON.stringify({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON }, null, 2),
);

// --- 4. portable Node.js (latest LTS, cached) --------------------------------
step("Getting portable Node.js (LTS)");
const releases = await (await fetch("https://nodejs.org/dist/index.json")).json();
const lts = releases.find((r) => r.lts && r.files.includes("win-x64-zip") && Number(r.version.slice(1).split(".")[0]) >= 22);
if (!lts) throw new Error("Couldn't find a Node.js LTS release");
const nodeZip = path.join(CACHE, `node-${lts.version}-win-x64.zip`);
if (!fs.existsSync(nodeZip)) {
  console.log(`  downloading Node.js ${lts.version}…`);
  const res = await fetch(`https://nodejs.org/dist/${lts.version}/node-${lts.version}-win-x64.zip`);
  if (!res.ok) throw new Error(`Node.js download failed (HTTP ${res.status})`);
  fs.writeFileSync(nodeZip, Buffer.from(await res.arrayBuffer()));
}
const nodeExtract = path.join(CACHE, `node-${lts.version}`);
if (!fs.existsSync(nodeExtract)) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${nodeZip}' -DestinationPath '${nodeExtract}'`], { stdio: "inherit" });
}
fs.copyFileSync(path.join(nodeExtract, `node-${lts.version}-win-x64`, "node.exe"), path.join(OUT, "node", "node.exe"));
console.log(`  Node.js ${lts.version}`);

// --- 5. yt-dlp ---------------------------------------------------------------
step("Copying yt-dlp");
const where = spawnSync("where.exe", ["yt-dlp"], { encoding: "utf8" });
const ytdlp = where.stdout?.split(/\r?\n/).find((l) => l.toLowerCase().endsWith(".exe"));
if (!ytdlp) throw new Error("yt-dlp.exe not found on PATH — winget install yt-dlp.yt-dlp, then open a new terminal");
fs.copyFileSync(ytdlp.trim(), path.join(OUT, "bin", "yt-dlp.exe"));

// --- 6. launcher + readme ----------------------------------------------------
step("Writing launcher");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
fs.writeFileSync(
  path.join(OUT, "Start ClipHunter Helper.cmd"),
  crlf(`@echo off
chcp 65001 >nul
title ClipHunter Helper
cd /d "%~dp0app"
set "PATH=%~dp0bin;%~dp0app\\node_modules\\@remotion\\compositor-win32-x64-msvc;%PATH%"
set "CLIPHUNTER_CONFIG=%~dp0app\\config.json"
set "CLIPHUNTER_REMOTION_BUNDLE=%~dp0app\\remotion-bundle"
if not defined CLIPHUNTER_FOOTAGE_DIR set "CLIPHUNTER_FOOTAGE_DIR=%USERPROFILE%\\Videos\\ClipHunter"
"%~dp0node\\node.exe" --no-deprecation "%~dp0app\\helper.cjs" %*
echo.
echo ClipHunter Helper stopped. Press any key to close this window.
pause >nul
`),
);
fs.writeFileSync(path.join(OUT, "Sign out.cmd"), crlf(`@echo off\r\ndel "%APPDATA%\\ClipHunter\\session.json" 2>nul\r\necho Signed out of ClipHunter Helper on this PC.\r\npause\r\n`));
fs.writeFileSync(
  path.join(OUT, "README.txt"),
  crlf(`ClipHunter Helper
=================

The helper does the heavy work for the ClipHunter website on YOUR PC:
downloads, editor previews, subtitles and rendering Shorts.

START
  Double-click "Start ClipHunter Helper".
  The first time, sign in with your ClipHunter email and password
  (the same as the website). You stay signed in after that.
  Keep the window open while you work; close it to stop.

WHERE ARE MY FILES?
  Videos > ClipHunter          (C:\\Users\\<you>\\Videos\\ClipHunter)
    twitch\\ and youtube\\     downloaded clips
    renders\\                  finished Shorts from the editor

TEAM
  Your helper only handles downloads YOU clicked, and edits of clips on
  YOUR PC. Your teammate's helper does the same for theirs.

FIRST-TIME DOWNLOADS (automatic, once)
  Speech model for subtitles (~470 MB) and a rendering browser (~130 MB).

SIGN OUT
  Double-click "Sign out".

WINDOWS SMARTSCREEN
  If Windows warns about an unknown app, click "More info" > "Run anyway".
`),
);

// --- 7. zip ------------------------------------------------------------------
step("Zipping");
const zip = path.join(DIST, "ClipHunter Helper.zip");
fs.rmSync(zip, { force: true });
execFileSync("tar.exe", ["-a", "-c", "-f", zip, "-C", DIST, "ClipHunter Helper"], { stdio: "inherit" });
console.log(`\n✔ Done: ${zip} (${(fs.statSync(zip).size / 1_048_576).toFixed(0)} MB)\n`);
// Remotion's bundler can leave background work running that keeps Node alive (and busy) — exit explicitly.
process.exit(0);
