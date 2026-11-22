/**
 * Sign-in for the PC helper.
 *
 * - Developer mode: CLIPHUNTER_WORKER_EMAIL / CLIPHUNTER_WORKER_PASSWORD in .env.local.
 * - ClipHunter Helper (packaged): asks for email + password once in the window,
 *   then keeps only the refresh token in %APPDATA%\ClipHunter\session.json
 *   (never the password). Start with --logout to forget it.
 * - Background mode (--background, started hidden by the tray app): never
 *   prompts; exits with code 2 when a sign-in is needed, so the tray can open
 *   a visible sign-in window (--signin: sign in, save, exit).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { die, env, log } from "./worker-lib";

const SESSION_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "ClipHunter");
const SESSION_FILE = path.join(SESSION_DIR, "session.json");

function saveRefreshToken(token: string) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ refresh_token: token }), { mode: 0o600 });
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))));
}

/** Reads a line without echoing it (password). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") process.exit(130); // Ctrl+C
        if (c === "\u0008" || c === "\u007f") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

/** Exit code the tray app reads as "please sign in". */
export const NEEDS_SIGNIN = 2;
const BACKGROUND = process.argv.includes("--background");
const SIGNIN_ONLY = process.argv.includes("--signin");

export async function signIn(): Promise<{ sb: SupabaseClient; userId: string; email: string }> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anon) die("Supabase URL / anon key are missing (.env.local, or config.json in ClipHunter Helper).");
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });

  // developer mode
  const devEmail = env("CLIPHUNTER_WORKER_EMAIL");
  const devPassword = env("CLIPHUNTER_WORKER_PASSWORD");
  if (devEmail && devPassword) {
    const { data, error } = await sb.auth.signInWithPassword({ email: devEmail, password: devPassword });
    if (error || !data.user) die(`Sign-in failed: ${error?.message ?? "unknown error"}`);
    return { sb, userId: data.user.id, email: data.user.email ?? devEmail };
  }

  if (process.argv.includes("--logout")) {
    fs.rmSync(SESSION_FILE, { force: true });
    log("Signed out — you'll be asked to sign in again.");
  }

  // refresh tokens rotate: keep the newest one on disk
  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.refresh_token) saveRefreshToken(session.refresh_token);
  });

  if (fs.existsSync(SESSION_FILE) && !SIGNIN_ONLY) {
    try {
      const { refresh_token } = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")) as { refresh_token: string };
      const { data, error } = await sb.auth.refreshSession({ refresh_token });
      if (!error && data.user) return { sb, userId: data.user.id, email: data.user.email ?? "" };
    } catch {
      /* fall through to the prompt */
    }
    log("Your saved sign-in expired — please sign in again.");
  }

  if (BACKGROUND) {
    log("Not signed in — waiting for you to sign in from the tray icon.");
    process.exit(NEEDS_SIGNIN);
  }

  console.log("Sign in with your ClipHunter account (the same login as the website).\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    const email = await ask("Email: ");
    const password = await askHidden("Password: ");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (!error && data.user && data.session) {
      saveRefreshToken(data.session.refresh_token);
      console.log("");
      if (SIGNIN_ONLY) {
        console.log("✔ Signed in. ClipHunter Helper keeps running in the background (tray icon).");
        await new Promise((r) => setTimeout(r, 2500));
        process.exit(0);
      }
      return { sb, userId: data.user.id, email: data.user.email ?? email };
    }
    console.log(`  ✖ ${error?.message ?? "Sign-in failed"} — try again.\n`);
  }
  die("Too many failed sign-in attempts.");
}
