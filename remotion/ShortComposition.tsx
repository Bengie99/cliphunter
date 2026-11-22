import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { EMOJI_FAMILY, font } from "./fonts";
import {
  FPS,
  OUT_H,
  OUT_W,
  captionPages,
  censoredIntervals,
  clamp,
  contrastText,
  focusFor,
  outputDuration,
  outputWords,
  punchScale,
  segmentOffsets,
  speechAmount,
  speechIntervals,
  trackAt,
  type CaptionPage,
  type CaptionWord,
  type EditSpec,
  type Overlay,
  type Segment,
  type ShortProps,
} from "./spec";

/**
 * The finished 1080x1920 Short. Rendered live in the editor (Remotion Player)
 * and to mp4 by the helper — same component, same output.
 */
export const ShortComposition: React.FC<ShortProps> = ({ spec, videoSrc, assetUrls }) => {
  const offsets = useMemo(() => segmentOffsets(spec), [spec]);
  const words = useMemo(() => outputWords(spec), [spec]);
  const pages = useMemo(() => captionPages(spec), [spec]);
  const speech = useMemo(() => speechIntervals(words), [words]);
  const censored = useMemo(() => censoredIntervals(words), [words]);
  const total = outputDuration(spec);
  const musicUrl = spec.audio.music.assetId ? assetUrls[spec.audio.music.assetId] : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {spec.segments.map((seg, i) => {
        const len = Math.round((seg.end - seg.start) * FPS);
        if (len <= 0) return null;
        return (
          <Sequence key={i} from={Math.round(offsets[i] * FPS)} durationInFrames={len} layout="none">
            <VideoLayer spec={spec} src={videoSrc} seg={seg} index={i} outStart={offsets[i]} total={total} censored={censored} />
          </Sequence>
        );
      })}

      {spec.zoom.transition === "flash" && offsets.slice(1).map((o, i) => <Flash key={i} at={o} />)}

      {spec.overlays.map((o) => (assetUrls[o.assetId] ? <OverlayItem key={o.id} o={o} src={assetUrls[o.assetId]} /> : null))}

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
            return spec.audio.music.duck ? v * (1 - 0.65 * speechAmount(speech, f / FPS)) : v;
          }}
        />
      )}

      {spec.audio.sfx.map((s) =>
        assetUrls[s.assetId] ? (
          <Sequence key={s.id} from={Math.max(0, Math.round(s.at * FPS))} layout="none">
            <Audio src={assetUrls[s.assetId]} volume={s.volume} />
          </Sequence>
        ) : null,
      )}

      {spec.censor.enabled &&
        spec.censor.audio === "bleep" &&
        censored.map(([a, b], i) => (
          <Sequence key={`bleep${i}`} from={Math.round(a * FPS)} durationInFrames={Math.max(1, Math.round((b - a) * FPS))} layout="none">
            <Audio src={staticFile("bleep.wav")} volume={0.35} />
          </Sequence>
        ))}
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

const inside = (ranges: [number, number][], t: number) => ranges.some(([a, b]) => t >= a && t < b);

const VideoLayer: React.FC<{
  spec: EditSpec;
  src: string;
  seg: Segment;
  index: number;
  outStart: number;
  total: number;
  censored: [number, number][];
}> = ({ spec, src, seg, index, outStart, total, censored }) => {
  const frame = useCurrentFrame();
  const { sourceWidth: sw, sourceHeight: sh, layout, zoom } = spec;
  const s = seg.start + frame / FPS; // source time
  const t = outStart + frame / FPS; // output time

  // zoom: punch-ins × slow push × cut transition
  let z = punchScale(zoom.punches, s);
  if (zoom.slow && total > 0) z *= 1 + 0.07 * (t / total);
  if (zoom.transition === "punch" && index > 0 && frame < 8) z *= 1 + 0.1 * (1 - frame / 8) ** 2;

  // horizontal focus: follow the face, or the fixed slider value
  const face = layout.follow ? trackAt(layout.track, s) : null;
  const focus = (boxW: number, boxH: number) => (face ? focusFor(face.x, sw, sh, boxW, boxH) : layout.cropX);
  const origin = face ? `${clamp(face.x, 0.2, 0.8) * 100}% ${clamp(face.y, 0.2, 0.8) * 100}%` : "50% 45%";

  const muteCensored = spec.censor.enabled && censored.length > 0;
  const trim = { trimBefore: Math.round(seg.start * FPS), trimAfter: Math.round(seg.end * FPS) };
  const video = (style: React.CSSProperties, withAudio: boolean) => (
    <OffthreadVideo
      src={src}
      {...trim}
      muted={!withAudio}
      volume={withAudio ? (f) => (muteCensored && inside(censored, outStart + f / FPS) ? 0 : spec.audio.sourceVolume) : 0}
      style={{ position: "absolute", maxWidth: "none", ...style }}
    />
  );
  const zoomed = (children: React.ReactNode) => (
    <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: origin }}>{children}</AbsoluteFill>
  );

  if (layout.mode === "blur") {
    const bg = cover(sw, sh, OUT_W, OUT_H, 0.5);
    const scale = Math.min(OUT_W / sw, OUT_H / sh);
    const fw = sw * scale;
    const fh = sh * scale;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        {video({ ...bg, filter: "blur(40px) brightness(0.55)", transform: "scale(1.1)" }, false)}
        {zoomed(video({ width: fw, height: fh, left: (OUT_W - fw) / 2, top: (OUT_H - fh) / 2 }, true))}
      </AbsoluteFill>
    );
  }

  if (layout.mode === "split") {
    const camH = Math.round(OUT_H * layout.camHeight);
    const gameH = OUT_H - camH;
    const c = layout.cam;
    const cw = Math.max(1, c.w * sw);
    const ch = Math.max(1, c.h * sh);
    const k = Math.max(OUT_W / cw, camH / ch);
    const camStyle = {
      width: sw * k,
      height: sh * k,
      left: -c.x * sw * k + (OUT_W - cw * k) / 2,
      top: -c.y * sh * k + (camH - ch * k) / 2,
    };
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", left: 0, top: 0, width: OUT_W, height: camH, overflow: "hidden" }}>{video(camStyle, false)}</div>
        <div style={{ position: "absolute", left: 0, top: camH, width: OUT_W, height: gameH, overflow: "hidden" }}>
          {zoomed(video(cover(sw, sh, OUT_W, gameH, layout.cropX), true))}
        </div>
        <div style={{ position: "absolute", left: 0, top: camH - 3, width: OUT_W, height: 6, background: "rgba(0,0,0,0.85)" }} />
      </AbsoluteFill>
    );
  }

  return <AbsoluteFill style={{ overflow: "hidden" }}>{zoomed(video(cover(sw, sh, OUT_W, OUT_H, focus(OUT_W, OUT_H)), true))}</AbsoluteFill>;
};

const Flash: React.FC<{ at: number }> = ({ at }) => (
  <Sequence from={Math.max(0, Math.round(at * FPS) - 1)} durationInFrames={7} layout="none">
    <FlashInner />
  </Sequence>
);
const FlashInner: React.FC = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ backgroundColor: "white", opacity: f <= 1 ? 0.85 : 0.85 * (1 - (f - 1) / 6) }} />;
};

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

const OverlayItem: React.FC<{ o: Overlay; src: string }> = ({ o, src }) => (
  <Sequence from={Math.max(0, Math.round(o.at * FPS))} durationInFrames={Math.max(1, Math.round(o.dur * FPS))} layout="none">
    <OverlayInner o={o} src={src} />
  </Sequence>
);
const OverlayInner: React.FC<{ o: Overlay; src: string }> = ({ o, src }) => {
  const f = useCurrentFrame();
  const pop = f < 6 ? 0.7 + 0.3 * (1 - (1 - f / 6) ** 3) : 1;
  const w = o.w * OUT_W;
  const style: React.CSSProperties = { width: w, height: "auto", display: "block", borderRadius: 18, boxShadow: "0 18px 50px rgba(0,0,0,0.45)" };
  return (
    <div
      style={{
        position: "absolute",
        left: o.x * OUT_W,
        top: o.y * OUT_H,
        transform: `translate(-50%, -50%) scale(${pop})`,
        opacity: f < 3 ? f / 3 : 1,
      }}
    >
      {o.kind === "video" ? <OffthreadVideo src={src} volume={o.volume} style={style} /> : <Img src={src} style={style} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

const UI_FONT = font("montserrat");

const Hook: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const pop = f < 8 ? 0.8 + 0.2 * (1 - (1 - f / 8) ** 3) : 1;
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 200 }}>
      <div
        style={{
          maxWidth: 940,
          padding: "22px 34px",
          borderRadius: 26,
          background: "white",
          color: "black",
          ...UI_FONT,
          fontSize: 62,
          lineHeight: 1.15,
          textAlign: "center",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          transform: `scale(${pop}) rotate(-1.5deg)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Credit: React.FC<{ text: string }> = ({ text }) => (
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 330 }}>
    <div
      style={{
        padding: "10px 24px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.55)",
        color: "white",
        fontFamily: `${font("inter").fontFamily}`,
        fontWeight: 700,
        fontSize: 34,
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

const Captions: React.FC<{ spec: EditSpec; pages: CaptionPage[] }> = ({ spec, pages }) => {
  const t = useCurrentFrame() / FPS;
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const C = spec.captions;
  const size = C.size;
  const since = t - page.start;
  const lineIn = C.style === "minimal" ? 1 : since < 0.1 ? 0.86 + 0.14 * (since / 0.1) : 1;
  const emoji = page.words.find((w) => w.emoji && t >= w.start - 0.05)?.emoji ?? null;
  const emojiSince = emoji ? t - (page.words.find((w) => w.emoji === emoji)?.start ?? page.start) : 0;

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: OUT_H * C.y,
          transform: `translateY(-50%) scale(${lineIn})`,
          width: 980,
          textAlign: "center",
          ...font(C.font),
          fontSize: size,
          lineHeight: 1.18,
        }}
      >
        {emoji && (
          <div
            style={{
              fontFamily: EMOJI_FAMILY,
              fontSize: size * 1.35,
              lineHeight: 1,
              marginBottom: size * 0.12,
              transform: `scale(${emojiSince < 0.15 ? 0.4 + 0.6 * (emojiSince / 0.15) : 1}) rotate(${Math.sin(emojiSince * 6) * 6}deg)`,
            }}
          >
            {emoji}
          </div>
        )}
        {page.words.map((w, i) => (
          <CaptionWordView key={i} w={w} t={t} spec={spec} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const CaptionWordView: React.FC<{ w: CaptionWord; t: number; spec: EditSpec }> = ({ w, t, spec }) => {
  const C = spec.captions;
  const size = C.size * (w.emph ? 1.18 : 1);
  const active = t >= w.start && t < w.end + 0.05;
  const spoken = t >= w.start;
  const since = t - w.start;
  const bounce = active && since < 0.12 ? 1 + 0.12 * Math.sin((since / 0.12) * Math.PI) : 1;
  const stroke = Math.max(2, size * 0.085);
  const baseColor = w.emph ? C.emphColor : C.color;

  let style: React.CSSProperties = {
    display: "inline-block",
    position: "relative",
    margin: `0 ${size * 0.11}px`,
    fontSize: size,
    color: baseColor,
    WebkitTextStroke: `${stroke}px black`,
    paintOrder: "stroke fill",
    textShadow: "0 6px 18px rgba(0,0,0,0.6)",
  };

  switch (C.style) {
    case "pop":
      style = { ...style, color: active ? C.highlight : baseColor, transform: `scale(${active ? 1.08 * bounce : 1})` };
      break;
    case "box":
      style = {
        ...style,
        WebkitTextStroke: "0px transparent",
        textShadow: active ? "none" : "0 4px 14px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
        color: active ? contrastText(C.highlight) : baseColor,
        background: active ? C.highlight : "transparent",
        borderRadius: size * 0.18,
        padding: `0 ${size * 0.14}px`,
        margin: `0 ${size * 0.03}px`,
        transform: `scale(${active ? bounce : 1}) rotate(${active ? -2 : 0}deg)`,
      };
      break;
    case "karaoke":
      style = { ...style, color: spoken ? C.highlight : baseColor, transform: `scale(${active ? bounce : 1})` };
      break;
    case "single": {
      const k = since < 0.08 ? 0.6 + 0.4 * (since / 0.08) : 1;
      style = { ...style, fontSize: size * 1.25, color: w.emph ? C.emphColor : C.highlight, transform: `scale(${k})` };
      break;
    }
    case "minimal":
      style = {
        ...style,
        WebkitTextStroke: "0px transparent",
        textShadow: "0 3px 12px rgba(0,0,0,0.75)",
        color: baseColor,
        opacity: active ? 1 : spoken ? 0.85 : 0.55,
      };
      break;
    case "neon":
      style = {
        ...style,
        WebkitTextStroke: `${Math.max(1, stroke * 0.4)}px rgba(0,0,0,0.6)`,
        color: active ? "#FFFFFF" : baseColor,
        textShadow: active
          ? `0 0 ${size * 0.15}px ${C.highlight}, 0 0 ${size * 0.35}px ${C.highlight}, 0 0 ${size * 0.6}px ${C.highlight}`
          : `0 0 ${size * 0.12}px ${C.highlight}88`,
        transform: `scale(${active ? bounce : 1})`,
      };
      break;
  }

  if (!w.censored) return <span style={style}>{w.text}</span>;
  return (
    <span style={{ ...style, position: "relative" }}>
      <span style={{ filter: `blur(${size * 0.16}px)` }}>{w.text}</span>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: EMOJI_FAMILY,
          fontSize: size * 0.95,
          WebkitTextStroke: "0px transparent",
          textShadow: "none",
          filter: "none",
        }}
      >
        {spec.censor.emoji}
      </span>
    </span>
  );
};
