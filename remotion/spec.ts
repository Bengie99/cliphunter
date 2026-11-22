/**
 * The edit spec: everything the editor changes, saved as JSON in
 * clip_edits.spec. The same spec drives the browser preview (Remotion Player)
 * and the final render on the user's PC, so they always match.
 *
 * Time conventions:
 *   - segments, caption words, zoom punches and the face track use SOURCE time
 *     (seconds / ms in the original clip), so they survive re-cutting
 *   - sound effects, overlays and the cover frame use OUTPUT time (seconds in
 *     the finished Short)
 *
 * Relative imports only — this folder is bundled by Remotion's webpack too.
 */
import { emojiFor, isSwear } from "./words";

export const FPS = 30;
export const OUT_W = 1080;
export const OUT_H = 1920;
export const SPEC_VERSION = 2;

export interface Segment {
  start: number;
  end: number;
}

export interface Word {
  text: string;
  startMs: number;
  endMs: number;
  /** Shown bigger / in the emphasis colour. */
  emph?: boolean;
  /** Emoji shown above the line while this word is spoken ("" = none, undefined = automatic). */
  emoji?: string;
  /** Censor: undefined = automatic (swear list), true = always, false = never. */
  censor?: boolean;
}

export type LayoutMode = "crop" | "blur" | "split";
export type CaptionStyleId = "pop" | "box" | "karaoke" | "single" | "minimal" | "neon";
export type FontId = "montserrat" | "anton" | "bebas" | "poppins" | "bangers" | "luckiest" | "titan" | "inter";
export type Transition = "none" | "punch" | "flash";

export interface Punch {
  id: string;
  /** Source time (s) the zoom starts. */
  t: number;
  dur: number;
  scale: number;
}

export interface TrackPoint {
  /** Source time (s). */
  t: number;
  /** Face centre in the source frame, 0–1. */
  x: number;
  y: number;
}

export interface Overlay {
  id: string;
  assetId: string;
  kind: "image" | "video";
  /** Output time (s). */
  at: number;
  dur: number;
  /** Centre position, 0–1 of the output frame. */
  x: number;
  y: number;
  /** Width as a share of the output width. */
  w: number;
  volume: number;
}

export interface EditSpec {
  version: 2;
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
    /** Follow the face (crop mode) using `track` instead of the fixed cropX. */
    follow: boolean;
    track: TrackPoint[];
  };
  captions: {
    enabled: boolean;
    words: Word[];
    /** Vertical centre of the caption line, 0 = top, 1 = bottom. */
    y: number;
    size: number;
    style: CaptionStyleId;
    font: FontId;
    color: string;
    highlight: string;
    wordsPerLine: number;
    uppercase: boolean;
    autoEmoji: boolean;
    emphColor: string;
  };
  censor: {
    enabled: boolean;
    audio: "mute" | "bleep";
    emoji: string;
    /** Extra words to censor (lowercase). */
    extra: string[];
  };
  zoom: {
    punches: Punch[];
    /** Slow push-in over the whole Short. */
    slow: boolean;
    transition: Transition;
  };
  hook: { text: string; seconds: number };
  credit: { enabled: boolean; text: string };
  overlays: Overlay[];
  audio: {
    sourceVolume: number;
    music: { assetId: string | null; volume: number; duck: boolean };
    sfx: { id: string; assetId: string; at: number; volume: number }[];
    /** Final render: loudness normalised to YouTube's -14 LUFS. */
    normalize: boolean;
    /** Final render: background-noise reduction on the clip audio. */
    denoise: boolean;
  };
  /** Cover frame (output seconds) rendered as a JPEG next to the Short. */
  cover: { t: number | null };
}

export interface ShortProps {
  spec: EditSpec;
  videoSrc: string;
  /** asset id -> playable URL (signed Storage URL) for music, sfx and overlays */
  assetUrls: Record<string, string>;
  [key: string]: unknown;
}

/** Audio envelope + scene changes measured by the helper (clip_edits.analysis). */
export interface Analysis {
  /** Seconds per envelope value. */
  step: number;
  /** Loudness per step in dBFS (source time). */
  env: number[];
  /** Integrated loudness of the clip audio (LUFS), if measured. */
  lufs: number | null;
  /** Scene changes (source seconds). */
  scenes: number[];
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
    version: 2,
    sourceDuration: opts.duration,
    sourceWidth: opts.width,
    sourceHeight: opts.height,
    segments: [{ start: 0, end: round(opts.duration) }],
    layout: { mode: "crop", cropX: 0.5, cam: { x: 0.7, y: 0.05, w: 0.28, h: 0.3 }, camHeight: 0.38, follow: false, track: [] },
    captions: {
      enabled: true,
      words: [],
      y: 0.68,
      size: 82,
      style: "pop",
      font: "montserrat",
      color: "#FFFFFF",
      highlight: "#FFE600",
      wordsPerLine: 3,
      uppercase: true,
      autoEmoji: true,
      emphColor: "#22E37C",
    },
    censor: { enabled: true, audio: "mute", emoji: "🤬", extra: [] },
    zoom: { punches: [], slow: false, transition: "punch" },
    hook: { text: "", seconds: 3 },
    credit: { enabled: Boolean(opts.creatorName), text: opts.creatorName ? `🎮 ${handle ?? opts.creatorName}` : "" },
    overlays: [],
    audio: { sourceVolume: 1, music: { assetId: null, volume: 0.25, duck: true }, sfx: [], normalize: true, denoise: false },
    cover: { t: null },
  };
}

/** Brings a saved spec (v1 or partial v2) up to the current shape. */
export function upgradeSpec(raw: unknown, base: EditSpec): EditSpec {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Omit<Partial<EditSpec>, "version"> & { version?: number };
  if (r.version !== 1 && r.version !== 2) return base;
  const rc = (r.captions ?? {}) as Partial<EditSpec["captions"]>;
  const ra = (r.audio ?? {}) as Partial<EditSpec["audio"]>;
  return {
    ...base,
    sourceDuration: r.sourceDuration ?? base.sourceDuration,
    sourceWidth: r.sourceWidth ?? base.sourceWidth,
    sourceHeight: r.sourceHeight ?? base.sourceHeight,
    segments: r.segments?.length ? r.segments : base.segments,
    layout: { ...base.layout, ...(r.layout ?? {}) },
    captions: { ...base.captions, ...rc, words: rc.words ?? [] },
    censor: { ...base.censor, ...(r.censor ?? {}) },
    zoom: { ...base.zoom, ...(r.zoom ?? {}) },
    hook: { ...base.hook, ...(r.hook ?? {}) },
    credit: { ...base.credit, ...(r.credit ?? {}) },
    overlays: r.overlays ?? [],
    audio: { ...base.audio, ...ra, music: { ...base.audio.music, ...(ra.music ?? {}) }, sfx: ra.sfx ?? [] },
    cover: { ...base.cover, ...(r.cover ?? {}) },
    version: 2,
  };
}

// ---------------------------------------------------------------------------
// presets: the "look" of an edit, without anything clip-specific
// ---------------------------------------------------------------------------

export interface PresetSettings {
  layout?: Pick<EditSpec["layout"], "mode" | "cropX" | "cam" | "camHeight">;
  captions?: Omit<EditSpec["captions"], "words">;
  censor?: EditSpec["censor"];
  zoom?: Omit<EditSpec["zoom"], "punches">;
  credit?: { enabled: boolean };
  audio?: Omit<EditSpec["audio"], "sfx">;
}

export function extractPreset(spec: EditSpec): PresetSettings {
  const { mode, cropX, cam, camHeight } = spec.layout;
  const { words: _w, ...captions } = spec.captions;
  const { punches: _p, ...zoom } = spec.zoom;
  const { sfx: _s, ...audio } = spec.audio;
  return { layout: { mode, cropX, cam, camHeight }, captions, censor: spec.censor, zoom, credit: { enabled: spec.credit.enabled }, audio };
}

export function applyPreset(spec: EditSpec, p: PresetSettings): EditSpec {
  return {
    ...spec,
    layout: { ...spec.layout, ...(p.layout ?? {}) },
    captions: { ...spec.captions, ...(p.captions ?? {}), words: spec.captions.words },
    censor: { ...spec.censor, ...(p.censor ?? {}) },
    zoom: { ...spec.zoom, ...(p.zoom ?? {}), punches: spec.zoom.punches },
    credit: { ...spec.credit, enabled: p.credit?.enabled ?? spec.credit.enabled },
    audio: { ...spec.audio, ...(p.audio ?? {}), sfx: spec.audio.sfx },
  };
}

// ---------------------------------------------------------------------------
// time mapping
// ---------------------------------------------------------------------------

export const round = (n: number, step = 0.01) => Math.round(n / step) * step;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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

// ---------------------------------------------------------------------------
// captions
// ---------------------------------------------------------------------------

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
  emph: boolean;
  emoji: string | null;
  censored: boolean;
}

export interface CaptionPage {
  start: number;
  end: number;
  words: CaptionWord[];
}

export function wordCensored(spec: EditSpec, w: Word): boolean {
  if (!spec.censor.enabled || w.censor === false) return false;
  return w.censor === true || isSwear(w.text, spec.censor.extra);
}

/** Caption words placed on the output timeline (cut words dropped). */
export function outputWords(spec: EditSpec): CaptionWord[] {
  return spec.captions.words
    .map((w) => {
      const start = sourceToOutput(spec, w.startMs / 1000);
      if (start == null) return null;
      const end = sourceToOutput(spec, Math.max(w.startMs, w.endMs - 1) / 1000) ?? start + (w.endMs - w.startMs) / 1000;
      const emoji = w.emoji !== undefined ? w.emoji || null : spec.captions.autoEmoji ? emojiFor(w.text) : null;
      return {
        text: spec.captions.uppercase ? w.text.toUpperCase() : w.text,
        start,
        end: Math.max(end, start + 0.05),
        emph: Boolean(w.emph),
        emoji,
        censored: wordCensored(spec, w),
      };
    })
    .filter((w): w is CaptionWord => Boolean(w && w.text.trim()))
    .sort((a, b) => a.start - b.start);
}

/** Caption words grouped into short lines. */
export function captionPages(spec: EditSpec): CaptionPage[] {
  const perLine = spec.captions.style === "single" ? 1 : Math.max(1, spec.captions.wordsPerLine);
  const pages: CaptionPage[] = [];
  let cur: CaptionPage | null = null;
  for (const w of outputWords(spec)) {
    const gap = cur ? w.start - cur.end : 0;
    // a sentence end also starts a new line, so lines read naturally
    const sentenceEnd = cur ? /[.!?]$/.test(cur.words[cur.words.length - 1].text) : false;
    if (!cur || cur.words.length >= perLine || gap > 0.6 || sentenceEnd) {
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

/** Output-time intervals where someone talks (merged). */
export function speechIntervals(words: CaptionWord[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.start - last[1] < 0.35) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

/** 0 = nobody talking (far from speech), 1 = talking; ramps over `ramp` seconds. */
export function speechAmount(intervals: [number, number][], t: number, ramp = 0.3): number {
  let best = 0;
  for (const [a, b] of intervals) {
    if (t >= a && t <= b) return 1;
    const d = t < a ? a - t : t - b;
    if (d < ramp) best = Math.max(best, 1 - d / ramp);
    if (a > t + ramp) break;
  }
  return best;
}

/** Censored stretches on the output timeline (padded). */
export function censoredIntervals(words: CaptionWord[], pad = 0.06): [number, number][] {
  return words.filter((w) => w.censored).map((w) => [Math.max(0, w.start - pad), w.end + pad] as [number, number]);
}

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));

/** Zoom factor from punch-ins at source time s. */
export function punchScale(punches: Punch[], s: number): number {
  let z = 1;
  for (const p of punches) {
    const d = s - p.t;
    if (d < 0 || d > p.dur) continue;
    const inT = Math.min(0.12, p.dur / 3);
    const outT = Math.min(0.22, p.dur / 3);
    const k = d < inT ? ease(d / inT) : d > p.dur - outT ? ease((p.dur - d) / outT) : 1;
    z = Math.max(z, 1 + (p.scale - 1) * k);
  }
  return z;
}

/** Face position at source time s (smoothly interpolated). */
export function trackAt(track: TrackPoint[], s: number): { x: number; y: number } | null {
  if (!track.length) return null;
  if (s <= track[0].t) return track[0];
  const last = track[track.length - 1];
  if (s >= last.t) return last;
  let i = 0;
  while (i < track.length - 2 && track[i + 1].t < s) i++;
  const a = track[i];
  const b = track[i + 1];
  const k = b.t === a.t ? 0 : (s - a.t) / (b.t - a.t);
  const sm = k * k * (3 - 2 * k); // smoothstep: no jerky starts/stops
  return { x: a.x + (b.x - a.x) * sm, y: a.y + (b.y - a.y) * sm };
}

/**
 * Converts "keep point fx (0–1 of the source width) in the middle" into the
 * focus value cover() expects, for a box of the given size.
 */
export function focusFor(fx: number, srcW: number, srcH: number, boxW: number, boxH: number): number {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const visible = boxW / (srcW * scale);
  if (visible >= 0.999) return 0.5;
  return clamp((fx - visible / 2) / (1 - visible), 0, 1);
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

/** Readable text colour (black/white) on a given background. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#000000";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#000000" : "#FFFFFF";
}
