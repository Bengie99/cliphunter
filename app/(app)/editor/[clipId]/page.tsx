import Link from "next/link";
import { notFound } from "next/navigation";
import { ShortEditor, type EditorData } from "@/components/editor/short-editor";
import { AutoRefresh } from "@/components/editor/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getDataMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceId } from "@/lib/supabase/workspace";
import { defaultSpec, type EditSpec, type Word } from "@/remotion/spec";

export const metadata = { title: "Editor" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // the Claude description writer runs as a server action from this page

const SIGNED_URL_TTL = 6 * 3600;

export default async function EditorPage({ params }: { params: { clipId: string } }) {
  if (getDataMode() !== "supabase") {
    return <Message title="Editor">The editor needs Supabase. It isn&apos;t available in demo mode.</Message>;
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.clipId)) notFound();

  const sb = createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) notFound();

  const [clipRes, fileRes, editRes, audioRes] = await Promise.all([
    sb.from("clips").select("id, title, creator_name, creator_url, platform, download_status").eq("id", params.clipId).maybeSingle(),
    sb
      .from("clip_files")
      .select("id, file_path, duration_seconds, resolution, proxy_path, proxy_status, proxy_error")
      .eq("clip_id", params.clipId)
      .order("downloaded_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("clip_edits")
      .select("spec, transcript, transcript_status, transcript_error, render_status, render_progress, render_error, output_path, output_size, rendered_at, yt_title, yt_description, yt_tags")
      .eq("clip_id", params.clipId)
      .maybeSingle(),
    sb.from("audio_assets").select("id, kind, name, storage_path").order("created_at", { ascending: true }),
  ]);

  const loadError = clipRes.error ?? fileRes.error ?? editRes.error ?? audioRes.error;
  if (loadError) {
    return (
      <Message title="Editor">
        {loadError.message}. Has the <span className="font-mono">20261124000000_editor.sql</span> migration been run?
      </Message>
    );
  }
  const clip = clipRes.data;
  if (!clip) notFound();
  const file = fileRes.data;

  if (!file) {
    return (
      <Message title={clip.title}>
        This clip hasn&apos;t been downloaded yet. Click <b>Download</b> on it first (the helper must be running), then come back.{" "}
        <Link href="/footage" className="underline">
          Downloaded Footage
        </Link>
      </Message>
    );
  }

  if (file.proxy_status !== "done" || !file.proxy_path) {
    const failed = file.proxy_status === "failed";
    return (
      <Message title={clip.title}>
        {failed ? (
          <>Preparing the preview failed: {file.proxy_error ?? "unknown error"}. Restart the helper to retry.</>
        ) : (
          <>
            Preparing a preview copy… The download helper on your PC (<code>npm run worker</code>) creates it, usually within a minute.
            <AutoRefresh seconds={5} />
          </>
        )}
      </Message>
    );
  }

  const [w, h] = (file.resolution ?? "1920x1080").split("x").map(Number);
  const audioAssets = audioRes.data ?? [];
  const paths = [file.proxy_path, ...audioAssets.map((a) => a.storage_path)];
  const { data: signed, error: signErr } = await sb.storage.from("media").createSignedUrls(paths, SIGNED_URL_TTL);
  if (signErr || !signed?.[0]?.signedUrl) return <Message title={clip.title}>Couldn&apos;t load the preview: {signErr?.message ?? "no URL"}</Message>;

  const edit = editRes.data;
  const transcript = (edit?.transcript as Word[] | null) ?? null;
  let spec = (edit?.spec as EditSpec | null) ?? null;
  if (!spec || spec.version !== 1) {
    spec = defaultSpec({
      duration: Number(file.duration_seconds) || 60,
      width: w || 1920,
      height: h || 1080,
      creatorName: clip.creator_name,
      creatorUrl: clip.creator_url,
    });
  }
  if (spec.captions.words.length === 0 && transcript?.length) spec = { ...spec, captions: { ...spec.captions, words: transcript } };

  const data: EditorData = {
    clip: { id: clip.id, title: clip.title, creatorName: clip.creator_name, platform: clip.platform },
    workspaceId: await getWorkspaceId(sb),
    spec,
    proxyUrl: signed[0].signedUrl,
    audio: audioAssets.map((a, i) => ({ id: a.id, kind: a.kind, name: a.name, url: signed[i + 1]?.signedUrl ?? "" })),
    transcript,
    transcriptStatus: edit?.transcript_status ?? "none",
    transcriptError: edit?.transcript_error ?? null,
    renderStatus: edit?.render_status ?? "none",
    renderProgress: edit?.render_progress ?? null,
    renderError: edit?.render_error ?? null,
    outputPath: edit?.output_path ?? null,
    outputSize: edit?.output_size ?? null,
    renderedAt: edit?.rendered_at ?? null,
    meta: { title: edit?.yt_title ?? "", description: edit?.yt_description ?? "", tags: edit?.yt_tags ?? [] },
    hasClaudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  return <ShortEditor data={data} />;
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} />
      <Card className="border-dashed">
        <CardContent className="pt-5 text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  );
}
