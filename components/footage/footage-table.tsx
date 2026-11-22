"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { batchQueueAction } from "@/app/editor-actions";
import { PlatformBadge } from "@/components/clips/badges";
import { SaveMp4Button } from "@/components/editor/save-mp4";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDuration, timeAgo } from "@/lib/format";
import type { Platform } from "@/lib/types";
import { CopyPathButton } from "./copy-path-button";

export type FootageRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  duration_seconds: number | null;
  resolution: string | null;
  downloaded_at: string | null;
  clip: { id: string; title: string; creator_name: string | null; platform: Platform } | null;
  render: { status: string; progress: number | null } | null;
  analysis: string | null;
};

const mb = (bytes: number | null) => (bytes == null ? "—" : `${(bytes / 1_048_576).toFixed(1)} MB`);

const RENDER_BADGE: Record<string, { label: string; variant: "outline" | "warning" | "success" | "danger" }> = {
  queued: { label: "Render queued", variant: "outline" },
  running: { label: "Rendering", variant: "warning" },
  done: { label: "Short ready", variant: "success" },
  failed: { label: "Render failed", variant: "danger" },
};

export function FootageTable({ rows }: { rows: FootageRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const clipIds = rows.map((r) => r.clip?.id).filter((x): x is string => Boolean(x));
  const allOn = clipIds.length > 0 && clipIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const batch = (what: "analyze" | "render") =>
    start(async () => {
      const res = await batchQueueAction([...selected], what);
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        `${res.data.queued} clip${res.data.queued === 1 ? "" : "s"} queued for ${what === "analyze" ? "analysis" : "rendering"}${res.data.skipped ? ` · ${res.data.skipped} skipped (already running)` : ""}.`,
      );
      setSelected(new Set());
      router.refresh();
    });

  const totalSize = rows.reduce((s, f) => s + (f.file_size ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => batch("analyze")} title="Subtitles, loudness and scene changes">
              {pending ? <Loader2 className="animate-spin" /> : <Wand2 />} Analyze
            </Button>
            <Button size="sm" disabled={pending} onClick={() => batch("render")} title="Uses each clip's saved edit; never-edited clips use their creator's default preset">
              {pending ? <Loader2 className="animate-spin" /> : <Clapperboard />} Render Shorts
            </Button>
            <button type="button" className="underline" onClick={() => setSelected(new Set())}>
              clear
            </button>
          </div>
        ) : (
          <span>
            {rows.length} file{rows.length === 1 ? "" : "s"} · select clips to analyze or render several at once
          </span>
        )}
        <span>{mb(totalSize)} on disk</span>
      </div>
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="w-10 px-4 py-2.5">
              <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v === true ? new Set(clipIds) : new Set())} aria-label="Select all" />
            </th>
            <th className="px-2 py-2.5 font-medium">Clip</th>
            <th className="px-4 py-2.5 font-medium">Length</th>
            <th className="px-4 py-2.5 font-medium">Size</th>
            <th className="px-4 py-2.5 font-medium">Downloaded</th>
            <th className="px-4 py-2.5 font-medium">Short</th>
            <th className="px-4 py-2.5 font-medium">File</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const rb = f.render ? RENDER_BADGE[f.render.status] : null;
            return (
              <tr key={f.id} className="border-b align-top last:border-b-0">
                <td className="px-4 py-3">{f.clip && <Checkbox checked={selected.has(f.clip.id)} onCheckedChange={() => toggle(f.clip!.id)} aria-label="Select clip" />}</td>
                <td className="px-2 py-2.5">
                  {f.clip ? (
                    <>
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={f.clip.platform} />
                        <Link href={`/editor/${f.clip.id}`} className="font-medium hover:text-violet-300">
                          {f.clip.title}
                        </Link>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {f.clip.creator_name}
                        {f.resolution ? ` · ${f.resolution}` : ""}
                        {f.analysis === "done" ? " · analyzed" : f.analysis === "running" || f.analysis === "queued" ? " · analyzing…" : ""}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{f.file_name}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatDuration(f.duration_seconds)}</td>
                <td className="px-4 py-2.5 tabular-nums">{mb(f.file_size)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{f.downloaded_at ? timeAgo(f.downloaded_at) : "—"}</td>
                <td className="px-4 py-2.5">
                  {rb ? (
                    <div className="flex flex-col items-start gap-1.5">
                      <Badge variant={rb.variant}>
                        {rb.label}
                        {f.render?.status === "running" && f.render.progress != null ? ` ${Math.round(f.render.progress * 100)}%` : ""}
                      </Badge>
                      {f.render?.status === "done" && f.clip && <SaveMp4Button clipId={f.clip.id} kind="render" label="Short MP4" />}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {f.clip && (
                      <Link
                        href={`/editor/${f.clip.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        Edit
                      </Link>
                    )}
                    {f.clip && <SaveMp4Button clipId={f.clip.id} kind="source" label="Original" />}
                    <CopyPathButton path={f.file_path} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
