"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDataMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

/**
 * Download queue. The web app only queues; the helper on the user's PC
 * (`npm run worker`) does the downloading. A clip can be queued when its
 * creator granted permission, or — after the user confirms — without
 * permission, in which case it is marked "transformative_use" so the record
 * stays honest. Also enforced by a database constraint.
 */

const DOWNLOADABLE = ["transformative_use", "download_authorized", "republish_authorized"];
const UNPERMITTED = ["unknown", "public_discoverable", "preview_allowed"];

async function client() {
  if (getDataMode() !== "supabase") throw new Error("Downloads need Supabase — they aren't available in demo mode.");
  const sb = createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You're signed out. Sign in again.");
  return sb;
}

const idsSchema = z.array(z.string().uuid()).min(1).max(200);

export async function queueDownloadsAction(
  ids: string[],
  opts: { withoutPermission?: boolean } = {},
): Promise<ActionResult<{ queued: number; skipped: number }>> {
  const p = idsSchema.safeParse(ids);
  if (!p.success) return { ok: false, error: "Invalid request" };
  try {
    const sb = await client();
    if (opts.withoutPermission === true) {
      const { error: markErr } = await sb
        .from("clips")
        .update({ rights_status: "transformative_use" })
        .in("id", p.data)
        .in("rights_status", UNPERMITTED);
      if (markErr) throw new Error(`Marking clips failed: ${markErr.message}`);
    }
    const { data, error } = await sb
      .from("clips")
      .update({ download_status: "queued", download_error: null, download_requested_at: new Date().toISOString() })
      .in("id", p.data)
      .in("rights_status", DOWNLOADABLE)
      .in("download_status", ["not_available", "awaiting_authorization", "ready", "failed"])
      .select("id, pipeline_status");
    if (error) throw new Error(`Queueing failed: ${error.message}`);

    // Approved clips move to "ready for download" in the content pipeline.
    const approved = data.filter((c) => c.pipeline_status === "approved").map((c) => c.id);
    if (approved.length) await sb.from("clips").update({ pipeline_status: "ready_for_download" }).in("id", approved);

    revalidatePath("/", "layout");
    return { ok: true, data: { queued: data.length, skipped: p.data.length - data.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function cancelDownloadAction(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid request" };
  try {
    const sb = await client();
    const { error } = await sb
      .from("clips")
      .update({ download_status: "not_available", download_requested_at: null })
      .eq("id", id)
      .eq("download_status", "queued");
    if (error) throw new Error(`Cancelling failed: ${error.message}`);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}
