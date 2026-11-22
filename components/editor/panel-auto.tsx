"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanFace, Scissors, Sparkles, Wand2, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { queueTranscriptionAction } from "@/app/editor-actions";
import { Button } from "@/components/ui/button";
import { OUT_H, OUT_W, outputDuration, type EditSpec } from "@/remotion/spec";
import { audioSilences, autoEmphasis, autoPunches, fillerRanges, speechGaps, subtractRanges, suggestThreshold, totalLength, type Range } from "./auto-edit";
import { fmt, type PanelProps } from "./editor-types";
import { Hint, Section, Segmented, Slider, Toggle } from "./editor-ui";
import { buildTrack, findFacecam, scanFaces, type FaceSample } from "./face-detect";

/** One place for every automatic edit. Each button is one undo step. */
export function AutoPanel({ spec, update, data }: PanelProps) {
  const a = data.analysis;
  const words = spec.captions.words;
  const status = data.transcriptStatus;
  const analyzing = status === "queued" || status === "running";

  return (
    <div className="space-y-6">
      {!a || !words.length ? <AnalyzeCard data={data} /> : null}
      {analyzing && <Hint>Analysis running on the helper — results appear here automatically.</Hint>}
      <OneClick spec={spec} update={update} data={data} />
      <SilencePanel spec={spec} update={update} data={data} />
      <ZoomAuto spec={spec} update={update} data={data} />
      <FacePanel spec={spec} update={update} data={data} />
    </div>
  );
}

type P = Pick<PanelProps, "spec" | "update" | "data">;

function AnalyzeCard({ data }: { data: PanelProps["data"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = data.transcriptStatus;
  const busy = status === "queued" || status === "running";
  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Analyze this clip</div>
          <Hint>Subtitles, loudness and scene changes, measured by the helper on your PC. Needed for most automatic edits.</Hint>
        </div>
        <Button
          size="sm"
          disabled={pending || busy}
          onClick={() =>
            start(async () => {
              const res = await queueTranscriptionAction(data.clip.id);
              if (!res.ok) return void toast.error(res.error);
              toast.success("Queued — the helper will analyze it.");
              router.refresh();
            })
          }
        >
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {status === "queued" ? "Waiting for helper…" : status === "running" ? "Analyzing…" : status === "failed" ? "Try again" : "Analyze"}
        </Button>
      </div>
      {status === "failed" && <p className="mt-2 text-xs text-red-300">Analysis failed: {data.transcriptError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// one click
// ---------------------------------------------------------------------------

function OneClick({ spec, update, data }: P) {
  const a = data.analysis;
  const words = spec.captions.words;
  const run = () => {
    let s: EditSpec = spec;
    const before = outputDuration(s);
    const cuts: Range[] = [];
    if (words.length) cuts.push(...speechGaps(words, s.sourceDuration, { minSilence: 0.6, pad: 0.12 }));
    else if (a) cuts.push(...audioSilences(a, { threshold: suggestThreshold(a), minSilence: 0.6, pad: 0.12 }));
    if (words.length) cuts.push(...fillerRanges(words, false));
    s = { ...s, segments: subtractRanges(s.segments, cuts) };
    if (a) s = { ...s, zoom: { ...s.zoom, punches: autoPunches(a, s, { scale: 1.15, every: 6 }) } };
    if (words.length) s = { ...s, captions: { ...s.captions, words: autoEmphasis(s.captions.words, a) } };
    update(() => s);
    toast.success(`Auto edit: removed ${(before - outputDuration(s)).toFixed(1)}s of dead air, ${s.zoom.punches.length} zooms, emphasis on key words.`);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary/40 p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">Auto edit</div>
        <Hint>Cuts silences and “um/uh”, adds zoom punch-ins on loud moments and emphasizes key words. Undo with Ctrl+Z.</Hint>
      </div>
      <Button onClick={run} disabled={!a && !words.length}>
        <Sparkles /> Auto edit
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// silences + fillers
// ---------------------------------------------------------------------------

function SilencePanel({ spec, update, data }: P) {
  const a = data.analysis;
  const words = spec.captions.words;
  const [mode, setMode] = useState<"speech" | "audio">(words.length ? "speech" : "audio");
  const [minSilence, setMinSilence] = useState(0.6);
  const [pad, setPad] = useState(0.12);
  const [threshold, setThreshold] = useState(() => (a ? suggestThreshold(a) : -40));
  const [soft, setSoft] = useState(false);

  const silences = useMemo<Range[]>(() => {
    if (mode === "speech") return words.length ? speechGaps(words, spec.sourceDuration, { minSilence, pad }) : [];
    return a ? audioSilences(a, { threshold, minSilence, pad }) : [];
  }, [mode, words, a, threshold, minSilence, pad, spec.sourceDuration]);
  const fillers = useMemo(() => fillerRanges(words, soft), [words, soft]);
  const silenceSec = totalLength(silences, spec.segments);
  const fillerSec = totalLength(fillers, spec.segments);

  return (
    <Section title="Remove dead air">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { id: "speech", label: "Gaps in speech" },
            { id: "audio", label: "Quiet audio" },
          ]}
        />
        <Hint className="flex-1">
          {mode === "speech"
            ? "Cuts pauses between spoken words (uses subtitles). Best for talking. For gameplay with no talking, use Quiet audio."
            : "Cuts parts where the whole audio is quiet. Keeps loud gameplay moments even when nobody talks."}
        </Hint>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="Shortest pause to cut" value={minSilence} min={0.25} max={2} step={0.05} onChange={setMinSilence} format={(v) => `${v.toFixed(2)}s`} />
        <Slider label="Breathing room kept" value={pad} min={0} max={0.4} step={0.02} onChange={setPad} format={(v) => `${v.toFixed(2)}s`} />
        {mode === "audio" && <Slider label="Quiet below" value={threshold} min={-70} max={-10} step={1} onChange={setThreshold} format={(v) => `${v} dB`} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!silences.length || silenceSec < 0.05}
          onClick={() => update((s) => ({ ...s, segments: subtractRanges(s.segments, silences) }))}
        >
          <Scissors /> Cut {silences.length} pause{silences.length === 1 ? "" : "s"} ({silenceSec.toFixed(1)}s)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!fillers.length || fillerSec < 0.05}
          onClick={() => update((s) => ({ ...s, segments: subtractRanges(s.segments, fillers, 0.1) }))}
        >
          <Scissors /> Cut {fillers.length} filler word{fillers.length === 1 ? "" : "s"}
        </Button>
        <Toggle checked={soft} onChange={setSoft} className="text-xs">
          also “like”, “basically”, “literally”
        </Toggle>
      </div>
      {!a && mode === "audio" && <Hint>Needs the clip analysis (above).</Hint>}
      {words.length > 0 && fillers.length === 0 && <Hint>No “um/uh” found. Speech recognition often leaves them out, so there may be none to cut.</Hint>}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// zoom + emphasis
// ---------------------------------------------------------------------------

function ZoomAuto({ spec, update, data }: P) {
  const a = data.analysis;
  const [every, setEvery] = useState(6);
  const [scale, setScale] = useState(1.15);
  return (
    <Section title="Zoom & emphasis">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="About one zoom every" value={every} min={2} max={15} step={1} onChange={setEvery} format={(v) => `${v}s`} />
        <Slider label="Zoom strength" value={scale} min={1.05} max={1.4} step={0.01} onChange={setScale} format={(v) => `${Math.round((v - 1) * 100)}%`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!a} onClick={() => update((s) => ({ ...s, zoom: { ...s.zoom, punches: autoPunches(a!, s, { scale, every }) } }))}>
          <ZoomIn /> Zoom on loud moments
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!spec.captions.words.length}
          onClick={() => update((s) => ({ ...s, captions: { ...s.captions, words: autoEmphasis(s.captions.words, a) } }))}
        >
          <Sparkles /> Emphasize key words
        </Button>
        {spec.zoom.punches.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => update((s) => ({ ...s, zoom: { ...s.zoom, punches: [] } }))}>
            Remove all zooms ({spec.zoom.punches.length})
          </Button>
        )}
      </div>
      <Hint>Zooms replace the current ones. Emphasized words show bigger in the emphasis colour (Captions tab).</Hint>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// faces
// ---------------------------------------------------------------------------

function FacePanel({ spec, update, data }: P) {
  const [progress, setProgress] = useState<number | null>(null);
  const [samples, setSamples] = useState<FaceSample[] | null>(null);
  const abort = useRef<AbortController | null>(null);

  const scan = async (): Promise<FaceSample[] | null> => {
    if (samples) return samples;
    abort.current = new AbortController();
    setProgress(0);
    try {
      const res = await scanFaces(data.proxyUrl, spec.sourceDuration, setProgress, abort.current.signal);
      setSamples(res);
      return res;
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(`Face detection failed: ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      setProgress(null);
    }
  };

  const follow = async () => {
    const s = await scan();
    if (!s) return;
    const track = buildTrack(s);
    if (!track.length) return void toast.warning("No face found in this clip.");
    update((sp) => ({ ...sp, layout: { ...sp.layout, mode: "crop", follow: true, track } }));
    toast.success(`Crop now follows the face (${track.length} camera moves).`);
  };

  const facecam = async () => {
    const s = await scan();
    if (!s) return;
    const camH = spec.layout.camHeight;
    const cam = findFacecam(s, { w: spec.sourceWidth, h: spec.sourceHeight }, OUT_W / (OUT_H * camH));
    if (!cam) return void toast.warning("No facecam found — a face has to stay in the same spot for most of the clip.");
    update((sp) => ({ ...sp, layout: { ...sp.layout, mode: "split", cam } }));
    toast.success("Facecam found — switched to Facecam + gameplay. Fine-tune it in the Layout tab.");
  };

  const found = samples ? samples.filter((x) => x.faces.length).length : 0;
  return (
    <Section title="Faces">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={follow} disabled={progress != null}>
          <ScanFace /> Crop follows the face
        </Button>
        <Button size="sm" variant="outline" onClick={facecam} disabled={progress != null}>
          <ScanFace /> Find the facecam
        </Button>
        {spec.layout.follow && (
          <Button size="sm" variant="ghost" onClick={() => update((s) => ({ ...s, layout: { ...s.layout, follow: false } }))}>
            Stop following
          </Button>
        )}
      </div>
      {progress != null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Looking for faces… {Math.round(progress * 100)}%
          <button type="button" className="underline" onClick={() => abort.current?.abort()}>
            cancel
          </button>
        </div>
      )}
      {samples && <Hint>Faces seen in {found} of {samples.length} moments checked ({fmt(spec.sourceDuration)} clip).</Hint>}
      <Hint>Runs in your browser on the preview copy (Google MediaPipe). Nothing is uploaded.</Hint>
    </Section>
  );
}
