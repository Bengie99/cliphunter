"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { queueTranscriptionAction } from "@/app/editor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EMOJI_FAMILY, FONT_LABELS, font } from "@/remotion/fonts";
import { contrastText, sourceToOutput, wordCensored, type CaptionStyleId, type EditSpec, type FontId, type Word } from "@/remotion/spec";
import { emojiFor } from "@/remotion/words";
import { fmt, type PanelProps } from "./editor-types";
import { ColorInput, Hint, Section, Segmented, Slider, Toggle } from "./editor-ui";

type Captions = EditSpec["captions"];

const STYLES: { id: CaptionStyleId; name: string; desc: string; set: Partial<Captions> }[] = [
  { id: "pop", name: "Pop", desc: "Active word pops in colour", set: { style: "pop", font: "montserrat", uppercase: true, wordsPerLine: 3, color: "#FFFFFF", highlight: "#FFE600" } },
  { id: "box", name: "Box", desc: "Active word on a colour box", set: { style: "box", font: "montserrat", uppercase: true, wordsPerLine: 3, color: "#FFFFFF", highlight: "#8B5CF6" } },
  { id: "karaoke", name: "Karaoke", desc: "Words light up as they're said", set: { style: "karaoke", font: "poppins", uppercase: true, wordsPerLine: 4, color: "#FFFFFF", highlight: "#22E37C" } },
  { id: "single", name: "One word", desc: "One big word at a time", set: { style: "single", font: "anton", uppercase: true, wordsPerLine: 1, color: "#FFFFFF", highlight: "#FFFFFF" } },
  { id: "minimal", name: "Clean", desc: "Calm, sentence case", set: { style: "minimal", font: "inter", uppercase: false, wordsPerLine: 5, color: "#FFFFFF", highlight: "#FFFFFF" } },
  { id: "neon", name: "Neon", desc: "Glowing active word", set: { style: "neon", font: "bebas", uppercase: true, wordsPerLine: 3, color: "#FFFFFF", highlight: "#00E5FF" } },
];

const CENSOR_EMOJIS = ["🤬", "🙊", "🤐", "🔇", "❌", "⭐", "💀", "🫣"];

export function CaptionsPanel({ spec, update, data, seekOutput }: PanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const C = spec.captions;
  const set = (patch: Partial<Captions>, merge?: string) => update((s) => ({ ...s, captions: { ...s.captions, ...patch } }), merge ? { merge } : undefined);
  const status = data.transcriptStatus;
  const busy = status === "queued" || status === "running";

  const generate = () =>
    start(async () => {
      const res = await queueTranscriptionAction(data.clip.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Queued — the helper on your PC will transcribe it.");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle checked={C.enabled} onChange={(v) => set({ enabled: v })}>
          Show captions
        </Toggle>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={generate} disabled={pending || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {status === "queued" ? "Waiting for helper…" : status === "running" ? "Transcribing…" : C.words.length ? "Transcribe again" : "Generate subtitles"}
          </Button>
          {data.transcript?.length ? (
            <Button size="sm" variant="ghost" onClick={() => set({ words: data.transcript! })} title="Replace your edited words with the transcript">
              <RotateCcw /> Reset words
            </Button>
          ) : null}
        </div>
      </div>
      {status === "failed" && <p className="text-xs text-red-300">Transcription failed: {data.transcriptError}</p>}

      <Section title="Style">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => set(st.set)}
              className={cn("overflow-hidden rounded-lg border text-left", C.style === st.id ? "border-violet-400 ring-1 ring-violet-400" : "hover:border-muted-foreground/40")}
            >
              <StylePreview st={st.set as Captions} />
              <div className="px-2.5 py-1.5">
                <div className="text-sm font-medium">{st.name}</div>
                <div className="text-[11px] text-muted-foreground">{st.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Look">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Font</Label>
            <Select value={C.font} onChange={(e) => set({ font: e.target.value as FontId })}>
              {(Object.keys(FONT_LABELS) as FontId[]).map((f) => (
                <option key={f} value={f}>
                  {FONT_LABELS[f]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Words per line</Label>
            <Select value={C.wordsPerLine} disabled={C.style === "single"} onChange={(e) => set({ wordsPerLine: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <Slider label="Size" value={C.size} min={40} max={140} step={2} onChange={(v) => set({ size: v }, "size")} />
          <Slider label="Position (top ↔ bottom) — or drag on the preview" value={C.y} min={0.1} max={0.9} step={0.01} onChange={(v) => set({ y: v }, "y")} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <ColorInput label="Text" value={C.color} onChange={(v) => set({ color: v }, "color")} />
          <ColorInput label="Highlight" value={C.highlight} onChange={(v) => set({ highlight: v }, "highlight")} />
          <ColorInput label="Emphasis" value={C.emphColor} onChange={(v) => set({ emphColor: v }, "emph")} />
          <div className="space-y-2 pb-1">
            <Toggle checked={C.uppercase} onChange={(v) => set({ uppercase: v })}>
              UPPERCASE
            </Toggle>
            <Toggle checked={C.autoEmoji} onChange={(v) => set({ autoEmoji: v })}>
              Auto emojis 🔥
            </Toggle>
          </div>
        </div>
      </Section>

      <CensorSection spec={spec} update={update} seekOutput={seekOutput} />
      <WordsEditor spec={spec} update={update} seekOutput={seekOutput} />
    </div>
  );
}

function StylePreview({ st }: { st: Captions }) {
  const f = font(st.font);
  const words = ["THIS", "IS", "INSANE"].map((w) => (st.uppercase ? w : w[0] + w.slice(1).toLowerCase()));
  const base: React.CSSProperties = { ...f, fontSize: 17, display: "inline-block", margin: "0 2px", color: st.color };
  const active = (i: number): React.CSSProperties => {
    const on = i === 1;
    switch (st.style) {
      case "pop":
        return { color: on ? st.highlight : st.color, WebkitTextStroke: "3px black", paintOrder: "stroke fill", transform: on ? "scale(1.12)" : undefined };
      case "box":
        return { color: on ? contrastText(st.highlight) : st.color, background: on ? st.highlight : undefined, borderRadius: 4, padding: "0 3px", textShadow: on ? undefined : "0 1px 4px #000" };
      case "karaoke":
        return { color: i <= 1 ? st.highlight : st.color, WebkitTextStroke: "3px black", paintOrder: "stroke fill" };
      case "minimal":
        return { opacity: on ? 1 : 0.6, textShadow: "0 1px 4px #000" };
      case "neon":
        return { color: "#fff", textShadow: on ? `0 0 6px ${st.highlight}, 0 0 14px ${st.highlight}` : `0 0 4px ${st.highlight}88` };
      default:
        return {};
    }
  };
  return (
    <div className="flex h-16 items-center justify-center bg-[linear-gradient(135deg,#334155,#0f172a)] px-1">
      {st.style === "single" ? (
        <span style={{ ...base, fontSize: 26, color: st.highlight, WebkitTextStroke: "3px black", paintOrder: "stroke fill" }}>{words[2]}</span>
      ) : (
        words.map((w, i) => (
          <span key={i} style={{ ...base, ...active(i) }}>
            {w}
          </span>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// censoring
// ---------------------------------------------------------------------------

function CensorSection({ spec, update, seekOutput }: Pick<PanelProps, "spec" | "update" | "seekOutput">) {
  const K = spec.censor;
  const set = (patch: Partial<EditSpec["censor"]>) => update((s) => ({ ...s, censor: { ...s.censor, ...patch } }));
  const [extra, setExtra] = useState(K.extra.join(", "));
  const censored = useMemo(() => spec.captions.words.map((w, i) => ({ w, i })).filter(({ w }) => wordCensored(spec, w)), [spec]);
  const inEdit = censored.filter(({ w }) => sourceToOutput(spec, w.startMs / 1000) != null);
  const setWord = (i: number, censor: boolean | undefined) =>
    update((s) => ({ ...s, captions: { ...s.captions, words: s.captions.words.map((x, j) => (j === i ? { ...x, censor } : x)) } }));

  return (
    <Section title="Swear words (advertiser-friendly)">
      <Toggle checked={K.enabled} onChange={(v) => set({ enabled: v })}>
        Censor strong swear words and slurs
      </Toggle>
      {K.enabled && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Audio</Label>
              <div>
                <Segmented
                  value={K.audio}
                  onChange={(v) => set({ audio: v })}
                  options={[
                    { id: "mute", label: "Mute" },
                    { id: "bleep", label: "Bleep" },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Emoji over the blurred word</Label>
              <div className="flex flex-wrap gap-1">
                {CENSOR_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => set({ emoji: e })}
                    className={cn("size-8 rounded-md border text-lg", K.emoji === e ? "border-violet-400 bg-violet-500/15" : "hover:bg-secondary")}
                    style={{ fontFamily: EMOJI_FAMILY }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Also censor these words (comma separated)</Label>
            <Input
              value={extra}
              placeholder="e.g. a name, a brand"
              onChange={(e) => setExtra(e.target.value)}
              onBlur={() =>
                set({
                  extra: extra
                    .split(",")
                    .map((x) => x.trim().toLowerCase())
                    .filter(Boolean)
                    .slice(0, 200),
                })
              }
            />
          </div>
          <div className="rounded-md border p-2">
            {censored.length === 0 ? (
              <Hint>No swear words found in the subtitles{spec.captions.words.length ? "" : " (generate subtitles first)"}.</Hint>
            ) : (
              <>
                <Hint className="mb-2">
                  {inEdit.length} censored in the Short (muted{K.audio === "bleep" ? " + bleeped" : ""}). Click a time to check it; untick to allow a word.
                </Hint>
                <div className="flex flex-wrap gap-1.5">
                  {censored.map(({ w, i }) => {
                    const out = sourceToOutput(spec, w.startMs / 1000);
                    return (
                      <span key={i} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs", out == null && "opacity-50")}>
                        <button type="button" className="tabular-nums text-muted-foreground hover:text-foreground" disabled={out == null} onClick={() => out != null && seekOutput(Math.max(0, out - 0.8))}>
                          {out == null ? "cut" : fmt(out)}
                        </button>
                        <span className="font-medium text-red-300">{w.text}</span>
                        <button type="button" className="text-muted-foreground hover:text-foreground" title="Don't censor this word" onClick={() => setWord(i, false)}>
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <Hint>
            YouTube limits ads on Shorts with strong profanity, especially early on. Muting + blurring keeps them ad-friendly. The word timing comes from speech
            recognition, so play each one back to check it.
          </Hint>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

function WordsEditor({ spec, update, seekOutput }: Pick<PanelProps, "spec" | "update" | "seekOutput">) {
  const words = spec.captions.words;
  const [sel, setSel] = useState<number | null>(null);
  const w = sel != null ? words[sel] : null;
  const setW = (patch: Partial<Word>, merge?: string) =>
    sel != null && update((s) => ({ ...s, captions: { ...s.captions, words: s.captions.words.map((x, j) => (j === sel ? { ...x, ...patch } : x)) } }), merge ? { merge } : undefined);

  if (!words.length) return <Hint>No subtitles yet — generate them above (or wait for the analysis).</Hint>;
  const auto = w ? emojiFor(w.text) : null;
  const out = w ? sourceToOutput(spec, w.startMs / 1000) : null;

  return (
    <Section title="Words">
      <Hint>Click a word to fix it, emphasize it, give it an emoji or change its censoring. Words in cut parts are faded.</Hint>
      <div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
        {words.map((x, i) => {
          const cut = sourceToOutput(spec, x.startMs / 1000) == null;
          const cens = wordCensored(spec, x);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSel(i)}
              className={cn(
                "rounded px-1.5 py-0.5 text-sm",
                sel === i ? "bg-violet-500/30 ring-1 ring-violet-400" : "bg-secondary hover:bg-secondary/70",
                x.emph && "text-emerald-300",
                cens && "text-red-300 line-through",
                cut && "opacity-40",
              )}
            >
              {x.text}
              {x.emoji ? <span style={{ fontFamily: EMOJI_FAMILY }}> {x.emoji}</span> : null}
            </button>
          );
        })}
      </div>
      {w && sel != null && (
        <div className="grid gap-3 rounded-md border bg-secondary/30 p-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Text</Label>
              <Input value={w.text} onChange={(e) => setW({ text: e.target.value }, `w-${sel}`)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Emoji {w.emoji === undefined && auto ? `(auto: ${auto})` : ""}</Label>
              <Input value={w.emoji ?? ""} placeholder={auto ?? "none"} maxLength={8} onChange={(e) => setW({ emoji: e.target.value || undefined }, `e-${sel}`)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Censor</Label>
              <Select
                value={w.censor === undefined ? "auto" : w.censor ? "yes" : "no"}
                onChange={(e) => setW({ censor: e.target.value === "auto" ? undefined : e.target.value === "yes" })}
              >
                <option value="auto">Automatic</option>
                <option value="yes">Always</option>
                <option value="no">Never</option>
              </Select>
            </div>
            <Toggle checked={Boolean(w.emph)} onChange={(v) => setW({ emph: v })}>
              Emphasize
            </Toggle>
            <span className="text-xs text-muted-foreground sm:col-span-2">
              {fmt(w.startMs / 1000)} – {fmt(w.endMs / 1000)} in the original{out == null ? " · this part is cut" : ""}
            </span>
          </div>
          <div className="flex gap-1 sm:flex-col">
            <Button size="sm" variant="outline" disabled={out == null} onClick={() => out != null && seekOutput(Math.max(0, out - 0.5))}>
              <Play /> Play
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                update((s) => ({ ...s, captions: { ...s.captions, words: s.captions.words.filter((_, j) => j !== sel) } }));
                setSel(null);
              }}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
