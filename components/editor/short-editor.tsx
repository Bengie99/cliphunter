"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, Captions, Clapperboard, Film, Keyboard, Music, Redo2, Scissors, Shapes, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { saveEditAction } from "@/app/editor-actions";
import { PlatformBadge } from "@/components/clips/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ShortComposition } from "@/remotion/ShortComposition";
import { FPS, OUT_H, OUT_W, durationInFrames, outputDuration, outputToSource, round, sourceToOutput, type EditSpec } from "@/remotion/spec";
import { fmt, type EditorData, type PanelProps, type Update } from "./editor-types";
import { HelperStatus } from "./helper-status";
import { AutoPanel } from "./panel-auto";
import { AudioPanel, VisualsPanel } from "./panel-audio-visuals";
import { CaptionsPanel } from "./panel-captions";
import { CutsPanel, LayoutPanel, deleteAt, splitAt } from "./panel-cuts-layout";
import { PublishPanel } from "./panel-publish";
import { Timeline } from "./timeline";

export type { EditorData } from "./editor-types";

const TABS = [
  { id: "auto", label: "Auto", icon: Wand2 },
  { id: "cuts", label: "Cuts", icon: Scissors },
  { id: "layout", label: "Layout", icon: Film },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "audio", label: "Audio", icon: Music },
  { id: "visuals", label: "Visuals", icon: Shapes },
  { id: "publish", label: "Render & publish", icon: Clapperboard },
] as const;
type Tab = (typeof TABS)[number]["id"];

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["S", "Split at playhead"],
  ["Delete", "Remove the part under the playhead"],
  ["Z", "Zoom punch-in at playhead"],
  ["← / →", "Step one frame (Shift: one second)"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Shift+Z / Ctrl+Y", "Redo"],
  ["?", "Show / hide shortcuts"],
];

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
};

export function ShortEditor({ data }: { data: EditorData }) {
  const router = useRouter();
  const playerRef = useRef<PlayerRef>(null);
  const [spec, setSpec] = useState<EditSpec>(data.spec);
  const specRef = useRef(spec);
  const [tab, setTab] = useState<Tab>("auto");
  const [frame, setFrame] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [showHelp, setShowHelp] = useState(false);
  const [safeZones, setSafeZones] = useState(false);
  // Signed URLs change on every server refresh; keep the first ones so the preview doesn't reload.
  const [videoSrc] = useState(data.proxyUrl);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>(() => Object.fromEntries(data.assets.map((a) => [a.id, a.url])));

  // --- undo / redo -----------------------------------------------------------
  const past = useRef<EditSpec[]>([]);
  const future = useRef<EditSpec[]>([]);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);

  const commit = useCallback((next: EditSpec) => {
    specRef.current = next;
    setSpec(next);
    bump((n) => n + 1);
  }, []);

  const update: Update = useCallback(
    (fn, opts) => {
      const prev = specRef.current;
      const next = fn(prev);
      if (next === prev) return;
      const now = Date.now();
      const m = lastMerge.current;
      const merging = Boolean(opts?.merge && m && m.key === opts.merge && now - m.at < 1000);
      if (!merging) {
        past.current.push(prev);
        if (past.current.length > 200) past.current.shift();
      }
      lastMerge.current = opts?.merge ? { key: opts.merge, at: now } : null;
      future.current = [];
      commit(next);
    },
    [commit],
  );
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(specRef.current);
    lastMerge.current = null;
    commit(prev);
  }, [commit]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(specRef.current);
    lastMerge.current = null;
    commit(next);
  }, [commit]);

  // --- server data arriving ----------------------------------------------------
  useEffect(() => {
    setAssetUrls((prev) => {
      const missing = data.assets.filter((a) => !prev[a.id] && a.url);
      return missing.length ? { ...prev, ...Object.fromEntries(missing.map((a) => [a.id, a.url])) } : prev;
    });
  }, [data.assets]);

  // fill subtitles once a transcript arrives (unless the user already has words) — not an undo step
  useEffect(() => {
    if (data.transcript?.length && !specRef.current.captions.words.length) {
      commit({ ...specRef.current, captions: { ...specRef.current.captions, words: data.transcript } });
      toast.success("Subtitles are ready");
    }
  }, [data.transcript, commit]);

  useEffect(() => {
    if (data.appliedPreset) toast.info(`Started from the “${data.appliedPreset}” preset for this creator.`);
  }, [data.appliedPreset]);

  // --- autosave ------------------------------------------------------------------
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // a preset or upgraded spec that was never saved: save it once
      if (!data.appliedPreset) return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      const res = await saveEditAction(data.clip.id, spec);
      setSaveState(res.ok ? "saved" : "error");
      if (!res.ok) toast.error(res.error);
    }, 800);
    return () => clearTimeout(t);
  }, [spec, data.clip.id, data.appliedPreset]);

  // poll server state while jobs are running
  const busy = ["queued", "running"].includes(data.transcriptStatus) || ["queued", "running"].includes(data.renderStatus);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [busy, router]);

  // --- playhead ------------------------------------------------------------------
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("seeked", onFrame);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("seeked", onFrame);
    };
  }, []);

  const total = outputDuration(spec);
  const outT = frame / FPS;
  const seekOutput = useCallback(
    (t: number) => {
      const f = Math.max(0, Math.min(Math.round(t * FPS), durationInFrames(specRef.current) - 1));
      playerRef.current?.seekTo(f);
      setFrame(f);
    },
    [],
  );
  const seekSource = useCallback(
    (s: number) => {
      const sp = specRef.current;
      const direct = sourceToOutput(sp, s);
      if (direct != null) return seekOutput(direct);
      // clicked a cut part: jump to the next kept moment
      const next = [...sp.segments].filter((g) => g.start >= s).sort((a, b) => a.start - b.start)[0];
      seekOutput(next ? sourceToOutput(sp, next.start) ?? 0 : Math.max(0, outputDuration(sp) - 0.05));
    },
    [seekOutput],
  );

  // --- keyboard shortcuts -------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        if (isTyping(e.target)) return;
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && e.key.toLowerCase() === "y") {
        if (isTyping(e.target)) return;
        e.preventDefault();
        return redo();
      }
      if (mod || e.altKey || isTyping(e.target)) return;
      const t = frame / FPS;
      const apply = (r: EditSpec | string) => (typeof r === "string" ? toast.warning(r) : update(() => r));
      switch (e.key) {
        case " ":
          e.preventDefault();
          playerRef.current?.toggle();
          break;
        case "s":
        case "S":
          apply(splitAt(specRef.current, t));
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          apply(deleteAt(specRef.current, t));
          break;
        case "z":
        case "Z": {
          const at = outputToSource(specRef.current, t);
          if (at)
            update((sp) => ({
              ...sp,
              zoom: { ...sp.zoom, punches: [...sp.zoom.punches, { id: crypto.randomUUID(), t: round(at.source), dur: 0.9, scale: 1.15 }].sort((a, b) => a.t - b.t) },
            }));
          break;
        }
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const d = (e.shiftKey ? FPS : 1) * (e.key === "ArrowLeft" ? -1 : 1);
          seekOutput((frame + d) / FPS);
          break;
        }
        case "?":
          setShowHelp((v) => !v);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, undo, redo, update, seekOutput]);

  const inputProps = useMemo(() => ({ spec, videoSrc, assetUrls }), [spec, videoSrc, assetUrls]);
  const panel: PanelProps = { spec, update, data, outT, seekOutput };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm">
            <Link href="/footage" aria-label="Back to footage">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{data.clip.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <PlatformBadge platform={data.clip.platform} />
              {data.clip.creatorName}
              <span>· Short {fmt(total)}</span>
              {total > 180 ? <Badge variant="danger">Over 3 min — not a Short</Badge> : total > 60 ? <Badge variant="warning">Over 60s</Badge> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HelperStatus className="mr-2 hidden md:flex" />
          <Button size="icon-sm" variant="ghost" onClick={undo} disabled={!past.current.length} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={redo} disabled={!future.current.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 />
          </Button>
          <Button size="icon-sm" variant={showHelp ? "secondary" : "ghost"} onClick={() => setShowHelp((v) => !v)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <Keyboard />
          </Button>
          <span className="w-28 text-right text-xs text-muted-foreground">
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "All changes saved"}
          </span>
        </div>
      </div>

      {showHelp && (
        <div className="grid gap-x-6 gap-y-1 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{v}</span>
              <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="relative overflow-hidden rounded-xl border bg-black">
            <Player
              ref={playerRef}
              component={ShortComposition}
              inputProps={inputProps}
              durationInFrames={durationInFrames(spec)}
              compositionWidth={OUT_W}
              compositionHeight={OUT_H}
              fps={FPS}
              controls
              acknowledgeRemotionLicense
              style={{ width: "100%", aspectRatio: "9 / 16" }}
            />
            {safeZones && <SafeZones />}
            {spec.captions.enabled && <CaptionHandle y={spec.captions.y} onChange={(y) => update((s) => ({ ...s, captions: { ...s.captions, y } }), { merge: "capdrag" })} />}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Preview: 720p copy · render: full quality</span>
            <button type="button" className={cn("underline-offset-2 hover:underline", safeZones && "text-violet-300")} onClick={() => setSafeZones((v) => !v)}>
              {safeZones ? "Hide" : "Show"} YouTube safe zones
            </button>
          </div>
          <HelperStatus className="mt-2 md:hidden" />
        </div>

        <div className="min-w-0 rounded-xl border bg-card">
          <div className="flex gap-1 overflow-x-auto border-b p-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                  tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
          <div className="p-4">
            {tab === "auto" && <AutoPanel {...panel} />}
            {tab === "cuts" && <CutsPanel {...panel} />}
            {tab === "layout" && <LayoutPanel {...panel} />}
            {tab === "captions" && <CaptionsPanel {...panel} />}
            {tab === "audio" && <AudioPanel {...panel} />}
            {tab === "visuals" && <VisualsPanel {...panel} />}
            {tab === "publish" && <PublishPanel {...panel} />}
          </div>
        </div>
      </div>

      <Timeline spec={spec} analysis={data.analysis} outT={outT} onSeekSource={seekSource} />
    </div>
  );
}

/** Where YouTube's Shorts buttons and texts cover the video. */
function SafeZones() {
  const zone = "absolute bg-red-500/25 ring-1 ring-inset ring-red-400/60 text-[9px] font-medium text-red-100 flex items-center justify-center text-center p-1";
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className={zone} style={{ left: 0, right: 0, top: 0, height: "7%" }}>
        search / menu
      </div>
      <div className={zone} style={{ right: 0, width: "15%", top: "40%", bottom: "17%" }}>
        like · comment · share
      </div>
      <div className={zone} style={{ left: 0, right: "15%", bottom: "8%", height: "14%" }}>
        channel · title · music
      </div>
    </div>
  );
}

/** Drag handle for the caption line position. */
function CaptionHandle({ y, onChange }: { y: number; onChange: (y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const move = (clientY: number) => {
    const box = ref.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    onChange(Math.round(Math.min(0.9, Math.max(0.1, (clientY - box.top) / box.height)) * 100) / 100);
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Caption position"
      aria-valuenow={Math.round(y * 100)}
      className={cn(
        "absolute right-1 z-10 flex -translate-y-1/2 cursor-ns-resize select-none items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white ring-1 ring-white/30 hover:bg-violet-600",
        drag && "bg-violet-600",
      )}
      style={{ top: `${y * 100}%` }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(true);
      }}
      onPointerMove={(e) => drag && move(e.clientY)}
      onPointerUp={() => setDrag(false)}
      title="Drag to move the captions"
    >
      ⇕ captions
    </div>
  );
}
