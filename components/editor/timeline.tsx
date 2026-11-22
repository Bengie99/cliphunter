"use client";

import { useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { outputToSource, wordCensored, type Analysis, type EditSpec } from "@/remotion/spec";
import { fmt } from "./editor-types";

/**
 * The whole original clip on one strip: waveform, kept parts (bright),
 * removed parts (dim), scene changes, zooms, censored words and the playhead.
 * Click anywhere to jump there.
 */
export function Timeline({
  spec,
  analysis,
  outT,
  onSeekSource,
}: {
  spec: EditSpec;
  analysis: Analysis | null;
  outT: number;
  onSeekSource: (s: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const D = spec.sourceDuration || 1;
  const pct = (s: number) => `${(s / D) * 100}%`;
  const at = outputToSource(spec, outT);

  const wave = useMemo(() => {
    if (!analysis?.env.length) return null;
    const n = Math.min(1600, analysis.env.length);
    const per = analysis.env.length / n;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      let m = -90;
      for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) m = Math.max(m, analysis.env[j]);
      const h = Math.max(0.02, Math.min(1, (m + 60) / 60));
      pts.push(`${(i / n) * 1000},${50 - h * 48}`);
    }
    const back = pts.map((p) => p.split(",")).reverse().map(([x, y]) => `${x},${100 - Number(y)}`);
    return `M0,50 L${pts.join(" L")} L1000,50 L${back.join(" L")} Z`;
  }, [analysis]);

  const removed = useMemo(() => {
    const out: [number, number][] = [];
    const segs = [...spec.segments].sort((a, b) => a.start - b.start);
    let cur = 0;
    for (const s of segs) {
      if (s.start > cur) out.push([cur, s.start]);
      cur = Math.max(cur, s.end);
    }
    if (cur < D) out.push([cur, D]);
    return out;
  }, [spec.segments, D]);

  const censored = useMemo(() => spec.captions.words.filter((w) => wordCensored(spec, w)), [spec]);
  const ticks = useMemo(() => {
    const every = D * (1 / zoom) > 120 ? 30 : D / zoom > 40 ? 10 : 5;
    return Array.from({ length: Math.floor(D / every) + 1 }, (_, i) => i * every);
  }, [D, zoom]);

  const click = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onSeekSource(Math.max(0, Math.min(D, ((e.clientX - r.left) / r.width) * D)));
  };

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Original clip · {fmt(D)} · bright = kept, dim = cut
          {analysis ? "" : " · waveform appears after analysis"}
        </span>
        <span className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))}>
            <ZoomOut />
          </Button>
          <span className="w-8 text-center tabular-nums">{zoom}×</span>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" disabled={zoom >= 16} onClick={() => setZoom((z) => Math.min(16, z * 2))}>
            <ZoomIn />
          </Button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <div ref={ref} className="relative h-24 cursor-pointer select-none" style={{ width: `${zoom * 100}%` }} onClick={click}>
          {/* time ruler */}
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 text-[10px] text-muted-foreground" style={{ left: pct(t) }}>
              <span className="absolute h-1.5 w-px bg-border" />
              <span className="ml-1">{fmt(t).replace(/\.\d$/, "")}</span>
            </span>
          ))}

          <div className="absolute inset-x-0 bottom-3 top-4 overflow-hidden rounded-md bg-secondary/60">
            {spec.segments.map((seg, i) => (
              <div key={i} className="absolute inset-y-0 bg-violet-500/25 ring-1 ring-inset ring-violet-400/50" style={{ left: pct(seg.start), width: pct(seg.end - seg.start) }} />
            ))}
            {wave && (
              <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-violet-200/80">
                <path d={wave} fill="currentColor" />
              </svg>
            )}
            {removed.map(([a, b], i) => (
              <div key={i} className="absolute inset-y-0 bg-background/70" style={{ left: pct(a), width: pct(b - a) }} />
            ))}
            {analysis?.scenes.map((s, i) => (
              <div key={i} className="absolute top-0 h-2 w-px bg-sky-300/80" style={{ left: pct(s) }} title={`Scene change ${fmt(s)}`} />
            ))}
            {censored.map((w, i) => (
              <div
                key={i}
                className="absolute bottom-0 h-1.5 rounded-sm bg-red-400"
                style={{ left: pct(w.startMs / 1000), width: pct(Math.max(0.05, (w.endMs - w.startMs) / 1000)) }}
                title={`Censored: ${w.text}`}
              />
            ))}
          </div>

          {spec.zoom.punches.map((p) => (
            <div key={p.id} className="absolute bottom-0 h-2 rounded-sm bg-amber-400" style={{ left: pct(p.t), width: pct(p.dur) }} title={`Zoom ${fmt(p.t)}`} />
          ))}
          {at && <div className="pointer-events-none absolute bottom-1 top-3 w-0.5 rounded bg-white shadow" style={{ left: pct(at.source) }} />}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <Legend className="bg-sky-300">scene change</Legend>
        <Legend className="bg-amber-400">zoom</Legend>
        <Legend className="bg-red-400">censored word</Legend>
      </div>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-1.5 w-3 rounded-sm ${className}`} />
      {children}
    </span>
  );
}
