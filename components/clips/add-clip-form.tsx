"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { createClipAction, lookupUrlAction, type NewClipForm } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseDuration, REVIEW_LABEL, RIGHTS_HINT, RIGHTS_LABEL } from "@/lib/format";
import { PLATFORM_META, parseClipUrl } from "@/lib/platforms";
import { RIGHTS_STATUSES, type RightsStatus } from "@/lib/types";
import { PlatformBadge } from "./badges";

const DEFAULT_CATEGORY = "Grand Theft Auto IV";

type Lookup = Awaited<ReturnType<typeof lookupUrlAction>>;
type LookupData = Extract<Lookup, { ok: true }>["data"];

interface FormState {
  title: string;
  creatorName: string;
  category: string;
  duration: string;
  views: string;
  likes: string;
  comments: string;
  uploadedAt: string;
  rightsStatus: RightsStatus;
  note: string;
}

const EMPTY: FormState = {
  title: "",
  creatorName: "",
  category: DEFAULT_CATEGORY,
  duration: "",
  views: "",
  likes: "",
  comments: "",
  uploadedAt: "",
  rightsStatus: "public_discoverable",
  note: "",
};

const toCount = (s: string) => {
  const t = s.replace(/[,\s_]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

export function AddClipForm({ onCreated }: { onCreated?: () => void }) {
  const [url, setUrl] = useState("");
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [looking, startLookup] = useTransition();
  const [saving, startSaving] = useTransition();

  const localParse = url ? parseClipUrl(url) : null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const runLookup = (value = url) => {
    const v = value.trim();
    if (!v) return;
    setLookupError(null);
    startLookup(async () => {
      const res = await lookupUrlAction(v);
      if (!res.ok) {
        setLookup(null);
        setLookupError(res.error);
        return;
      }
      setLookup(res.data);
      setUrl(res.data.parsed.canonicalUrl);
      setForm((f) => ({
        ...f,
        title: f.title || res.data.title || "",
        creatorName: f.creatorName || res.data.creatorName || "",
      }));
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const duration = parseDuration(form.duration);
    const views = toCount(form.views);
    const likes = toCount(form.likes);
    const comments = toCount(form.comments);
    if (form.duration && duration == null) return toast.error("Duration must look like 0:45 or 45");
    if ([views, likes, comments].some((n) => Number.isNaN(n))) return toast.error("Views, likes and comments must be whole numbers");

    const payload: NewClipForm = {
      url: lookup?.parsed.canonicalUrl ?? url.trim(),
      title: form.title,
      creatorName: form.creatorName.trim() || null,
      creatorUrl: lookup?.creatorUrl ?? null,
      thumbnailUrl: lookup?.thumbnailUrl ?? null,
      durationSeconds: duration,
      views,
      likes,
      comments,
      category: form.category.trim() || null,
      uploadedAt: form.uploadedAt ? new Date(`${form.uploadedAt}T12:00:00Z`).toISOString() : null,
      rightsStatus: form.rightsStatus,
      note: form.note.trim() || null,
    };

    startSaving(async () => {
      const res = await createClipAction(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.duplicate) {
        toast.warning("That clip is already in your library — nothing was added.");
        return;
      }
      toast.success("Clip added to the review queue");
      setUrl("");
      setLookup(null);
      setForm(EMPTY);
      onCreated?.();
    });
  };

  const platform = lookup?.parsed.platform ?? localParse?.platform;
  const duplicate = lookup?.existing;

  return (
    <form onSubmit={submit} className="space-y-4" onKeyDown={(e) => e.stopPropagation()}>
      <div className="space-y-1.5">
        <Label htmlFor="clip-url">Clip URL</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="clip-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setLookup(null);
                setLookupError(null);
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text) setTimeout(() => runLookup(text), 0);
              }}
              placeholder="https://clips.twitch.tv/…  ·  youtube.com/shorts/…  ·  tiktok.com/@…/video/…"
              className="pl-8"
              autoFocus
              required
            />
          </div>
          <Button type="button" variant="secondary" onClick={() => runLookup()} disabled={!url.trim() || looking}>
            {looking ? <Loader2 className="animate-spin" /> : <Wand2 />} Fetch details
          </Button>
        </div>
        {platform && !lookupError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <PlatformBadge platform={platform} />
            {lookup ? (
              <span>
                ID <code className="text-foreground">{lookup.parsed.externalId}</code>
                {lookup.source === "oembed" && " · details fetched from " + PLATFORM_META[platform].label}
              </span>
            ) : (
              <span>Detected — click “Fetch details” to check for duplicates and prefill.</span>
            )}
          </div>
        )}
        {lookupError && <p className="text-xs text-red-300">{lookupError}</p>}
        {lookup?.warning && (
          <p className="flex items-start gap-1.5 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {lookup.warning}
          </p>
        )}
        {duplicate && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Already in your library as “{duplicate.title}” ({REVIEW_LABEL[duplicate.review_status]}).{" "}
              {duplicate.review_status === "pending" && (
                <Link href={`/review?clip=${duplicate.id}`} className="underline underline-offset-2">
                  Open in review queue
                </Link>
              )}
            </span>
          </div>
        )}
      </div>

      {lookup?.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={lookup.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="h-28 rounded-md border object-cover" />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title *" className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={300} placeholder="What happens in the clip" />
        </Field>
        <Field label="Creator / streamer">
          <Input value={form.creatorName} onChange={(e) => set("creatorName", e.target.value)} maxLength={100} />
        </Field>
        <Field label="Category / game">
          <Input value={form.category} onChange={(e) => set("category", e.target.value)} maxLength={100} />
        </Field>
        <Field label="Duration (m:ss)">
          <Input value={form.duration} onChange={(e) => set("duration", e.target.value)} placeholder="0:45" />
        </Field>
        <Field label="Uploaded on">
          <Input type="date" value={form.uploadedAt} onChange={(e) => set("uploadedAt", e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          <Field label="Views">
            <Input inputMode="numeric" value={form.views} onChange={(e) => set("views", e.target.value)} placeholder="—" />
          </Field>
          <Field label="Likes">
            <Input inputMode="numeric" value={form.likes} onChange={(e) => set("likes", e.target.value)} placeholder="—" />
          </Field>
          <Field label="Comments">
            <Input inputMode="numeric" value={form.comments} onChange={(e) => set("comments", e.target.value)} placeholder="—" />
          </Field>
        </div>
        <Field label="Rights / permission" className="sm:col-span-2">
          <Select value={form.rightsStatus} onChange={(e) => set("rightsStatus", e.target.value as RightsStatus)}>
            {RIGHTS_STATUSES.map((r) => (
              <option key={r} value={r}>
                {RIGHTS_LABEL[r]}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">{RIGHTS_HINT[form.rightsStatus]}</p>
        </Field>
        <Field label="Note (optional)" className="sm:col-span-2">
          <Textarea value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={5000} rows={2} placeholder="Why is this clip interesting?" />
        </Field>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Views + upload date are used to compute an initial viral score. Leave them blank if unknown — the clip will show “No score”.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={saving || !url.trim() || !form.title.trim() || Boolean(duplicate)}>
          {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Add to review queue
        </Button>
      </div>
    </form>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
