"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { requestFileAction } from "@/app/editor-actions";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const POLL_MS = 2000;
const GIVE_UP_MS = 15 * 60_000;

/**
 * "Save MP4": asks the helper on the PC that has the file to upload a
 * temporary copy (kept ~2 hours), then the browser downloads it like any
 * other download.
 */
export function SaveMp4Button({
  clipId,
  kind,
  label = "Save MP4",
  size = "sm",
  variant = "outline",
}: {
  clipId: string;
  kind: "source" | "render";
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
}) {
  const [state, setState] = useState<"idle" | "waiting" | "uploading">("idle");
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  async function save() {
    setState("waiting");
    const res = await requestFileAction(clipId, kind);
    if (!res.ok) {
      setState("idle");
      return void toast.error(res.error);
    }
    const sb = createSupabaseBrowserClient();
    const started = Date.now();
    let warned = false;
    while (!cancelled.current && Date.now() - started < GIVE_UP_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const { data, error } = await sb.from("file_requests").select("status, storage_path, file_name, error").eq("id", res.data.id).maybeSingle();
      if (error || !data) continue;
      if (data.status === "uploading") setState("uploading");
      if (data.status === "failed") {
        setState("idle");
        return void toast.error(`Couldn't prepare the file: ${data.error ?? "unknown error"}`);
      }
      if (data.status === "ready" && data.storage_path) {
        const { data: signed, error: signErr } = await sb.storage.from("media").createSignedUrl(data.storage_path, 600, { download: data.file_name ?? "short.mp4" });
        setState("idle");
        if (signErr || !signed) return void toast.error(`Download link failed: ${signErr?.message ?? "no link"}`);
        const a = document.createElement("a");
        a.href = signed.signedUrl;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return void toast.success("Downloading — check your browser's downloads.");
      }
      if (data.status === "queued" && !warned && Date.now() - started > 20_000) {
        warned = true;
        toast.info("Still waiting for the helper on the PC that has this file. Is it running there?");
      }
    }
    setState("idle");
  }

  return (
    <Button size={size} variant={variant} onClick={save} disabled={state !== "idle"} title="Download the MP4 in this browser">
      {state === "idle" ? <Download /> : <Loader2 className="animate-spin" />}
      {state === "waiting" ? "Asking helper…" : state === "uploading" ? "Preparing…" : label}
    </Button>
  );
}
