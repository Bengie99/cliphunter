import type { Platform } from "@/lib/types";
import type { Analysis, EditSpec, PresetSettings, Word } from "@/remotion/spec";

export type JobStatus = "none" | "queued" | "running" | "done" | "failed";
export type AssetKind = "music" | "sfx" | "image" | "video";

export interface EditorData {
  clip: { id: string; title: string; creatorName: string | null; creatorId: string | null; platform: Platform };
  /** Team workspace id — Storage paths live under it. */
  workspaceId: string;
  spec: EditSpec;
  proxyUrl: string;
  assets: { id: string; kind: AssetKind; name: string; url: string }[];
  transcript: Word[] | null;
  transcriptStatus: JobStatus;
  transcriptError: string | null;
  analysis: Analysis | null;
  renderStatus: JobStatus;
  renderProgress: number | null;
  renderError: string | null;
  outputPath: string | null;
  outputSize: number | null;
  renderedAt: string | null;
  coverUrl: string | null;
  meta: { title: string; description: string; tags: string[] };
  hasClaudeKey: boolean;
  presets: { id: string; name: string; creatorId: string | null; settings: PresetSettings }[];
  /** A creator preset was applied because this clip had never been edited. */
  appliedPreset: string | null;
}

/**
 * Changes the edit. `merge` groups rapid changes (e.g. dragging a slider) into
 * one undo step: consecutive updates with the same key within a second merge.
 */
export type Update = (fn: (s: EditSpec) => EditSpec, opts?: { merge?: string }) => void;

export interface PanelProps {
  spec: EditSpec;
  update: Update;
  data: EditorData;
  /** Playhead, output seconds. */
  outT: number;
  seekOutput: (t: number) => void;
}

export const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
