"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Save } from "lucide-react";
import { toast } from "sonner";
import { runTwitchDiscoveryNowAction, saveTwitchSettingsAction } from "@/app/discovery-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DiscoverySettings } from "@/lib/discovery/settings";

type Props = { initial: Omit<DiscoverySettings, "owner_id">; saved: boolean };

const toInt = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));

export function TwitchSettingsForm({ initial, saved }: Props) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [running, startRun] = useTransition();
  const [enabled, setEnabled] = useState(initial.discovery_enabled);
  const [form, setForm] = useState({
    categories: initial.categories.join(", "),
    languages: initial.languages.join(", "),
    minViews: String(initial.minimum_views),
    minDuration: initial.minimum_duration?.toString() ?? "",
    maxDuration: initial.maximum_duration?.toString() ?? "",
    windowHours: String(initial.upload_window_hours ?? 168),
    frequency: String(initial.frequency_minutes),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  function save() {
    const nums = [toInt(form.minViews), toInt(form.windowHours), toInt(form.frequency)];
    if (nums.some((n) => n == null || Number.isNaN(n))) return toast.error("Views, lookback and frequency must be whole numbers.");
    startSave(async () => {
      const res = await saveTwitchSettingsAction({
        discovery_enabled: enabled,
        categories: list(form.categories),
        languages: list(form.languages),
        minimum_views: toInt(form.minViews)!,
        minimum_duration: toInt(form.minDuration),
        maximum_duration: toInt(form.maxDuration),
        upload_window_hours: toInt(form.windowHours)!,
        frequency_minutes: toInt(form.frequency)!,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Twitch discovery settings saved");
      router.refresh();
    });
  }

  function runNow() {
    startRun(async () => {
      const res = await runTwitchDiscoveryNowAction();
      if (!res.ok) return void toast.error(res.error);
      const s = res.data;
      const msg = `${s.added} new · ${s.updated} refreshed · ${s.seen} checked`;
      if (s.status === "error") toast.error(s.messages[0] ?? "Discovery failed");
      else if (s.status === "partial") toast.warning(`${msg} — with warnings (see run log)`);
      else toast.success(msg);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        Run automatically on the schedule
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Games (Twitch category names, comma-separated)" hint="Empty = clips from monitored streamers in any game">
          <Input value={form.categories} onChange={set("categories")} placeholder="Grand Theft Auto VI" />
        </Field>
        <Field label="Languages (optional)" hint="2-letter codes, e.g. en, es. Empty = all">
          <Input value={form.languages} onChange={set("languages")} placeholder="en, es" />
        </Field>
        <Field label="Clip length (seconds)">
          <div className="flex items-center gap-2">
            <Input inputMode="numeric" value={form.minDuration} onChange={set("minDuration")} placeholder="min" />
            <span className="text-muted-foreground">–</span>
            <Input inputMode="numeric" value={form.maxDuration} onChange={set("maxDuration")} placeholder="max" />
          </div>
        </Field>
        <Field label="Minimum views">
          <Input inputMode="numeric" value={form.minViews} onChange={set("minViews")} />
        </Field>
        <Field label="Look back (hours)" hint="168 = last 7 days">
          <Input inputMode="numeric" value={form.windowHours} onChange={set("windowHours")} />
        </Field>
        <Field label="Run every (minutes)" hint="Minimum 15 — the scheduler ticks every 15 min">
          <Input inputMode="numeric" value={form.frequency} onChange={set("frequency")} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save settings
        </Button>
        <Button variant="outline" onClick={runNow} disabled={running || !saved} title={saved ? undefined : "Save settings first"}>
          {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? "Searching Twitch…" : "Run now"}
        </Button>
        {!saved && <span className="text-xs text-muted-foreground">Defaults shown — save once to turn discovery on.</span>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
