"use client";

import { RotateCcw, Scissors, SkipForward, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { outputToSource, round, sourceToOutput, type EditSpec, type LayoutMode } from "@/remotion/spec";
import { fmt, type PanelProps } from "./editor-types";
import { Hint, Section, Slider, Toggle } from "./editor-ui";

/** Splits the part under the playhead. Shared with the S shortcut. */
export function splitAt(spec: EditSpec, outT: number): EditSpec | string {
  const at = outputToSource(spec, outT);
  if (!at) return "Move the playhead onto the clip first.";
  const seg = spec.segments[at.index];
  const s = round(at.source);
  if (s - seg.start < 0.2 || seg.end - s < 0.2) return "Too close to the edge of a part to split here.";
  const segs = [...spec.segments];
  segs.splice(at.index, 1, { start: seg.start, end: s }, { start: s, end: seg.end });
  return { ...spec, segments: segs };
}

/** Removes the part under the playhead. Shared with the Delete shortcut. */
export function deleteAt(spec: EditSpec, outT: number): EditSpec | string {
  const at = outputToSource(spec, outT);
  if (!at) return "Move the playhead onto the clip first.";
  if (spec.segments.length === 1) return "Can't remove the only part.";
  return { ...spec, segments: spec.segments.filter((_, j) => j !== at.index) };
}

export function CutsPanel({ spec, update, data, outT, seekOutput }: PanelProps) {
  const scenes = data.analysis?.scenes ?? [];

  const apply = (r: EditSpec | string) => (typeof r === "string" ? toast.warning(r) : update(() => r));
  const setSeg = (i: number, key: "start" | "end", v: number) =>
    update(
      (sp) => {
        const segs = sp.segments.map((seg, j) => (j === i ? { ...seg, [key]: Math.min(Math.max(0, round(v)), sp.sourceDuration) } : seg));
        return segs[i].end - segs[i].start < 0.1 ? sp : { ...sp, segments: segs };
      },
      { merge: `seg-${i}-${key}` },
    );
  const nextScene = () => {
    const at = outputToSource(spec, outT);
    const next = scenes.find((s) => s > (at?.source ?? 0) + 0.05 && sourceToOutput(spec, s) != null);
    if (next == null) return toast.info("No more scene changes after the playhead.");
    seekOutput(sourceToOutput(spec, next)!);
  };

  return (
    <div className="space-y-5">
      <Hint>
        Play to a moment and press <Kbd>S</Kbd> (or Split) to cut there; <Kbd>Delete</Kbd> removes the part under the playhead. Click the timeline below
        to jump. The Auto tab can cut pauses for you.
      </Hint>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => apply(splitAt(spec, outT))}>
          <Scissors /> Split at playhead
        </Button>
        <Button size="sm" variant="outline" onClick={() => apply(deleteAt(spec, outT))}>
          <Trash2 /> Delete part at playhead
        </Button>
        <Button size="sm" variant="outline" onClick={nextScene} disabled={!scenes.length} title="Scene changes are found by the analysis">
          <SkipForward /> Next scene change
        </Button>
        <Button size="sm" variant="ghost" onClick={() => update((sp) => ({ ...sp, segments: [{ start: 0, end: round(sp.sourceDuration) }] }))}>
          <RotateCcw /> Reset cuts
        </Button>
      </div>

      <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
        {spec.segments.map((seg, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <button type="button" className="w-14 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => seekOutput(sourceToOutput(spec, seg.start) ?? 0)}>
              Part {i + 1}
            </button>
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
      <Hint>{spec.segments.length} part{spec.segments.length === 1 ? "" : "s"} · times are in the original clip (seconds)</Hint>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-secondary px-1 py-px font-mono text-[10px]">{children}</kbd>;
}

export function LayoutPanel({ spec, update }: PanelProps) {
  const L = spec.layout;
  const set = (patch: Partial<EditSpec["layout"]>, merge?: string) => update((s) => ({ ...s, layout: { ...s.layout, ...patch } }), merge ? { merge } : undefined);
  const setCam = (patch: Partial<EditSpec["layout"]["cam"]>, key: string) => set({ cam: { ...L.cam, ...patch } }, `cam-${key}`);
  const MODES: { id: LayoutMode; label: string; hint: string }[] = [
    { id: "crop", label: "Crop to vertical", hint: "Fills the screen; pick or follow the part of the frame to keep." },
    { id: "blur", label: "Fit + blurred background", hint: "Shows the whole frame with a blurred copy behind it." },
    { id: "split", label: "Facecam + gameplay", hint: "Streamer's camera on top, gameplay below." },
  ];
  return (
    <div className="space-y-5">
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
      {L.mode === "crop" && (
        <Section title="Framing">
          <Toggle checked={L.follow && L.track.length > 0} onChange={(v) => set({ follow: v })}>
            Follow the face {L.track.length ? `(${L.track.length} camera moves)` : "— run “Crop follows the face” in the Auto tab first"}
          </Toggle>
          {!(L.follow && L.track.length) && (
            <Slider label="Focus (left ↔ right)" value={L.cropX} min={0} max={1} step={0.01} onChange={(v) => set({ cropX: v }, "cropX")} format={(v) => `${Math.round(v * 100)}%`} />
          )}
        </Section>
      )}
      {L.mode === "split" && (
        <Section title="Facecam box">
          <Hint>“Find the facecam” in the Auto tab places this for you. Adjust while watching the preview.</Hint>
          <Slider label="Gameplay focus (left ↔ right)" value={L.cropX} min={0} max={1} step={0.01} onChange={(v) => set({ cropX: v }, "cropX")} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider label="Camera box — left" value={L.cam.x} min={0} max={1 - L.cam.w} step={0.005} onChange={(v) => setCam({ x: v }, "x")} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Camera box — top" value={L.cam.y} min={0} max={1 - L.cam.h} step={0.005} onChange={(v) => setCam({ y: v }, "y")} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Camera box — width" value={L.cam.w} min={0.05} max={1 - L.cam.x} step={0.005} onChange={(v) => setCam({ w: v }, "w")} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Camera box — height" value={L.cam.h} min={0.05} max={1 - L.cam.y} step={0.005} onChange={(v) => setCam({ h: v }, "h")} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
          <Slider label="Camera panel size" value={L.camHeight} min={0.2} max={0.6} step={0.01} onChange={(v) => set({ camHeight: v }, "camHeight")} format={(v) => `${Math.round(v * 100)}% of screen`} />
        </Section>
      )}
      {L.mode === "blur" && <Hint>Zoom punch-ins apply to the sharp video in the middle.</Hint>}
      <Hint>Source: {spec.sourceWidth}×{spec.sourceHeight} · {fmt(spec.sourceDuration)}</Hint>
    </div>
  );
}
