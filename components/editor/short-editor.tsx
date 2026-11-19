"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, Captions, Clapperboard, Copy, Film, Loader2, Music, Plus, RotateCcw, Scissors, Sparkles, Trash2, Type, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteAudioAssetAction,
  generateMetadataAction,
  queueRenderAction,
  queueTranscriptionAction,
  registerAudioAssetAction,
  saveEditAction,
  saveMetadataAction,
} from "@/app/editor-actions";
import { PlatformBadge } from "@/components/clips/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Platform } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ShortComposition } from "@/remotion/ShortComposition";
import { FPS, OUT_H, OUT_W, durationInFrames, outputDuration, outputToSource, round, type EditSpec, type LayoutMode, type Word } from "@/remotion/spec";

type JobStatus = "none" | "queued" | "running" | "done" | "failed";

export interface EditorData {
  clip: { id: string; title: string; creatorName: string | null; platform: Platform };
  /** Team workspace id — Storage paths live under it. */
  workspaceId: string;
  spec: EditSpec;
  proxyUrl: string;
  audio: { id: string; kind: "music" | "sfx"; name: string; url: string }[];
  transcript: Word[] | null;
  transcriptStatus: JobStatus;
  transcriptError: string | null;
  renderStatus: JobStatus;
  renderProgress: number | null;
  renderError: string | null;
  outputPath: string | null;
  outputSize: number | null;
  renderedAt: string | null;
  meta: { title: string; description: string; tags: string[] };
  hasClaudeKey: boolean;
}

const TABS = [
  { id: "cuts", label: "Cuts", icon: Scissors },
  { id: "layout", label: "Layout", icon: Film },
  { id: "subs", label: "Subtitles", icon: Captions },
  { id: "audio", label: "Audio", icon: Music },
  { id: "text", label: "Text", icon: Type },
  { id: "publish", label: "Render & publish", icon: Clapperboard },
] as const;
type Tab = (typeof TABS)[number]["id"];

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function ShortEditor({ data }: { data: EditorData }) {
  const router = useRouter();
  const playerRef = useRef<PlayerRef>(null);
  const [spec, setSpec] = useState<EditSpec>(data.spec);
  const [tab, setTab] = useState<Tab>("cuts");
  const [frame, setFrame] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  // Signed URLs change on every server refresh; keep the first ones so the preview doesn't reload.
  const [videoSrc] = useState(data.proxyUrl);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>(() => Object.fromEntries(data.audio.map((a) => [a.id, a.url])));

  useEffect(() => {
    setAudioUrls((prev) => {
      const missing = data.audio.filter((a) => !prev[a.id] && a.url);
      return missing.length ? { ...prev, ...Object.fromEntries(missing.map((a) => [a.id, a.url])) } : prev;
    });
  }, [data.audio]);

  // fill subtitles once a transcript arrives (unless the user already has words)
  useEffect(() => {
    if (data.transcript?.length) {
      setSpec((s) => (s.captions.words.length ? s : { ...s, captions: { ...s.captions, words: data.transcript! } }));
    }
  }, [data.transcript]);

  // autosave
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      const res = await saveEditAction(data.clip.id, spec);
      setSaveState(res.ok ? "saved" : "error");
      if (!res.ok) toast.error(res.error);
    }, 800);
    return () => clearTimeout(t);
  }, [spec, data.clip.id]);

  // poll server state while jobs are running
  const busy = ["queued", "running"].includes(data.transcriptStatus) || ["queued", "running"].includes(data.renderStatus);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [busy, router]);

  // playhead
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, []);

  const update = useCallback((fn: (s: EditSpec) => EditSpec) => setSpec((s) => fn(s)), []);
  const outT = frame / FPS;
  const total = outputDuration(spec);
  const inputProps = useMemo(() => ({ spec, videoSrc, audioUrls }), [spec, videoSrc, audioUrls]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm">
            <Link href="/footage" aria-label="Back to footage">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{data.clip.title}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <PlatformBadge platform={data.clip.platform} />
              {data.clip.creatorName}
              <span>· Short length {fmt(total)}</span>
              {total > 60 && <Badge variant="warning">Over 60s</Badge>}
            </div>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "All changes saved"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="overflow-hidden rounded-xl border bg-black">
            <Player
              ref={playerRef}
              component={ShortComposition}
              inputProps={inputProps}
              durationInFrames={durationInFrames(spec)}
              compositionWidth={OUT_W}
              compositionHeight={OUT_H}
              fps={FPS}
              controls
              acknowledgeRemotionLicense
              style={{ width: "100%", aspectRatio: "9 / 16" }}
            />
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Preview uses a 720p copy; the render uses your full-quality file.</p>
        </div>

        <div className="min-w-0 rounded-xl border bg-card">
          <div className="flex gap-1 overflow-x-auto border-b p-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                  tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
          <div className="p-4">
            {tab === "cuts" && <CutsPanel spec={spec} update={update} outT={outT} />}
            {tab === "layout" && <LayoutPanel spec={spec} update={update} />}
            {tab === "subs" && <SubtitlesPanel spec={spec} update={update} data={data} />}
            {tab === "audio" && <AudioPanel spec={spec} update={update} data={data} outT={outT} />}
            {tab === "text" && <TextPanel spec={spec} update={update} />}
            {tab === "publish" && <PublishPanel spec={spec} data={data} />}
          </div>
        </div>
      </div>
    </div>
  );
}

type PanelProps = { spec: EditSpec; update: (fn: (s: EditSpec) => EditSpec) => void };

// ---------------------------------------------------------------------------
// shared controls
// ---------------------------------------------------------------------------

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <Label>{label}</Label>
        <span className="tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-violet-500" />
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// cuts
// ---------------------------------------------------------------------------

function CutsPanel({ spec, update, outT }: PanelProps & { outT: number }) {
  const at = outputToSource(spec, outT);
  const D = spec.sourceDuration || 1;

  const split = () => {
    if (!at) return;
    const seg = spec.segments[at.index];
    const s = round(at.source);
    if (s - seg.start < 0.2 || seg.end - s < 0.2) return toast.warning("Too close to the edge of a part to split here.");
    update((sp) => {
      const segs = [...sp.segments];
      segs.splice(at.index, 1, { start: seg.start, end: s }, { start: s, end: seg.end });
      return { ...sp, segments: segs };
    });
  };

  const setSeg = (i: number, key: "start" | "end", v: number) =>
    update((sp) => {
      const segs = sp.segments.map((seg, j) => (j === i ? { ...seg, [key]: Math.min(Math.max(0, round(v)), sp.sourceDuration) } : seg));
      return segs[i].end - segs[i].start < 0.1 ? sp : { ...sp, segments: segs };
    });

  return (
    <div className="space-y-4">
      <Hint>
        Play the preview to the moment you want to cut, then <b>Split at playhead</b>. Delete a part to remove it from the Short. To cut out the
        middle of a moment, split at its start and at its end, then delete the part in between.
      </Hint>

      <div className="relative h-10 rounded-md bg-secondary">
        {spec.segments.map((seg, i) => (
          <div
            key={i}
            className="absolute inset-y-1 rounded bg-violet-500/60 ring-1 ring-violet-300/40"
            style={{ left: `${(seg.start / D) * 100}%`, width: `${((seg.end - seg.start) / D) * 100}%` }}
            title={`Part ${i + 1}: ${fmt(seg.start)} – ${fmt(seg.end)}`}
          />
        ))}
        {at && <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(at.source / D) * 100}%` }} />}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>0:00</span>
        <span>original clip · {fmt(D)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={split} disabled={!at}>
          <Scissors /> Split at playhead
        </Button>
        <Button size="sm" variant="outline" onClick={() => update((sp) => ({ ...sp, segments: [{ start: 0, end: round(sp.sourceDuration) }] }))}>
          <RotateCcw /> Reset cuts
        </Button>
      </div>

      <div className="divide-y rounded-md border">
        {spec.segments.map((seg, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="w-14 text-xs text-muted-foreground">Part {i + 1}</span>
            <Input type="number" step={0.1} className="h-8 w-24" value={seg.start} onChange={(e) => setSeg(i, "start", Number(e.target.value))} />
            <span className="text-muted-foreground">→</span>
            <Input type="number" step={0.1} className="h-8 w-24" value={seg.end} onChange={(e) => setSeg(i, "end", Number(e.target.value))} />
            <span className="text-xs tabular-nums text-muted-foreground">{(seg.end - seg.start).toFixed(1)}s</span>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              disabled={spec.segments.length === 1}
              title="Remove this part"
              onClick={() => update((sp) => ({ ...sp, segments: sp.segments.filter((_, j) => j !== i) }))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

function LayoutPanel({ spec, update }: PanelProps) {
  const L = spec.layout;
  const set = (patch: Partial<EditSpec["layout"]>) => update((s) => ({ ...s, layout: { ...s.layout, ...patch } }));
  const setCam = (patch: Partial<EditSpec["layout"]["cam"]>) => set({ cam: { ...L.cam, ...patch } });
  const MODES: { id: LayoutMode; label: string; hint: string }[] = [
    { id: "crop", label: "Crop to vertical", hint: "Fills the screen; pick which part of the frame to keep." },
    { id: "blur", label: "Fit + blurred background", hint: "Shows the whole frame with a blurred copy behind it." },
    { id: "split", label: "Facecam + gameplay", hint: "Streamer's camera on top, gameplay below." },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => set({ mode: m.id })}
            className={cn("rounded-lg border p-3 text-left text-sm", L.mode === m.id ? "border-violet-400 bg-violet-500/10" : "hover:bg-secondary")}
          >
            <div className="font-medium">{m.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.hint}</div>
          </button>
        ))}
      </div>
      {(L.mode === "crop" || L.mode === "split") && (
        <Slider label="Gameplay focus (left ↔ right)" value={L.cropX} min={0} max={1} step={0.01} onChange={(v) => set({ cropX: v })} format={(v) => `${Math.round(v * 100)}%`} />
      )}
      {L.mode === "split" && (
        <div className="space-y-3 rounded-md border p-3">
          <Hint>Move and size the box around the streamer&apos;s camera in the original video. Watch the preview while you adjust.</Hint>
          <Slider label="Camera box — left" value={L.cam.x} min={0} max={1 - L.cam.w} step={0.005} onChange={(v) => setCam({ x: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Camera box — top" value={L.cam.y} min={0} max={1 - L.cam.h} step={0.005} onChange={(v) => setCam({ y: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Camera box — width" value={L.cam.w} min={0.05} max={1 - L.cam.x} step={0.005} onChange={(v) => setCam({ w: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Camera box — height" value={L.cam.h} min={0.05} max={1 - L.cam.y} step={0.005} onChange={(v) => setCam({ h: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Camera panel size" value={L.camHeight} min={0.2} max={0.6} step={0.01} onChange={(v) => set({ camHeight: v })} format={(v) => `${Math.round(v * 100)}% of screen`} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// subtitles
// ---------------------------------------------------------------------------

function SubtitlesPanel({ spec, update, data }: PanelProps & { data: EditorData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const C = spec.captions;
  const set = (patch: Partial<EditSpec["captions"]>) => update((s) => ({ ...s, captions: { ...s.captions, ...patch } }));
  const status = data.transcriptStatus;

  const generate = () =>
    start(async () => {
      const res = await queueTranscriptionAction(data.clip.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Queued — the helper on your PC will transcribe it.");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={generate} disabled={pending || status === "queued" || status === "running"}>
          {status === "queued" || status === "running" ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {status === "queued" ? "Waiting for helper…" : status === "running" ? "Transcribing…" : status === "done" ? "Transcribe again" : "Generate subtitles"}
        </Button>
        {data.transcript?.length ? (
          <Button size="sm" variant="outline" onClick={() => set({ words: data.transcript! })} title="Replace your edited words with the transcript">
            <RotateCcw /> Reset to transcript
          </Button>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Checkbox checked={C.enabled} onCheckedChange={(v) => set({ enabled: v === true })} /> Show subtitles
        </label>
      </div>
      {status === "failed" && <p className="text-xs text-red-300">Transcription failed: {data.transcriptError}</p>}
      {status === "queued" && <Hint>Make sure <code>npm run worker</code> is running. The first time, it downloads the speech model (~500 MB).</Hint>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="Position (top ↔ bottom)" value={C.y} min={0.1} max={0.92} step={0.01} onChange={(v) => set({ y: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Size" value={C.size} min={40} max={130} step={2} onChange={(v) => set({ size: v })} />
        <div className="space-y-1">
          <Label>Words per line</Label>
          <Select value={C.wordsPerLine} onChange={(e) => set({ wordsPerLine: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-4">
          <div className="space-y-1">
            <Label>Highlight</Label>
            <input type="color" value={C.highlight} onChange={(e) => set({ highlight: e.target.value })} className="h-9 w-14 rounded border bg-transparent" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={C.uppercase} onCheckedChange={(v) => set({ uppercase: v === true })} /> UPPERCASE
          </label>
        </div>
      </div>

      {C.words.length > 0 ? (
        <div className="space-y-2">
          <Hint>Fix any word by clicking it. Words in parts you cut are skipped automatically.</Hint>
          <div className="flex max-h-72 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
            {C.words.map((w, i) => (
              <span key={i} className="group inline-flex items-center" title={`${fmt(w.startMs / 1000)}`}>
                <input
                  value={w.text}
                  onChange={(e) => set({ words: C.words.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                  className="rounded bg-secondary px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-violet-400"
                  style={{ width: `${Math.max(2, w.text.length + 1)}ch` }}
                />
                <button
                  type="button"
                  className="hidden px-0.5 text-xs text-muted-foreground hover:text-red-300 group-hover:inline"
                  onClick={() => set({ words: C.words.filter((_, j) => j !== i) })}
                  aria-label="Delete word"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        status !== "queued" && status !== "running" && <Hint>No subtitles yet. Click Generate subtitles.</Hint>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------

function AudioPanel({ spec, update, data, outT }: PanelProps & { data: EditorData; outT: number }) {
  const router = useRouter();
  const A = spec.audio;
  const music = data.audio.filter((a) => a.kind === "music");
  const sfx = data.audio.filter((a) => a.kind === "sfx");
  const [sfxPick, setSfxPick] = useState(sfx[0]?.id ?? "");
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<"music" | "sfx">("music");
  const fileRef = useRef<HTMLInputElement>(null);
  const setAudio = (patch: Partial<EditSpec["audio"]>) => update((s) => ({ ...s, audio: { ...s.audio, ...patch } }));

  async function upload(file: File) {
    if (file.size > 50 * 1024 * 1024) return toast.error("Max 50 MB per file.");
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${data.workspaceId}/audio/${crypto.randomUUID()}-${safe}`;
      const { error } = await createSupabaseBrowserClient().storage.from("media").upload(path, file, { contentType: file.type || "audio/mpeg" });
      if (error) throw new Error(error.message);
      const res = await registerAudioAssetAction({ kind, name: file.name.replace(/\.[^.]+$/, ""), storagePath: path });
      if (!res.ok) throw new Error(res.error);
      toast.success(`Added "${file.name}" to your ${kind === "music" ? "music" : "sound effects"}`);
      router.refresh();
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Clip audio</h3>
        <Slider label="Volume" value={A.sourceVolume} min={0} max={2} step={0.05} onChange={(v) => setAudio({ sourceVolume: v })} format={(v) => (v === 0 ? "muted" : `${Math.round(v * 100)}%`)} />
        <Hint>Background music in the stream gets Content ID claims even on edited clips. If you hear any, lower this or mute it and add your own music.</Hint>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Music</h3>
        <Select value={A.music.assetId ?? ""} onChange={(e) => setAudio({ music: { ...A.music, assetId: e.target.value || null } })}>
          <option value="">No music</option>
          {music.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        {A.music.assetId && (
          <>
            <Slider label="Music volume" value={A.music.volume} min={0} max={1} step={0.05} onChange={(v) => setAudio({ music: { ...A.music, volume: v } })} format={(v) => `${Math.round(v * 100)}%`} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={A.music.duck} onCheckedChange={(v) => setAudio({ music: { ...A.music, duck: v === true } })} /> Lower music while people talk (uses subtitles)
            </label>
          </>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Sound effects</h3>
        <div className="flex gap-2">
          <Select value={sfxPick} onChange={(e) => setSfxPick(e.target.value)} disabled={sfx.length === 0}>
            {sfx.length === 0 && <option value="">Upload sound effects below</option>}
            {sfx.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!sfxPick}
            onClick={() => setAudio({ sfx: [...A.sfx, { id: crypto.randomUUID(), assetId: sfxPick, at: round(outT), volume: 1 }].sort((a, b) => a.at - b.at) })}
          >
            <Plus /> Add at {fmt(outT)}
          </Button>
        </div>
        {A.sfx.length > 0 && (
          <div className="divide-y rounded-md border">
            {A.sfx.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{data.audio.find((a) => a.id === s.assetId)?.name ?? "missing file"}</span>
                <Label>at</Label>
                <Input
                  type="number"
                  step={0.1}
                  className="h-8 w-20"
                  value={s.at}
                  onChange={(e) => setAudio({ sfx: A.sfx.map((x) => (x.id === s.id ? { ...x, at: Math.max(0, Number(e.target.value)) } : x)) })}
                />
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={s.volume}
                  title="Volume"
                  className="w-24 accent-violet-500"
                  onChange={(e) => setAudio({ sfx: A.sfx.map((x) => (x.id === s.id ? { ...x, volume: Number(e.target.value) } : x)) })}
                />
                <Button size="icon-sm" variant="ghost" onClick={() => setAudio({ sfx: A.sfx.filter((x) => x.id !== s.id) })} aria-label="Remove">
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Your library</h3>
        <Hint>Only upload audio you&apos;re allowed to use, e.g. from YouTube Studio → Audio Library. Max 50 MB per file.</Hint>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "music" | "sfx")} className="w-40">
            <option value="music">Music</option>
            <option value="sfx">Sound effect</option>
          </Select>
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload audio
          </Button>
        </div>
        {data.audio.length > 0 && (
          <ul className="space-y-1 text-sm">
            {data.audio.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <Badge variant="outline">{a.kind === "music" ? "Music" : "SFX"}</Badge>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete from library"
                  onClick={async () => {
                    const res = await deleteAudioAssetAction(a.id);
                    if (!res.ok) toast.error(res.error);
                    else router.refresh();
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// text overlays
// ---------------------------------------------------------------------------

function TextPanel({ spec, update }: PanelProps) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Hook (top of screen, first seconds)</h3>
        <Input
          value={spec.hook.text}
          maxLength={200}
          placeholder="e.g. He did NOT see that coming 💀"
          onChange={(e) => update((s) => ({ ...s, hook: { ...s.hook, text: e.target.value } }))}
        />
        <Slider label="Show for" value={spec.hook.seconds} min={1} max={10} step={0.5} onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, seconds: v } }))} format={(v) => `${v}s`} />
      </section>
      <section className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={spec.credit.enabled} onCheckedChange={(v) => update((s) => ({ ...s, credit: { ...s.credit, enabled: v === true } }))} />
          Streamer credit (bottom of screen)
        </label>
        <Input value={spec.credit.text} maxLength={120} onChange={(e) => update((s) => ({ ...s, credit: { ...s.credit, text: e.target.value } }))} />
        <Hint>Crediting the streamer on screen is courteous and most clipping programs require it.</Hint>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// render + YouTube metadata
// ---------------------------------------------------------------------------

function PublishPanel({ spec, data }: { spec: EditSpec; data: EditorData }) {
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
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Render</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={render} disabled={rendering || status === "queued" || status === "running"}>
            {status === "queued" || status === "running" ? <Loader2 className="animate-spin" /> : <Clapperboard />}
            {status === "queued" ? "Waiting for helper…" : status === "running" ? `Rendering ${Math.round((data.renderProgress ?? 0) * 100)}%` : status === "done" ? "Render again" : "Render Short"}
          </Button>
          <span className="text-xs text-muted-foreground">1080×1920 · {fmt(total)}</span>
        </div>
        {status === "failed" && <p className="text-xs text-red-300">Render failed: {data.renderError}</p>}
        {status === "queued" && <Hint>Make sure <code>npm run worker</code> is running. The first render downloads a rendering browser (~100 MB).</Hint>}
        {status === "done" && data.outputPath && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <span className="min-w-0 flex-1 truncate" title={data.outputPath}>
              Rendered{data.outputSize ? ` (${(data.outputSize / 1_048_576).toFixed(1)} MB)` : ""}: {data.outputPath}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy path"
              onClick={() => navigator.clipboard.writeText(data.outputPath!).then(() => toast.success("Path copied"))}
            >
              <Copy />
            </Button>
          </div>
        )}
        <Hint>Edits made after rendering need a new render. Direct upload to YouTube comes next; until then, upload the file in YouTube Studio.</Hint>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">YouTube title, description & hashtags</h3>
          <Button size="sm" variant="outline" onClick={write} disabled={writing || !data.hasClaudeKey} title={data.hasClaudeKey ? undefined : "Add ANTHROPIC_API_KEY in Vercel first"}>
            {writing ? <Loader2 className="animate-spin" /> : <Sparkles />} Write with Claude
          </Button>
        </div>
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
      </section>
    </div>
  );
}
