"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Camera, Clapperboard, Copy, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePresetAction, generateMetadataAction, queueRenderAction, saveMetadataAction, savePresetAction } from "@/app/editor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { applyPreset, extractPreset, outputDuration } from "@/remotion/spec";
import { fmt, type PanelProps } from "./editor-types";
import { Hint, Section, Toggle } from "./editor-ui";
import { SaveMp4Button } from "./save-mp4";

export function PublishPanel({ spec, update, data, outT, seekOutput }: PanelProps) {
  const router = useRouter();
  const [rendering, startRender] = useTransition();
  const [writing, startWrite] = useTransition();
  const [meta, setMeta] = useState({ title: data.meta.title, description: data.meta.description, tags: data.meta.tags.join(" ") });
  const [metaSaved, setMetaSaved] = useState(true);
  const status = data.renderStatus;
  const total = outputDuration(spec);

  const render = () =>
    startRender(async () => {
      const res = await queueRenderAction(data.clip.id, spec);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Queued — the helper on your PC will render the Short.");
      router.refresh();
    });

  const write = () =>
    startWrite(async () => {
      const res = await generateMetadataAction(data.clip.id);
      if (!res.ok) return void toast.error(res.error);
      setMeta({ title: res.data.title, description: res.data.description, tags: res.data.tags.join(" ") });
      setMetaSaved(true);
      toast.success("Title, description and hashtags written");
    });

  const saveMeta = async () => {
    const res = await saveMetadataAction(data.clip.id, {
      title: meta.title,
      description: meta.description,
      tags: meta.tags.split(/[\s,]+/).filter(Boolean),
    });
    if (!res.ok) toast.error(res.error);
    else setMetaSaved(true);
  };

  return (
    <div className="space-y-7">
      <Section title="Render">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={render} disabled={rendering || status === "queued" || status === "running"}>
            {status === "queued" || status === "running" ? <Loader2 className="animate-spin" /> : <Clapperboard />}
            {status === "queued" ? "Waiting for helper…" : status === "running" ? `Rendering ${Math.round((data.renderProgress ?? 0) * 100)}%` : status === "done" ? "Render again" : "Render Short"}
          </Button>
          {status === "done" && <SaveMp4Button clipId={data.clip.id} kind="render" label="Download MP4" variant="secondary" />}
          <span className="text-xs text-muted-foreground">1080×1920 · 30 fps · {fmt(total)}</span>
        </div>
        {status === "running" && (
          <div className="h-1.5 overflow-hidden rounded bg-secondary">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.round((data.renderProgress ?? 0) * 100)}%` }} />
          </div>
        )}
        {status === "failed" && <p className="text-xs text-red-300">Render failed: {data.renderError}</p>}
        {status === "queued" && <Hint>The helper on the PC that downloaded this clip renders it. The first render downloads a rendering browser (~100 MB).</Hint>}
        {status === "done" && data.outputPath && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <span className="min-w-0 flex-1 truncate" title={data.outputPath}>
              On the PC{data.outputSize ? ` (${(data.outputSize / 1_048_576).toFixed(1)} MB)` : ""}: {data.outputPath}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label="Copy path" onClick={() => navigator.clipboard.writeText(data.outputPath!).then(() => toast.success("Path copied"))}>
              <Copy />
            </Button>
          </div>
        )}
        <Hint>Edits made after rendering need a new render. Loudness, noise reduction and the cover are applied during the render.</Hint>
      </Section>

      <Section title="Cover frame">
        <div className="flex flex-wrap items-center gap-3">
          {data.coverUrl && status === "done" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.coverUrl} alt="Rendered cover" className="h-28 rounded-md border object-cover" style={{ aspectRatio: "9/16" }} />
          ) : null}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => update((s) => ({ ...s, cover: { t: Math.round(outT * 100) / 100 } }))}>
                <Camera /> Use frame at {fmt(outT)}
              </Button>
              {spec.cover.t != null && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => seekOutput(spec.cover.t!)}>
                    Show ({fmt(spec.cover.t)})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update((s) => ({ ...s, cover: { t: null } }))}>
                    Clear
                  </Button>
                </>
              )}
            </div>
            <Hint>Saved as a JPG next to the Short when it renders — for the YouTube thumbnail.</Hint>
          </div>
        </div>
      </Section>

      <PresetsSection spec={spec} update={update} data={data} />

      <Section
        title="YouTube title, description & hashtags"
        action={
          <Button size="sm" variant="outline" onClick={write} disabled={writing || !data.hasClaudeKey} title={data.hasClaudeKey ? undefined : "Add ANTHROPIC_API_KEY in Vercel first"}>
            {writing ? <Loader2 className="animate-spin" /> : <Sparkles />} Write with Claude
          </Button>
        }
      >
        {!data.hasClaudeKey && <Hint>Add <code>ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables and redeploy to enable this.</Hint>}
        <div className="space-y-1">
          <div className="flex justify-between">
            <Label>Title</Label>
            <span className={cn("text-[11px]", meta.title.length > 100 ? "text-red-300" : "text-muted-foreground")}>{meta.title.length}/100</span>
          </div>
          <Input value={meta.title} onChange={(e) => (setMeta({ ...meta, title: e.target.value }), setMetaSaved(false))} />
        </div>
        <div className="space-y-1">
          <Label>Description</Label>
          <Textarea rows={6} value={meta.description} onChange={(e) => (setMeta({ ...meta, description: e.target.value }), setMetaSaved(false))} />
        </div>
        <div className="space-y-1">
          <Label>Hashtags</Label>
          <Input value={meta.tags} placeholder="#shorts #gta6" onChange={(e) => (setMeta({ ...meta, tags: e.target.value }), setMetaSaved(false))} />
        </div>
        <Button size="sm" onClick={saveMeta} disabled={metaSaved}>
          {metaSaved ? "Saved" : "Save"}
        </Button>
      </Section>
    </div>
  );
}

function PresetsSection({ spec, update, data }: Pick<PanelProps, "spec" | "update" | "data">) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [forCreator, setForCreator] = useState(Boolean(data.clip.creatorId));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.warning("Give the preset a name.");
    setBusy(true);
    const res = await savePresetAction({ name: name.trim(), creatorId: forCreator ? data.clip.creatorId : null, settings: extractPreset(spec) });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(forCreator && data.clip.creatorName ? `Saved — new clips from ${data.clip.creatorName} start with this look.` : "Preset saved");
    setName("");
    router.refresh();
  };

  return (
    <Section title="Presets">
      <Hint>A preset saves the look — layout, caption style, censoring, motion, audio settings — not the cuts or words.</Hint>
      {data.presets.length > 0 && (
        <div className="divide-y rounded-md border">
          {data.presets.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Bookmark className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {p.name}
                {p.creatorId && p.creatorId === data.clip.creatorId && <span className="ml-2 text-xs text-violet-300">default for {data.clip.creatorName}</span>}
                {p.creatorId && p.creatorId !== data.clip.creatorId && <span className="ml-2 text-xs text-muted-foreground">creator default</span>}
              </span>
              <Button size="sm" variant="outline" onClick={() => (update((s) => applyPreset(s, p.settings)), toast.success(`Applied “${p.name}”`))}>
                Apply
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete preset"
                onClick={async () => {
                  const res = await deletePresetAction(p.id);
                  if (!res.ok) toast.error(res.error);
                  else router.refresh();
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 max-w-60" placeholder="Preset name, e.g. GTA facecam" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Bookmark />} Save current look
        </Button>
        {data.clip.creatorId && (
          <Toggle checked={forCreator} onChange={setForCreator} className="text-xs">
            default for {data.clip.creatorName ?? "this creator"}
          </Toggle>
        )}
      </div>
    </Section>
  );
}
