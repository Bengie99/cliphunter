"use server";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as z4 from "zod/v4";
import { getDataMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceId } from "@/lib/supabase/workspace";
import type { EditSpec } from "@/remotion/spec";
import type { ActionResult } from "./actions";

async function requireUser() {
  if (getDataMode() !== "supabase") throw new Error("The editor needs Supabase — it isn't available in demo mode.");
  const sb = createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You're signed out. Sign in again.");
  // shared team rows are stored under the workspace id, not the user's own id
  return { sb, workspaceId: await getWorkspaceId(sb) };
}

const fail = (err: unknown): { ok: false; error: string } => {
  console.error("[cliphunter] editor action failed:", err);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
};

const uuid = z.string().uuid();
const n = (min: number, max: number) => z.number().finite().min(min).max(max);

const specSchema = z.object({
  version: z.literal(1),
  sourceDuration: n(0, 36_000),
  sourceWidth: n(1, 10_000),
  sourceHeight: n(1, 10_000),
  segments: z.array(z.object({ start: n(0, 36_000), end: n(0, 36_000) })).min(1).max(200),
  layout: z.object({
    mode: z.enum(["crop", "blur", "split"]),
    cropX: n(0, 1),
    cam: z.object({ x: n(0, 1), y: n(0, 1), w: n(0.02, 1), h: n(0.02, 1) }),
    camHeight: n(0.15, 0.7),
  }),
  captions: z.object({
    enabled: z.boolean(),
    words: z.array(z.object({ text: z.string().max(100), startMs: n(0, 36_000_000), endMs: n(0, 36_000_000) })).max(5000),
    y: n(0, 1),
    size: n(20, 200),
    highlight: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    wordsPerLine: z.number().int().min(1).max(8),
    uppercase: z.boolean(),
  }),
  hook: z.object({ text: z.string().max(200), seconds: n(0.5, 30) }),
  credit: z.object({ enabled: z.boolean(), text: z.string().max(120) }),
  audio: z.object({
    sourceVolume: n(0, 2),
    music: z.object({ assetId: uuid.nullable(), volume: n(0, 1.5), duck: z.boolean() }),
    sfx: z.array(z.object({ id: z.string().max(50), assetId: uuid, at: n(0, 36_000), volume: n(0, 2) })).max(100),
  }),
});

async function upsertEdit(sb: ReturnType<typeof createSupabaseServerClient>, workspaceId: string, clipId: string, fields: Record<string, unknown>) {
  const { error } = await sb
    .from("clip_edits")
    .upsert({ owner_id: workspaceId, clip_id: clipId, ...fields }, { onConflict: "owner_id,clip_id" });
  if (error) throw new Error(`Saving the edit failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// edit spec
// ---------------------------------------------------------------------------

export async function saveEditAction(clipId: string, spec: EditSpec): Promise<ActionResult> {
  const id = uuid.safeParse(clipId);
  const p = specSchema.safeParse(spec);
  if (!id.success) return { ok: false, error: "Invalid clip" };
  if (!p.success) return { ok: false, error: `Invalid edit: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` };
  try {
    const { sb, workspaceId } = await requireUser();
    await upsertEdit(sb, workspaceId, id.data, { spec: p.data });
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export async function queueTranscriptionAction(clipId: string): Promise<ActionResult> {
  if (!uuid.safeParse(clipId).success) return { ok: false, error: "Invalid clip" };
  try {
    const { sb, workspaceId } = await requireUser();
    await upsertEdit(sb, workspaceId, clipId, { transcript_status: "queued", transcript_error: null });
    revalidatePath(`/editor/${clipId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export async function queueRenderAction(clipId: string, spec: EditSpec): Promise<ActionResult> {
  const p = specSchema.safeParse(spec);
  if (!uuid.safeParse(clipId).success) return { ok: false, error: "Invalid clip" };
  if (!p.success) return { ok: false, error: `Invalid edit: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` };
  try {
    const { sb, workspaceId } = await requireUser();
    await upsertEdit(sb, workspaceId, clipId, {
      spec: p.data,
      render_status: "queued",
      render_progress: 0,
      render_error: null,
    });
    await sb.from("clips").update({ pipeline_status: "editing" }).eq("id", clipId).in("pipeline_status", ["downloaded", "ready_for_editing", "edited"]);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// audio library
// ---------------------------------------------------------------------------

export async function registerAudioAssetAction(input: { kind: "music" | "sfx"; name: string; storagePath: string }): Promise<ActionResult<{ id: string }>> {
  const p = z
    .object({ kind: z.enum(["music", "sfx"]), name: z.string().trim().min(1).max(200), storagePath: z.string().min(1).max(500) })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid audio file" };
  try {
    const { sb, workspaceId } = await requireUser();
    if (!p.data.storagePath.startsWith(`${workspaceId}/audio/`)) return { ok: false, error: "Invalid storage path" };
    const { data, error } = await sb
      .from("audio_assets")
      .insert({ kind: p.data.kind, name: p.data.name, storage_path: p.data.storagePath })
      .select("id")
      .single();
    if (error) throw new Error(`Saving audio failed: ${error.message}`);
    revalidatePath("/editor", "layout");
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteAudioAssetAction(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid audio" };
  try {
    const { sb } = await requireUser();
    const { data, error } = await sb.from("audio_assets").delete().eq("id", id).select("storage_path").maybeSingle();
    if (error) throw new Error(`Deleting audio failed: ${error.message}`);
    if (data?.storage_path) await sb.storage.from("media").remove([data.storage_path]);
    revalidatePath("/editor", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// YouTube title / description / hashtags (Claude)
// ---------------------------------------------------------------------------

const MetadataSchema = z4.object({
  title: z4.string(),
  description: z4.string(),
  hashtags: z4.array(z4.string()),
});

const SYSTEM = `You write YouTube Shorts metadata for a GTA / streamer clip channel.
Return a title, a description and hashtags.
- Title: punchy and specific to what happens in the clip, under 70 characters, no clickbait lies, at most one emoji, no hashtags.
- Description: 2-3 short lines about the moment, then a blank line, then exactly the credit line given in the input. Keep it under 600 characters.
- Hashtags: 5-8 relevant tags without spaces, each starting with #, always including #shorts.
Base everything only on the input; don't invent events that the transcript and title don't support.`;

export async function generateMetadataAction(clipId: string): Promise<ActionResult<{ title: string; description: string; tags: string[] }>> {
  if (!uuid.safeParse(clipId).success) return { ok: false, error: "Invalid clip" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy." };
  }
  try {
    const { sb, workspaceId } = await requireUser();
    const [{ data: clip, error: clipErr }, { data: edit }] = await Promise.all([
      sb.from("clips").select("title, creator_name, creator_url, platform, category, original_url").eq("id", clipId).single(),
      sb.from("clip_edits").select("spec").eq("clip_id", clipId).maybeSingle(),
    ]);
    if (clipErr) throw new Error(`Loading clip failed: ${clipErr.message}`);
    const spec = (edit?.spec ?? null) as EditSpec | null;
    const transcript = spec?.captions.words.map((w) => w.text).join(" ").slice(0, 4000) ?? "";
    const credit = clip.creator_name
      ? `🎮 Credit: ${clip.creator_name}${clip.creator_url ? ` — ${clip.creator_url}` : ""}`
      : `Source: ${clip.original_url}`;

    const input = [
      `Original clip title: ${clip.title}`,
      `Streamer: ${clip.creator_name ?? "unknown"} (${clip.platform})`,
      clip.category ? `Game/category: ${clip.category}` : null,
      spec?.hook.text ? `On-screen hook text: ${spec.hook.text}` : null,
      `Transcript: ${transcript || "(no transcript yet)"}`,
      `Credit line (use exactly): ${credit}`,
    ]
      .filter(Boolean)
      .join("\n");

    const client = new Anthropic();
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(MetadataSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: input }],
    });
    if (res.stop_reason === "refusal") return { ok: false, error: "Claude declined to write metadata for this clip." };
    const out = res.parsed_output;
    if (!out) return { ok: false, error: "Claude returned an unexpected response — try again." };

    const tags = [...new Set(out.hashtags.map((t) => `#${t.replace(/^#+/, "").replace(/\s+/g, "")}`).filter((t) => t.length > 1))].slice(0, 10);
    if (!tags.some((t) => t.toLowerCase() === "#shorts")) tags.unshift("#shorts");
    const result = { title: out.title.trim().slice(0, 100), description: out.description.trim().slice(0, 5000), tags };

    await upsertEdit(sb, workspaceId, clipId, { yt_title: result.title, yt_description: result.description, yt_tags: result.tags });
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "Your Anthropic API key was rejected — check ANTHROPIC_API_KEY." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "Claude is rate-limited right now — try again in a minute." };
    if (err instanceof Anthropic.APIError && err.status === 402) return { ok: false, error: "Your Anthropic account is out of credit." };
    return fail(err);
  }
}

export async function saveMetadataAction(clipId: string, input: { title: string; description: string; tags: string[] }): Promise<ActionResult> {
  const p = z
    .object({
      title: z.string().max(100),
      description: z.string().max(5000),
      tags: z.array(z.string().max(60)).max(30),
    })
    .safeParse(input);
  if (!uuid.safeParse(clipId).success || !p.success) return { ok: false, error: "Invalid metadata (title max 100, description max 5000 characters)" };
  try {
    const { sb, workspaceId } = await requireUser();
    await upsertEdit(sb, workspaceId, clipId, { yt_title: p.data.title, yt_description: p.data.description, yt_tags: p.data.tags });
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}
