import Link from "next/link";
import { HardDrive } from "lucide-react";
import { PlatformBadge } from "@/components/clips/badges";
import { CopyPathButton } from "@/components/footage/copy-path-button";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDataMode } from "@/lib/env";
import { formatDateTime, formatDuration, timeAgo } from "@/lib/format";
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
  const loadError = files.error?.message ?? queue.error?.message;
  const fileRows = (files.data ?? []) as unknown as FileRow[];
  const queueRows = (queue.data ?? []) as QueueRow[];
  const totalSize = fileRows.reduce((s, f) => s + (f.file_size ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Downloaded Footage"
        description="Clips you queued with the Download button are saved on your PC by the download helper. Clips without creator permission are marked Transformative use."
      />

      {loadError && (
        <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {loadError}. Has the <span className="font-mono">20261121000000_downloads.sql</span> migration been run?
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <span className="text-xs text-muted-foreground">
            Helper: run <code className="rounded bg-secondary px-1">npm run worker</code> in the project folder
          </span>
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
            <p className="mt-3 text-[11px] text-muted-foreground">Items stuck on Queued? The helper isn&apos;t running — start it on your PC.</p>
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
        <div className="overflow-x-auto rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {fileRows.length} file{fileRows.length === 1 ? "" : "s"}
            </span>
            <span>{mb(totalSize)} on disk</span>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Clip</th>
                <th className="px-4 py-2.5 font-medium">Length</th>
                <th className="px-4 py-2.5 font-medium">Resolution</th>
                <th className="px-4 py-2.5 font-medium">Size</th>
                <th className="px-4 py-2.5 font-medium">Downloaded</th>
                <th className="px-4 py-2.5 font-medium">File on your PC</th>
              </tr>
            </thead>
            <tbody>
              {fileRows.map((f) => (
                <tr key={f.id} className="border-b align-top last:border-b-0">
                  <td className="px-4 py-2.5">
                    {f.clips ? (
                      <>
                        <div className="flex items-center gap-2">
                          <PlatformBadge platform={f.clips.platform} />
                          <Link href={`/clips?q=${encodeURIComponent(f.clips.title.slice(0, 60))}`} className="font-medium hover:text-violet-300">
                            {f.clips.title}
                          </Link>
                        </div>
                        {f.clips.creator_name && <div className="mt-0.5 text-xs text-muted-foreground">{f.clips.creator_name}</div>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{f.file_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{formatDuration(f.duration_seconds)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{f.resolution ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{mb(f.file_size)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground" title={formatDateTime(f.downloaded_at)}>
                    {f.downloaded_at ? timeAgo(f.downloaded_at) : "—"}
                  </td>
                  <td className="max-w-[280px] px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <code className="truncate text-[11px] text-muted-foreground" title={f.file_path}>
                        {f.file_name}
                      </code>
                      <CopyPathButton path={f.file_path} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
