"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, Trash2, Upload, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { deleteAudioAssetAction, registerAudioAssetAction } from "@/app/editor-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { outputToSource, round, sourceToOutput, type EditSpec, type Overlay } from "@/remotion/spec";
import { fmt, type AssetKind, type EditorData, type PanelProps } from "./editor-types";
import { Hint, Section, Segmented, Slider, Toggle } from "./editor-ui";

const KIND_LABEL: Record<AssetKind, string> = { music: "Music", sfx: "Sound effect", image: "Image", video: "Video clip" };

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------

export function AudioPanel({ spec, update, data, outT }: PanelProps) {
  const A = spec.audio;
  const music = data.assets.filter((a) => a.kind === "music");
  const sfx = data.assets.filter((a) => a.kind === "sfx");
  const [sfxPick, setSfxPick] = useState(sfx[0]?.id ?? "");
  const setAudio = (patch: Partial<EditSpec["audio"]>, merge?: string) => update((s) => ({ ...s, audio: { ...s.audio, ...patch } }), merge ? { merge } : undefined);
  const lufs = data.analysis?.lufs;

  return (
    <div className="space-y-6">
      <Section title="Clip audio">
        <Slider label="Volume" value={A.sourceVolume} min={0} max={2} step={0.05} onChange={(v) => setAudio({ sourceVolume: v }, "srcvol")} format={(v) => (v === 0 ? "muted" : `${Math.round(v * 100)}%`)} />
        <div className="space-y-2">
          <Toggle checked={A.normalize} onChange={(v) => setAudio({ normalize: v })}>
            Normalize loudness to YouTube&apos;s level (-14 LUFS)
          </Toggle>
          <Toggle checked={A.denoise} onChange={(v) => setAudio({ denoise: v })}>
            Reduce background noise (hiss, hum, fans)
          </Toggle>
        </div>
        <Hint>
          Both are applied in the final render, not the preview.{lufs != null ? ` This clip measures ${lufs.toFixed(1)} LUFS${lufs < -20 ? " — quiet; normalizing will help a lot" : ""}.` : ""} Music in
          the stream can get Content ID claims even on edited clips; if you hear any, lower the clip volume and add your own music.
        </Hint>
      </Section>

      <Section title="Music">
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
            <Slider label="Music volume" value={A.music.volume} min={0} max={1} step={0.05} onChange={(v) => setAudio({ music: { ...A.music, volume: v } }, "musicvol")} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle checked={A.music.duck} onChange={(v) => setAudio({ music: { ...A.music, duck: v } })}>
              Lower the music smoothly while people talk (uses subtitles)
            </Toggle>
          </>
        )}
      </Section>

      <Section title="Sound effects">
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
                <span className="min-w-0 flex-1 truncate">{data.assets.find((a) => a.id === s.assetId)?.name ?? "missing file"}</span>
                <Label>at</Label>
                <Input
                  type="number"
                  step={0.1}
                  className="h-8 w-20"
                  value={s.at}
                  onChange={(e) => setAudio({ sfx: A.sfx.map((x) => (x.id === s.id ? { ...x, at: Math.max(0, Number(e.target.value)) } : x)) }, `sfxat-${s.id}`)}
                />
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={s.volume}
                  title="Volume"
                  className="w-24 accent-violet-500"
                  onChange={(e) => setAudio({ sfx: A.sfx.map((x) => (x.id === s.id ? { ...x, volume: Number(e.target.value) } : x)) }, `sfxvol-${s.id}`)}
                />
                <Button size="icon-sm" variant="ghost" onClick={() => setAudio({ sfx: A.sfx.filter((x) => x.id !== s.id) })} aria-label="Remove">
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Library data={data} kinds={["music", "sfx"]} hint="Only upload audio you're allowed to use, e.g. YouTube Studio → Audio Library (free). Max 50 MB per file." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// visuals: zoom, transitions, overlays, hook, credit
// ---------------------------------------------------------------------------

export function VisualsPanel({ spec, update, data, outT, seekOutput }: PanelProps) {
  const Z = spec.zoom;
  const setZoom = (patch: Partial<EditSpec["zoom"]>, merge?: string) => update((s) => ({ ...s, zoom: { ...s.zoom, ...patch } }), merge ? { merge } : undefined);
  const media = data.assets.filter((a) => a.kind === "image" || a.kind === "video");
  const [pick, setPick] = useState(media[0]?.id ?? "");
  const at = outputToSource(spec, outT);

  const setOverlay = (id: string, patch: Partial<Overlay>, merge?: string) =>
    update((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), merge ? { merge: `ov-${id}-${merge}` } : undefined);

  return (
    <div className="space-y-6">
      <Section title="Zoom & motion">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!at}
            onClick={() =>
              at && setZoom({ punches: [...Z.punches, { id: crypto.randomUUID(), t: round(at.source), dur: 0.9, scale: 1.15 }].sort((a, b) => a.t - b.t) })
            }
          >
            <ZoomIn /> Zoom at {fmt(outT)} <kbd className="ml-1 rounded border px-1 font-mono text-[10px]">Z</kbd>
          </Button>
          <Toggle checked={Z.slow} onChange={(v) => setZoom({ slow: v })}>
            Slow push-in over the whole Short
          </Toggle>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-xs">Between cuts</Label>
          <Segmented
            value={Z.transition}
            onChange={(v) => setZoom({ transition: v })}
            options={[
              { id: "none", label: "Hard cut" },
              { id: "punch", label: "Zoom punch" },
              { id: "flash", label: "Flash" },
            ]}
          />
        </div>
        {Z.punches.length > 0 && (
          <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
            {Z.punches.map((p) => {
              const out = sourceToOutput(spec, p.t);
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-sm">
                  <button type="button" className="w-14 text-left tabular-nums text-xs text-muted-foreground hover:text-foreground" disabled={out == null} onClick={() => out != null && seekOutput(Math.max(0, out - 0.3))}>
                    {out == null ? "cut" : fmt(out)}
                  </button>
                  <div className="flex min-w-[140px] flex-1 items-center gap-2 text-xs">
                    <span className="text-muted-foreground">strength</span>
                    <input
                      type="range"
                      min={1.05}
                      max={1.5}
                      step={0.01}
                      value={p.scale}
                      className="flex-1 accent-violet-500"
                      onChange={(e) => setZoom({ punches: Z.punches.map((x) => (x.id === p.id ? { ...x, scale: Number(e.target.value) } : x)) }, `ps-${p.id}`)}
                    />
                  </div>
                  <div className="flex min-w-[140px] flex-1 items-center gap-2 text-xs">
                    <span className="text-muted-foreground">length</span>
                    <input
                      type="range"
                      min={0.3}
                      max={4}
                      step={0.1}
                      value={p.dur}
                      className="flex-1 accent-violet-500"
                      onChange={(e) => setZoom({ punches: Z.punches.map((x) => (x.id === p.id ? { ...x, dur: Number(e.target.value) } : x)) }, `pd-${p.id}`)}
                    />
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove zoom" onClick={() => setZoom({ punches: Z.punches.filter((x) => x.id !== p.id) })}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Overlays (images, memes, B-roll)">
        <div className="flex gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!media.length}>
            {!media.length && <option value="">Upload images or video clips below</option>}
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.kind === "video" ? "🎞 " : "🖼 "}
                {m.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!pick}
            onClick={() => {
              const asset = media.find((m) => m.id === pick);
              if (!asset) return;
              update((s) => ({
                ...s,
                overlays: [
                  ...s.overlays,
                  { id: crypto.randomUUID(), assetId: asset.id, kind: asset.kind === "video" ? "video" : "image", at: round(outT), dur: 2.5, x: 0.5, y: 0.3, w: 0.6, volume: 0 },
                ],
              }));
            }}
          >
            <ImagePlus /> Add at {fmt(outT)}
          </Button>
        </div>
        {spec.overlays.map((o) => (
          <div key={o.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{o.kind === "video" ? "Video" : "Image"}</Badge>
              <span className="min-w-0 flex-1 truncate">{data.assets.find((a) => a.id === o.assetId)?.name ?? "missing file"}</span>
              <Button size="sm" variant="ghost" onClick={() => seekOutput(o.at)}>
                {fmt(o.at)}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Remove overlay" onClick={() => update((s) => ({ ...s, overlays: s.overlays.filter((x) => x.id !== o.id) }))}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Slider label="Starts at" value={o.at} min={0} max={Math.max(1, spec.segments.reduce((s, g) => s + g.end - g.start, 0))} step={0.1} onChange={(v) => setOverlay(o.id, { at: v }, "at")} format={fmt} />
              <Slider label="Shows for" value={o.dur} min={0.3} max={15} step={0.1} onChange={(v) => setOverlay(o.id, { dur: v }, "dur")} format={(v) => `${v.toFixed(1)}s`} />
              <Slider label="Size" value={o.w} min={0.1} max={1.2} step={0.01} onChange={(v) => setOverlay(o.id, { w: v }, "w")} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Left ↔ right" value={o.x} min={0} max={1} step={0.01} onChange={(v) => setOverlay(o.id, { x: v }, "x")} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Top ↔ bottom" value={o.y} min={0} max={1} step={0.01} onChange={(v) => setOverlay(o.id, { y: v }, "y")} format={(v) => `${Math.round(v * 100)}%`} />
              {o.kind === "video" && <Slider label="Overlay volume" value={o.volume} min={0} max={1.5} step={0.05} onChange={(v) => setOverlay(o.id, { volume: v }, "vol")} format={(v) => (v ? `${Math.round(v * 100)}%` : "muted")} />}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Hook (top of screen, first seconds)">
        <Input
          value={spec.hook.text}
          maxLength={200}
          placeholder="e.g. He did NOT see that coming 💀"
          onChange={(e) => update((s) => ({ ...s, hook: { ...s.hook, text: e.target.value } }), { merge: "hook" })}
        />
        <Slider label="Show for" value={spec.hook.seconds} min={1} max={10} step={0.5} onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, seconds: v } }), { merge: "hooksec" })} format={(v) => `${v}s`} />
      </Section>

      <Section title={<Toggle checked={spec.credit.enabled} onChange={(v) => update((s) => ({ ...s, credit: { ...s.credit, enabled: v } }))}>Streamer credit</Toggle>}>
        <Input value={spec.credit.text} maxLength={120} onChange={(e) => update((s) => ({ ...s, credit: { ...s.credit, text: e.target.value } }), { merge: "credit" })} />
        <Hint>Crediting the streamer on screen is courteous and most clipping programs require it.</Hint>
      </Section>

      <Library data={data} kinds={["image", "video"]} hint="PNG, JPG, WebP or short MP4/WebM clips you're allowed to use (e.g. Pexels, Pixabay — free). GIFs: convert to MP4 first. Max 50 MB." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// library (uploads to Storage, shared by the team)
// ---------------------------------------------------------------------------

function Library({ data, kinds, hint }: { data: EditorData; kinds: AssetKind[]; hint: string }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<AssetKind>(kinds[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = data.assets.filter((a) => kinds.includes(a.kind));
  const accept = kind === "image" ? "image/png,image/jpeg,image/webp" : kind === "video" ? "video/mp4,video/webm" : "audio/*";

  async function upload(file: File) {
    if (file.size > 50 * 1024 * 1024) return toast.error("Max 50 MB per file.");
    if (file.type === "image/gif") return toast.error("GIFs don't animate in renders — convert it to MP4 first (e.g. ezgif.com/gif-to-mp4).");
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${data.workspaceId}/audio/${crypto.randomUUID()}-${safe}`;
      const { error } = await createSupabaseBrowserClient().storage.from("media").upload(path, file, { contentType: file.type || undefined });
      if (error) throw new Error(error.message);
      const res = await registerAudioAssetAction({ kind, name: file.name.replace(/\.[^.]+$/, ""), storagePath: path });
      if (!res.ok) throw new Error(res.error);
      toast.success(`Added "${file.name}"`);
      router.refresh();
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">Your library</h3>
      <Hint>{hint}</Hint>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} className="w-40">
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <Badge variant="outline">{KIND_LABEL[a.kind]}</Badge>
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
  );
}
