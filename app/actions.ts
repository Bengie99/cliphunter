"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepository } from "@/lib/data";
import { NotFoundError } from "@/lib/data/repository";
import { lookupClipUrl, type UrlMetadata } from "@/lib/metadata/lookup";
import { parseClipUrl } from "@/lib/platforms";
import { RIGHTS_STATUSES, REVIEW_STATUSES, type Clip, type ClipNote } from "@/lib/types";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorMessage(err: unknown): string {
  if (err instanceof NotFoundError) return err.message;
  console.error("[cliphunter] action failed:", err);
  return err instanceof Error ? err.message : "Something went wrong";
}

function refresh() {
  revalidatePath("/", "layout");
}

const idsSchema = z.array(z.string().min(1).max(100)).min(1).max(500);

// ---------------------------------------------------------------------------
// Manual URL submission
// ---------------------------------------------------------------------------

export async function lookupUrlAction(
  url: string,
): Promise<ActionResult<UrlMetadata & { existing: Pick<Clip, "id" | "title" | "review_status"> | null }>> {
  const parsedUrl = z.string().url().max(2000).safeParse(url);
  if (!parsedUrl.success) return { ok: false, error: "Enter a valid URL." };
  try {
    const res = await lookupClipUrl(parsedUrl.data);
    if (!res.ok) return res;
    const existing = await getRepository().findClipByExternalId(res.data.parsed.platform, res.data.parsed.externalId);
    return {
      ok: true,
      data: {
        ...res.data,
        existing: existing ? { id: existing.id, title: existing.title, review_status: existing.review_status } : null,
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const optionalCount = z.number().int().min(0).max(1e12).nullable().optional();
const newClipSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().trim().min(1, "Title is required").max(300),
  creatorName: z.string().trim().max(100).nullable().optional(),
  creatorUrl: z.string().url().max(500).nullable().optional(),
  thumbnailUrl: z.string().url().max(2000).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  views: optionalCount,
  likes: optionalCount,
  comments: optionalCount,
  category: z.string().trim().max(100).nullable().optional(),
  language: z.string().trim().max(10).nullable().optional(),
  uploadedAt: z.string().datetime({ offset: true }).nullable().optional(),
  rightsStatus: z.enum(RIGHTS_STATUSES).default("unknown"),
  note: z.string().trim().max(5000).nullable().optional(),
});
export type NewClipForm = z.input<typeof newClipSchema>;

export async function createClipAction(input: NewClipForm): Promise<ActionResult<{ clip: Clip; duplicate: boolean }>> {
  const parsed = newClipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  const urlInfo = parseClipUrl(v.url);
  if (!urlInfo) return { ok: false, error: "Unrecognised clip URL." };
  try {
    const result = await getRepository().createClip({
      platform: urlInfo.platform,
      external_clip_id: urlInfo.externalId,
      original_url: urlInfo.canonicalUrl,
      title: v.title,
      creator_name: v.creatorName || null,
      creator_url: v.creatorUrl || urlInfo.creatorUrl,
      creator_external_id: urlInfo.creatorHandle,
      thumbnail_url: v.thumbnailUrl || null,
      duration_seconds: v.durationSeconds ?? null,
      views: v.views ?? null,
      likes: v.likes ?? null,
      comments: v.comments ?? null,
      category: v.category || null,
      language: v.language || null,
      uploaded_at: v.uploadedAt ?? null,
      rights_status: v.rightsStatus,
      source: "manual",
      note: v.note || null,
    });
    refresh();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Review, favorites
// ---------------------------------------------------------------------------

export async function setReviewStatusAction(ids: string[], status: string): Promise<ActionResult<{ count: number }>> {
  const p = z.object({ ids: idsSchema, status: z.enum(REVIEW_STATUSES) }).safeParse({ ids, status });
  if (!p.success) return { ok: false, error: "Invalid request" };
  try {
    const count = await getRepository().setReviewStatus(p.data.ids, p.data.status);
    refresh();
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setFavoriteAction(ids: string[], favorite: boolean): Promise<ActionResult> {
  const p = z.object({ ids: idsSchema, favorite: z.boolean() }).safeParse({ ids, favorite });
  if (!p.success) return { ok: false, error: "Invalid request" };
  try {
    await getRepository().setFavorite(p.data.ids, p.data.favorite);
    refresh();
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listNotesAction(clipId: string): Promise<ActionResult<ClipNote[]>> {
  if (!clipId || clipId.length > 100) return { ok: false, error: "Invalid clip" };
  try {
    return { ok: true, data: await getRepository().listNotes(clipId) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function addNoteAction(clipId: string, note: string): Promise<ActionResult<ClipNote>> {
  const p = z
    .object({ clipId: z.string().min(1).max(100), note: z.string().trim().min(1, "Note is empty").max(5000) })
    .safeParse({ clipId, note });
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid note" };
  try {
    const row = await getRepository().addNote(p.data.clipId, p.data.note);
    refresh();
    return { ok: true, data: row };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteNoteAction(noteId: string): Promise<ActionResult> {
  if (!noteId || noteId.length > 100) return { ok: false, error: "Invalid note" };
  try {
    await getRepository().deleteNote(noteId);
    refresh();
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
