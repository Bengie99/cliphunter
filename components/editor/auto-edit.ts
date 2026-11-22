/**
 * Automatic edits computed in the browser from the helper's analysis
 * (audio envelope, scene changes) and the subtitles. Pure functions — every
 * result goes through the editor's normal undo history.
 */
import { isFiller } from "@/remotion/words";
import { round, sourceToOutput, type Analysis, type EditSpec, type Punch, type Segment, type Word } from "@/remotion/spec";

export type Range = [number, number];

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return -90;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

/** A sensible silence threshold (dBFS) for this clip: a bit above its noise floor. */
export function suggestThreshold(a: Analysis): number {
  const floor = percentile(a.env, 0.1);
  const loud = percentile(a.env, 0.9);
  return Math.round(Math.max(-60, Math.min(-18, floor + (loud - floor) * 0.3)));
}

/** Quiet stretches by audio level (source seconds), shrunk by `pad` on both sides. */
export function audioSilences(a: Analysis, opts: { threshold: number; minSilence: number; pad: number }): Range[] {
  const out: Range[] = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart < 0) return;
    const s = runStart * a.step;
    const e = end * a.step;
    if (e - s >= opts.minSilence) out.push([s + opts.pad, e - opts.pad]);
    runStart = -1;
  };
  a.env.forEach((db, i) => {
    if (db < opts.threshold) {
      if (runStart < 0) runStart = i;
    } else flush(i);
  });
  flush(a.env.length);
  return out.filter(([s, e]) => e - s > 0.05);
}

/** Gaps between spoken words (source seconds), incl. before the first and after the last word. */
export function speechGaps(words: Word[], duration: number, opts: { minSilence: number; pad: number }): Range[] {
  const ws = [...words].sort((a, b) => a.startMs - b.startMs);
  if (!ws.length) return [];
  const out: Range[] = [];
  const add = (s: number, e: number) => {
    if (e - s >= opts.minSilence) out.push([s + opts.pad, e - opts.pad]);
  };
  add(0 - opts.pad, ws[0].startMs / 1000); // leading: no pad at the very start
  for (let i = 1; i < ws.length; i++) add(ws[i - 1].endMs / 1000, ws[i].startMs / 1000);
  add(ws[ws.length - 1].endMs / 1000, duration + opts.pad);
  return out.filter(([s, e]) => e - s > 0.05);
}

/** Filler words ("um", "uh"…) as source ranges. */
export function fillerRanges(words: Word[], includeSoft: boolean): Range[] {
  return words.filter((w) => isFiller(w.text, includeSoft)).map((w) => [Math.max(0, w.startMs / 1000 - 0.03), w.endMs / 1000 + 0.03] as Range);
}

/** Removes ranges from the kept segments; drops leftovers shorter than minLen. */
export function subtractRanges(segments: Segment[], cuts: Range[], minLen = 0.15): Segment[] {
  const sorted = [...cuts].sort((a, b) => a[0] - b[0]);
  const out: Segment[] = [];
  for (const seg of segments) {
    let pieces: Segment[] = [{ ...seg }];
    for (const [cs, ce] of sorted) {
      if (ce <= seg.start || cs >= seg.end) continue;
      pieces = pieces.flatMap((p) => {
        if (ce <= p.start || cs >= p.end) return [p];
        const res: Segment[] = [];
        if (cs > p.start) res.push({ start: p.start, end: cs });
        if (ce < p.end) res.push({ start: ce, end: p.end });
        return res;
      });
    }
    out.push(...pieces.filter((p) => p.end - p.start >= minLen).map((p) => ({ start: round(p.start), end: round(p.end) })));
  }
  return out.length ? out : segments;
}

export function totalLength(ranges: Range[], segments: Segment[]): number {
  // how much of the currently kept footage these cuts would remove
  let sum = 0;
  for (const [cs, ce] of ranges) for (const s of segments) sum += Math.max(0, Math.min(ce, s.end) - Math.max(cs, s.start));
  return sum;
}

/** Zoom punch-ins on the loudest moments that are still in the edit. */
export function autoPunches(a: Analysis, spec: EditSpec, opts: { scale: number; every: number }): Punch[] {
  const win = 5;
  const smooth = a.env.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(a.env.length - 1, i + win); j++) (s += a.env[j]), n++;
    return s / n;
  });
  const kept = smooth.map((v, i) => ({ v, t: i * a.step })).filter((p) => sourceToOutput(spec, p.t) != null);
  if (!kept.length) return [];
  const thr = Math.max(percentile(kept.map((k) => k.v), 0.9), percentile(kept.map((k) => k.v), 0.5) + 6);
  const peaks = kept.filter((p, i) => p.v >= thr && (i === 0 || p.v >= kept[i - 1].v) && (i === kept.length - 1 || p.v >= kept[i + 1].v));
  peaks.sort((x, y) => y.v - x.v);
  const outLen = spec.segments.reduce((s, g) => s + g.end - g.start, 0);
  const max = Math.max(1, Math.round(outLen / opts.every));
  const chosen: number[] = [];
  for (const p of peaks) {
    if (chosen.length >= max) break;
    if (chosen.every((c) => Math.abs(c - p.t) >= opts.every * 0.6)) chosen.push(p.t);
  }
  return chosen.sort((x, y) => x - y).map((t) => ({ id: crypto.randomUUID(), t: round(Math.max(0, t - 0.15)), dur: 0.9, scale: opts.scale }));
}

/** Marks the loudest / exclaimed words as emphasised (bigger, emphasis colour). */
export function autoEmphasis(words: Word[], a: Analysis | null, share = 0.12): Word[] {
  const level = (w: Word) => {
    if (!a) return -90;
    const i0 = Math.floor(w.startMs / 1000 / a.step);
    const i1 = Math.max(i0 + 1, Math.ceil(w.endMs / 1000 / a.step));
    const xs = a.env.slice(i0, i1);
    return xs.length ? Math.max(...xs) : -90;
  };
  const scored = words.map((w, i) => ({ i, v: level(w), long: w.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 }));
  const cutoff = percentile(scored.filter((s) => s.long).map((s) => s.v), 1 - share);
  return words.map((w, i) => {
    const s = scored[i];
    const shout = /!$/.test(w.text) || (w.text.length >= 3 && w.text === w.text.toUpperCase() && /[A-Z]/.test(w.text));
    return { ...w, emph: Boolean(s.long && ((a && s.v >= cutoff && s.v > -40) || shout)) };
  });
}
