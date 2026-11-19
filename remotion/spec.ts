/**
 * The edit spec: everything the editor changes, saved as JSON in
 * clip_edits.spec. The same spec drives the browser preview (Remotion Player)
 * and the final render on the user's PC, so they always match.
 *
 * Time conventions:
 *   - segments and caption words use SOURCE time (seconds / ms in the original clip)
 *   - sound effects use OUTPUT time (seconds in the finished Short)
 *
 * Relative imports only — this folder is bundled by Remotion's webpack too.
 */

export const FPS = 30;
export const OUT_W = 1080;
export const OUT_H = 1920;

export interface Segment {
  start: number;
  end: number;
}

export interface Word {
  text: string;
  startMs: number;
  endMs: number;
}

export type LayoutMode = "crop" | "blur" | "split";

export interface EditSpec {
  version: 1;
  sourceDuration: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Kept parts of the source, in playback order. */
  segments: Segment[];
  layout: {
    mode: LayoutMode;
    /** Horizontal focus for crop/split gameplay, 0 = left edge, 1 = right edge. */
    cropX: number;
    /** Facecam rectangle in the source, normalised 0–1 (split mode). */
    cam: { x: number; y: number; w: number; h: number };
    /** Share of the output height used by the facecam panel (split mode). */
    camHeight: number;
  };
  captions: {
    enabled: boolean;
    words: Word[];
    /** Vertical centre of the caption line, 0 = top, 1 = bottom. */
    y: number;
    size: number;
    highlight: string;
    wordsPerLine: number;
    uppercase: boolean;
  };
  hook: { text: string; seconds: number };
  credit: { enabled: boolean; text: string };
  audio: {
    sourceVolume: number;
    music: { assetId: string | null; volume: number; duck: boolean };
    sfx: { id: string; assetId: string; at: number; volume: number }[];
  };
}

export interface ShortProps {
  spec: EditSpec;
  videoSrc: string;
  /** asset id -> playable URL (signed Storage URL) */
  audioUrls: Record<string, string>;
  [key: string]: unknown;
}

export function defaultSpec(opts: {
  duration: number;
  width: number;
  height: number;
  creatorName?: string | null;
  creatorUrl?: string | null;
}): EditSpec {
  const handle = opts.creatorUrl?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return {
    version: 1,
    sourceDuration: opts.duration,
    sourceWidth: opts.width,
    sourceHeight: opts.height,
    segments: [{ start: 0, end: round(opts.duration) }],
    layout: { mode: "crop", cropX: 0.5, cam: { x: 0.7, y: 0.05, w: 0.28, h: 0.3 }, camHeight: 0.38 },
    captions: { enabled: true, words: [], y: 0.68, size: 78, highlight: "#FFE600", wordsPerLine: 3, uppercase: true },
    hook: { text: "", seconds: 3 },
    credit: { enabled: Boolean(opts.creatorName), text: opts.creatorName ? `🎮 ${handle ?? opts.creatorName}` : "" },
    audio: { sourceVolume: 1, music: { assetId: null, volume: 0.25, duck: true }, sfx: [] },
  };
}

export const round = (n: number, step = 0.01) => Math.round(n / step) * step;

export function outputDuration(spec: EditSpec): number {
  return spec.segments.reduce((s, seg) => s + Math.max(0, seg.end - seg.start), 0);
}

export function durationInFrames(spec: EditSpec): number {
  return Math.max(1, Math.round(outputDuration(spec) * FPS));
}

/** Where each kept segment starts in the output (seconds). */
export function segmentOffsets(spec: EditSpec): number[] {
  const out: number[] = [];
  let t = 0;
  for (const seg of spec.segments) {
    out.push(t);
    t += Math.max(0, seg.end - seg.start);
  }
  return out;
}

/** Output time -> source time (null past the end). */
export function outputToSource(spec: EditSpec, t: number): { source: number; index: number } | null {
  const offsets = segmentOffsets(spec);
  for (let i = 0; i < spec.segments.length; i++) {
    const seg = spec.segments[i];
    const len = seg.end - seg.start;
    if (t >= offsets[i] && t < offsets[i] + len) return { source: seg.start + (t - offsets[i]), index: i };
  }
  return null;
}

/** Source time -> output time (null if that moment was cut). */
export function sourceToOutput(spec: EditSpec, s: number): number | null {
  const offsets = segmentOffsets(spec);
  for (let i = 0; i < spec.segments.length; i++) {
    const seg = spec.segments[i];
    if (s >= seg.start && s < seg.end) return offsets[i] + (s - seg.start);
  }
  return null;
}

export interface CaptionPage {
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
}

/** Caption words placed on the output timeline and grouped into short lines. */
export function captionPages(spec: EditSpec): CaptionPage[] {
  const words = spec.captions.words
    .map((w) => {
      const start = sourceToOutput(spec, w.startMs / 1000);
      if (start == null) return null;
      const end = sourceToOutput(spec, Math.max(w.startMs, w.endMs - 1) / 1000) ?? start + (w.endMs - w.startMs) / 1000;
      return { text: spec.captions.uppercase ? w.text.toUpperCase() : w.text, start, end: Math.max(end, start + 0.05) };
    })
    .filter((w): w is { text: string; start: number; end: number } => Boolean(w && w.text.trim()))
    .sort((a, b) => a.start - b.start);

  const pages: CaptionPage[] = [];
  let cur: CaptionPage | null = null;
  for (const w of words) {
    const gap = cur ? w.start - cur.end : 0;
    if (!cur || cur.words.length >= Math.max(1, spec.captions.wordsPerLine) || gap > 0.6) {
      if (cur) pages.push(cur);
      cur = { start: w.start, end: w.end, words: [w] };
    } else {
      cur.words.push(w);
      cur.end = w.end;
    }
  }
  if (cur) pages.push(cur);
  // keep each line on screen until the next one starts (max +0.5s)
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1]?.start ?? Infinity;
    pages[i].end = Math.min(next, pages[i].end + 0.5);
  }
  return pages;
}

/** Is someone talking at output time t? Used to duck the music. */
export function speechAt(pages: CaptionPage[], t: number): boolean {
  return pages.some((p) => p.words.some((w) => t >= w.start - 0.1 && t <= w.end + 0.15));
}
