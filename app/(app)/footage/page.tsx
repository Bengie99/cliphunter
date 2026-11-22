import Link from "next/link";
import { HardDrive } from "lucide-react";
import { PlatformBadge } from "@/components/clips/badges";
import { HelperStatus } from "@/components/editor/helper-status";
import { FootageTable } from "@/components/footage/footage-table";
import { AutoRefresh } from "@/components/editor/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDataMode } from "@/lib/env";
import { timeAgo } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/types";

export const metadata = { title: "Downloaded Footage" };
export const dynamic = "force-dynamic";

type FileRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  duration_seconds: number | null;
  resolution: string | null;
  downloaded_at: string | null;
  clips: { id: string; title: string; creator_name: string | null; platform: Platform; original_url: string } | null;
};

type QueueRow = {
  id: string;
  title: string;
  creator_name: string | null;
  platform: Platform;
  download_status: "queued" | "downloading" | "failed";
  download_error: string | null;
  download_requested_at: string | null;
};

const QUEUE_BADGE = {
  queued: { label: "Queued", variant: "outline" },
  downloading: { label: "Downloading", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
} as const;

const mb = (bytes: number | null) => (bytes == null ? "—" : `${(bytes / 1_048_576).toFixed(1)} MB`);

export default async function FootagePage() {
  if (getDataMode() !== "supabase") {
    return (
      <div className="space-y-5">
        <PageHeader title="Downloaded Footage" />
        <Card className="border-dashed">
          <CardContent className="pt-5 text-sm text-muted-foreground">Downloads need Supabase. They aren&apos;t available in demo mode.</CardContent>
        </Card>
      </div>
    );
  }

  const sb = createSupabaseServerClient();
  const [files, queue] = await Promise.all([
    sb
      .from("clip_files")
      .select("id, file_name, file_path, file_size, duration_seconds, resolution, downloaded_at, clips(id, title, creator_name, platform, original_url)")
      .order("downloaded_at", { ascending: false, nullsFirst: false })
      .limit(200),
    sb
      .from("clips")
      .select("id, title, creator_name, platform, download_status, download_error, download_requested_at")
      .in("download_status", ["queued", "downloading", "failed"])
      .order("download_requested_at", { ascending: true })
      .limit(100),
  ]);
  const fileRows = (files.data ?? []) as unknown as FileRow[];
  const queueRows = (queue.data ?? []) as QueueRow[];
  const clipIds = fileRows.map((f) => f.clips?.id).filter((x): x is string => Boolean(x));
  const editsRes = clipIds.length
    ? await sb.from("clip_edits").select("clip_id, render_status, render_progress, transcript_status").in("clip_id", clipIds)
    : { data: [], error: null };
  const edits = new Map((editsRes.data ?? []).map((e) => [e.clip_id as string, e]));
  const loadError = files.error?.message ?? queue.error?.message ?? editsRes.error?.message;
  const working = (editsRes.data ?? []).some((e) => ["queued", "running"].includes(e.render_status) || ["queued", "running"].includes(e.transcript_status));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Downloaded Footage"
        description="Clips you queued with the Download button are saved on your PC by the background helper. Save MP4 downloads a copy in this browser. Clips without creator permission are marked Transformative use."
      />
      {working && <AutoRefresh seconds={6} />}

      {loadError && (
        <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {loadError}. Has the <span className="font-mono">20261121000000_downloads.sql</span> migration been run?
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <HelperStatus />
        </CardHeader>
        <CardContent>
          {queueRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting. Click Download on any clip to queue it.</p>
          ) : (
            <ul className="divide-y text-sm">
              {queueRows.map((q) => (
                <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PlatformBadge platform={q.platform} />
                      <Link href={`/clips?q=${encodeURIComponent(q.title.slice(0, 60))}`} className="truncate font-medium hover:text-violet-300">
                        {q.title}
                      </Link>
                    </div>
                    {q.download_error && <p className="mt-1 text-xs text-red-300">{q.download_error}</p>}
                  </div>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {q.creator_name}
                    {q.download_requested_at && <span>· {timeAgo(q.download_requested_at)}</span>}
                    <Badge variant={QUEUE_BADGE[q.download_status].variant}>{QUEUE_BADGE[q.download_status].label}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {queueRows.some((q) => q.download_status === "queued") && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Items stuck on Queued? The helper of the person who clicked Download isn&apos;t running — start “ClipHunter Helper” on that PC.
            </p>
          )}
        </CardContent>
      </Card>

      {fileRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <HardDrive className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No footage yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Downloaded clips will appear here.</p>
        </div>
      ) : (
        <FootageTable
          rows={fileRows.map((f) => {
            const e = f.clips ? edits.get(f.clips.id) : undefined;
            return {
              id: f.id,
              file_name: f.file_name,
              file_path: f.file_path,
              file_size: f.file_size,
              duration_seconds: f.duration_seconds,
              resolution: f.resolution,
              downloaded_at: f.downloaded_at,
              clip: f.clips ? { id: f.clips.id, title: f.clips.title, creator_name: f.clips.creator_name, platform: f.clips.platform } : null,
              render: e && e.render_status !== "none" ? { status: e.render_status, progress: e.render_progress } : null,
              analysis: e?.transcript_status ?? null,
            };
          })}
        />
      )}
    </div>
  );
}
