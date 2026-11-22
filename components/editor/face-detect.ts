/**
 * Face detection in the browser (Google MediaPipe, free, runs locally on the
 * preview copy — nothing is uploaded). Used to
 *   - follow the streamer's face when cropping to vertical, and
 *   - find the facecam box for the "Facecam + gameplay" layout.
 *
 * BlazeFace is tuned for faces that fill a good part of the image, so every
 * frame is also scanned in four overlapping, enlarged tiles to catch the small
 * face inside a facecam overlay.
 */
import type { TrackPoint } from "@/remotion/spec";

const VERSION = "1.2.2"; // keep in sync with package.json
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** Normalised (0–1) face box in the source frame. */
export interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}
export interface FaceSample {
  t: number;
  faces: Face[];
}

type Detector = { detect: (img: HTMLCanvasElement) => { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number }[] }[] } };
let detectorPromise: Promise<Detector> | null = null;

async function getDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: "GPU" | "CPU") =>
      FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.55 });
    try {
      return (await make("GPU")) as unknown as Detector;
    } catch {
      return (await make("CPU")) as unknown as Detector;
    }
  })();
  try {
    return await detectorPromise;
  } catch (e) {
    detectorPromise = null;
    throw e;
  }
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Couldn't load the preview video for face detection"));
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = t;
  });
}

const iou = (a: Face, b: Face) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Samples the clip and returns every face found per moment (source time). */
export async function scanFaces(url: string, duration: number, onProgress: (p: number) => void, signal?: AbortSignal): Promise<FaceSample[]> {
  const [detector, video] = await Promise.all([getDetector(), loadVideo(url)]);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const step = Math.max(0.4, duration / 180);
  const tiles: [number, number][] = [
    [0, 0],
    [0.4, 0],
    [0, 0.4],
    [0.4, 0.4],
  ];
  const samples: FaceSample[] = [];
  try {
    for (let t = 0.05; t < duration; t += step) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await seek(video, Math.min(t, duration - 0.05));
      const found: Face[] = [];
      const run = (sx: number, sy: number, sw: number, sh: number) => {
        canvas.width = Math.round(Math.min(960, (sw * vw) * (sw < 1 ? 1.6 : 1)));
        canvas.height = Math.round((canvas.width * sh * vh) / (sw * vw));
        ctx.drawImage(video, sx * vw, sy * vh, sw * vw, sh * vh, 0, 0, canvas.width, canvas.height);
        for (const d of detector.detect(canvas).detections) {
          const b = d.boundingBox;
          if (!b) continue;
          found.push({
            x: sx + (b.originX / canvas.width) * sw,
            y: sy + (b.originY / canvas.height) * sh,
            w: (b.width / canvas.width) * sw,
            h: (b.height / canvas.height) * sh,
            score: d.categories[0]?.score ?? 0,
          });
        }
      };
      run(0, 0, 1, 1);
      for (const [sx, sy] of tiles) run(sx, sy, 0.6, 0.6);
      // merge duplicates from overlapping tiles
      found.sort((a, b) => b.score - a.score);
      const faces: Face[] = [];
      for (const f of found) if (faces.every((g) => iou(f, g) < 0.3)) faces.push(f);
      samples.push({ t: Math.round(t * 100) / 100, faces });
      onProgress(Math.min(1, t / duration));
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  return samples;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Camera path that keeps the main face in frame: holds still until the face
 * moves noticeably, then pans smoothly (like a camera operator, not a jitter).
 */
export function buildTrack(samples: FaceSample[]): TrackPoint[] {
  let prev: Face | null = null;
  const raw: { t: number; x: number; y: number }[] = [];
  for (const s of samples) {
    if (!s.faces.length) {
      if (prev) raw.push({ t: s.t, x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 });
      continue;
    }
    const biggest = s.faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    let pick = biggest;
    if (prev) {
      const p = prev;
      const near = s.faces.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
      // stay on the same person unless someone much bigger appears
      if (near.w * near.h > biggest.w * biggest.h * 0.5) pick = near;
    }
    prev = pick;
    raw.push({ t: s.t, x: pick.x + pick.w / 2, y: pick.y + pick.h / 2 });
  }
  if (!raw.length) return [];

  // median filter removes one-off misdetections
  const smooth = raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - 2), i + 3);
    return { t: r.t, x: median(win.map((w) => w.x)), y: median(win.map((w) => w.y)) };
  });

  // dead zone: only move when the face drifts > 7% of the width
  const pts: TrackPoint[] = [{ t: 0, x: smooth[0].x, y: smooth[0].y }];
  let hold = pts[0];
  for (const s of smooth) {
    if (Math.abs(s.x - hold.x) > 0.07 || Math.abs(s.y - hold.y) > 0.12) {
      const startPan = Math.max(hold.t, s.t - 0.6);
      if (startPan > pts[pts.length - 1].t) pts.push({ t: startPan, x: hold.x, y: hold.y });
      hold = { t: s.t, x: s.x, y: s.y };
      pts.push(hold);
    }
  }
  return pts.map((p) => ({ t: Math.round(p.t * 100) / 100, x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
}

/**
 * The facecam: a small face that stays in (nearly) the same place for most of
 * the clip. Returns the box to show in the camera panel, sized to its aspect.
 */
export function findFacecam(
  samples: FaceSample[],
  src: { w: number; h: number },
  panelAspect: number,
): { x: number; y: number; w: number; h: number } | null {
  const small = samples.flatMap((s) => s.faces.filter((f) => f.w < 0.3).map((f) => ({ ...f, t: s.t })));
  if (!small.length) return null;
  // cluster by position (grid of 10% cells), keep the most persistent one
  const cells = new Map<string, typeof small>();
  for (const f of small) {
    const key = `${Math.round((f.x + f.w / 2) * 10)}:${Math.round((f.y + f.h / 2) * 10)}`;
    cells.set(key, [...(cells.get(key) ?? []), f]);
  }
  const best = [...cells.values()].sort((a, b) => new Set(b.map((f) => f.t)).size - new Set(a.map((f) => f.t)).size)[0];
  const presence = new Set(best.map((f) => f.t)).size / Math.max(1, samples.length);
  if (presence < 0.35) return null;

  const cx = median(best.map((f) => f.x + f.w / 2));
  const cy = median(best.map((f) => f.y + f.h / 2));
  const fw = median(best.map((f) => f.w));
  // head + shoulders: ~3.2 face widths across, panel aspect (in pixels)
  let w = Math.min(1, fw * 3.2);
  let h = (w * src.w) / panelAspect / src.h;
  if (h > 1) {
    h = 1;
    w = (h * src.h * panelAspect) / src.w;
  }
  const x = Math.min(1 - w, Math.max(0, cx - w / 2));
  const y = Math.min(1 - h, Math.max(0, cy - h * 0.45));
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}
