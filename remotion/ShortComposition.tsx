import React, { useMemo } from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import {
  FPS,
  OUT_H,
  OUT_W,
  captionPages,
  segmentOffsets,
  speechAt,
  type EditSpec,
  type Segment,
  type ShortProps,
} from "./spec";

/**
 * The finished 1080x1920 Short. Rendered live in the editor (Remotion Player)
 * and to mp4 by the download helper — same component, same output.
 */
export const ShortComposition: React.FC<ShortProps> = ({ spec, videoSrc, audioUrls }) => {
  const offsets = useMemo(() => segmentOffsets(spec), [spec]);
  const pages = useMemo(() => captionPages(spec), [spec]);
  const musicUrl = spec.audio.music.assetId ? audioUrls[spec.audio.music.assetId] : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {spec.segments.map((seg, i) => {
        const len = Math.round((seg.end - seg.start) * FPS);
        if (len <= 0) return null;
        return (
          <Sequence key={i} from={Math.round(offsets[i] * FPS)} durationInFrames={len} layout="none">
            <VideoLayer spec={spec} src={videoSrc} seg={seg} />
          </Sequence>
        );
      })}

      {spec.hook.text.trim() && (
        <Sequence durationInFrames={Math.max(1, Math.round(spec.hook.seconds * FPS))} layout="none">
          <Hook text={spec.hook.text} />
        </Sequence>
      )}

      {spec.credit.enabled && spec.credit.text.trim() && <Credit text={spec.credit.text} />}

      {spec.captions.enabled && <Captions spec={spec} pages={pages} />}

      {musicUrl && (
        <Audio
          src={musicUrl}
          loop
          volume={(f) => {
            const v = spec.audio.music.volume;
            return spec.audio.music.duck && speechAt(pages, f / FPS) ? v * 0.35 : v;
          }}
        />
      )}

      {spec.audio.sfx.map((s) =>
        audioUrls[s.assetId] ? (
          <Sequence key={s.id} from={Math.max(0, Math.round(s.at * FPS))} layout="none">
            <Audio src={audioUrls[s.assetId]} volume={s.volume} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// video layouts
// ---------------------------------------------------------------------------

function cover(srcW: number, srcH: number, boxW: number, boxH: number, focusX: number) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { width: w, height: h, left: -(w - boxW) * focusX, top: -(h - boxH) / 2 };
}

const VideoLayer: React.FC<{ spec: EditSpec; src: string; seg: Segment }> = ({ spec, src, seg }) => {
  const { sourceWidth: sw, sourceHeight: sh, layout } = spec;
  const trim = { trimBefore: Math.round(seg.start * FPS), trimAfter: Math.round(seg.end * FPS) };
  const video = (style: React.CSSProperties, withAudio: boolean) => (
    <OffthreadVideo
      src={src}
      {...trim}
      muted={!withAudio}
      volume={withAudio ? spec.audio.sourceVolume : 0}
      style={{ position: "absolute", maxWidth: "none", ...style }}
    />
  );

  if (layout.mode === "blur") {
    const bg = cover(sw, sh, OUT_W, OUT_H, 0.5);
    const scale = Math.min(OUT_W / sw, OUT_H / sh);
    const fw = sw * scale;
    const fh = sh * scale;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        {video({ ...bg, filter: "blur(40px) brightness(0.55)", transform: "scale(1.1)" }, false)}
        {video({ width: fw, height: fh, left: (OUT_W - fw) / 2, top: (OUT_H - fh) / 2 }, true)}
      </AbsoluteFill>
    );
  }

  if (layout.mode === "split") {
    const camH = Math.round(OUT_H * layout.camHeight);
    const gameH = OUT_H - camH;
    const c = layout.cam;
    const cw = Math.max(1, c.w * sw);
    const ch = Math.max(1, c.h * sh);
    const s = Math.max(OUT_W / cw, camH / ch);
    const camStyle = {
      width: sw * s,
      height: sh * s,
      left: -c.x * sw * s + (OUT_W - cw * s) / 2,
      top: -c.y * sh * s + (camH - ch * s) / 2,
    };
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", left: 0, top: 0, width: OUT_W, height: camH, overflow: "hidden" }}>
          {video(camStyle, false)}
        </div>
        <div style={{ position: "absolute", left: 0, top: camH, width: OUT_W, height: gameH, overflow: "hidden" }}>
          {video(cover(sw, sh, OUT_W, gameH, layout.cropX), true)}
        </div>
      </AbsoluteFill>
    );
  }

  return <AbsoluteFill style={{ overflow: "hidden" }}>{video(cover(sw, sh, OUT_W, OUT_H, layout.cropX), true)}</AbsoluteFill>;
};

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

const FONT = '"Arial Black", "Arial Bold", Impact, sans-serif';

const Hook: React.FC<{ text: string }> = ({ text }) => (
  <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
    <div
      style={{
        maxWidth: 940,
        padding: "22px 34px",
        borderRadius: 26,
        background: "white",
        color: "black",
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: 62,
        lineHeight: 1.15,
        textAlign: "center",
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

const Credit: React.FC<{ text: string }> = ({ text }) => (
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
    <div
      style={{
        padding: "10px 22px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.55)",
        color: "white",
        fontFamily: "Arial, sans-serif",
        fontWeight: 700,
        fontSize: 36,
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

const Captions: React.FC<{ spec: EditSpec; pages: ReturnType<typeof captionPages> }> = ({ spec, pages }) => {
  const t = useCurrentFrame() / FPS;
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const size = spec.captions.size;
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: OUT_H * spec.captions.y,
          transform: "translateY(-50%)",
          width: 980,
          textAlign: "center",
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1.12,
        }}
      >
        {page.words.map((w, i) => {
          const active = t >= w.start && t < w.end + 0.05;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                margin: `0 ${size * 0.12}px`,
                color: active ? spec.captions.highlight : "white",
                WebkitTextStroke: `${Math.max(2, size * 0.09)}px black`,
                paintOrder: "stroke fill",
                textShadow: "0 6px 18px rgba(0,0,0,0.6)",
                transform: active ? "scale(1.08)" : "scale(1)",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
