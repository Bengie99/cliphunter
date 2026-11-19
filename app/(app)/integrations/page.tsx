import Link from "next/link";
import { PlatformBadge } from "@/components/clips/badges";
import { TwitchSettingsForm } from "@/components/discovery/twitch-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTwitchSettings, listRecentRuns, TWITCH_DEFAULTS, type DiscoveryRun } from "@/lib/discovery/settings";
import { getDataMode, integrationEnvStatus } from "@/lib/env";
import { formatDateTime, timeAgo } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/types";

export const metadata = { title: "Platform Integrations" };
export const dynamic = "force-dynamic";

const PLATFORM_NOTES: { platform: Platform; api: string; envKeys: string; status: string; notes: string }[] = [
  {
    platform: "twitch",
    api: "Twitch Helix API (official)",
    envKeys: "TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET",
    status: "Live",
    notes: "Clips from monitored streamers and top clips per game. App access token; Twitch exposes views but not likes/comments.",
  },
  {
    platform: "youtube",
    api: "YouTube Data API v3 (official)",
    envKeys: "YOUTUBE_API_KEY",
    status: "Next",
    notes: "Channel monitoring is cheap (1 unit/call). Keyword search costs 100 of the 10,000 daily units, so it runs a few times a day.",
  },
  {
    platform: "kick",
    api: "Kick public API (official, limited)",
    envKeys: "KICK_CLIENT_ID, KICK_CLIENT_SECRET",
    status: "Investigating",
    notes: "Official API covers channels/livestreams; clip coverage still to be verified. No unofficial scraping.",
  },
  {
    platform: "tiktok",
    api: "TikTok Research API (approval required)",
    envKeys: "TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET",
    status: "Manual only",
    notes: "No public discovery API. Paste URLs on Discover — title/creator/thumbnail are prefilled via oEmbed.",
  },
  {
    platform: "instagram",
    api: "Instagram Graph API (own business account only)",
    envKeys: "INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET",
    status: "Manual only",
    notes: "No general Reels discovery. Paste URLs on Discover.",
  },
];

const RUN_BADGE: Record<DiscoveryRun["status"], { label: string; variant: "success" | "warning" | "danger" | "outline" }> = {
  success: { label: "OK", variant: "success" },
  partial: { label: "Warnings", variant: "warning" },
  error: { label: "Failed", variant: "danger" },
  running: { label: "Running", variant: "outline" },
};

export default async function IntegrationsPage() {
  const env = integrationEnvStatus();
  const supabaseMode = getDataMode() === "supabase";

  let settings = null;
  let runs: DiscoveryRun[] = [];
  let loadError: string | null = null;
  if (supabaseMode) {
    try {
      const sb = createSupabaseServerClient();
      [settings, runs] = await Promise.all([getTwitchSettings(sb), listRecentRuns(sb, 10)]);
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Failed to load discovery data";
    }
  }

  const missing = [
    !env.twitch && "TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET",
    !env.supabaseServiceRole && "SUPABASE_SERVICE_ROLE_KEY",
    !process.env.CRON_SECRET && "CRON_SECRET",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform Integrations"
        description="Automatic clip discovery. New clips land in the Review Queue; clips you already have get their view counts refreshed."
      />

      {!supabaseMode ? (
        <Card className="border-dashed">
          <CardContent className="pt-5 text-sm text-muted-foreground">Discovery needs Supabase. It isn&apos;t available in demo mode.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlatformBadge platform="twitch" /> Twitch discovery
              </CardTitle>
              {settings?.discovery_enabled ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>}
            </CardHeader>
            <CardContent className="space-y-4">
              {missing.length > 0 && (
                <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Missing environment variables in Vercel: <span className="font-mono">{missing.join(", ")}</span>. Add them and redeploy.
                </p>
              )}
              {loadError && (
                <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {loadError}. Has the <span className="font-mono">20261119000000_discovery.sql</span> migration been run?
                </p>
              )}
              <TwitchSettingsForm initial={settings ?? TWITCH_DEFAULTS} saved={Boolean(settings)} />
              <p className="text-xs text-muted-foreground">
                Streamers to watch are managed on the <Link className="underline hover:text-foreground" href="/creators">Creators</Link> page.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet. Save settings, then click Run now.</p>
              ) : (
                <ul className="space-y-3">
                  {runs.map((r) => (
                    <li key={r.id} className="border-b pb-3 text-xs last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <Badge variant={RUN_BADGE[r.status].variant}>{RUN_BADGE[r.status].label}</Badge>
                          <span title={formatDateTime(r.started_at)}>{timeAgo(r.started_at)}</span>
                          <span className="text-muted-foreground">{r.trigger === "manual" ? "manual" : "scheduled"}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          <span className="text-foreground">{r.clips_new}</span> new · {r.clips_updated} refreshed
                        </span>
                      </div>
                      {r.messages.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                          {r.messages.slice(0, 4).map((m, i) => (
                            <li key={i}>• {m}</li>
                          ))}
                          {r.messages.length > 4 && <li>• …and {r.messages.length - 4} more</li>}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Platform</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Credentials</th>
              <th className="px-4 py-2.5 font-medium">Notes & limitations</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM_NOTES.map((p) => (
              <tr key={p.platform} className="border-b align-top last:border-b-0">
                <td className="px-4 py-3">
                  <PlatformBadge platform={p.platform} />
                  <div className="mt-1 text-[11px] text-muted-foreground">{p.api}</div>
                </td>
                <td className="px-4 py-3 text-xs">{p.status}</td>
                <td className="px-4 py-3">
                  {env[p.platform] ? <Badge variant="success">Configured</Badge> : <Badge variant="outline">Not set</Badge>}
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">{p.envKeys}</div>
                </td>
                <td className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">{p.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
