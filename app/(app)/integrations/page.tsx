import { PlatformBadge } from "@/components/clips/badges";
import { PlannedPage } from "@/components/layout/planned-page";
import { Badge } from "@/components/ui/badge";
import { integrationEnvStatus } from "@/lib/env";
import type { Platform } from "@/lib/types";

export const metadata = { title: "Platform Integrations" };

const PLATFORM_NOTES: { platform: Platform; api: string; envKeys: string; notes: string }[] = [
  {
    platform: "twitch",
    api: "Twitch Helix API (official)",
    envKeys: "TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET",
    notes: "Clips by broadcaster or game with date ranges, view counts, thumbnails, creator info. App access token (client credentials).",
  },
  {
    platform: "youtube",
    api: "YouTube Data API v3 (official)",
    envKeys: "YOUTUBE_API_KEY",
    notes: "No dedicated Shorts endpoint: search + video details (duration ≤ 60–180s). Default quota 10,000 units/day — search costs 100 units.",
  },
  {
    platform: "kick",
    api: "Kick public API (official, limited)",
    envKeys: "KICK_CLIENT_ID, KICK_CLIENT_SECRET",
    notes: "Official API covers channels/livestreams; clip discovery coverage to be verified. Isolated adapter so a compliant source can be swapped in.",
  },
  {
    platform: "tiktok",
    api: "TikTok Research / Display API (approval required)",
    envKeys: "TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET",
    notes: "Broad discovery requires Research API access. Until approved: manual URL submission (oEmbed metadata works today).",
  },
  {
    platform: "instagram",
    api: "Instagram Graph API (business accounts only)",
    envKeys: "INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET",
    notes: "No general public Reels discovery. Manual URL submission is the supported path.",
  },
];

export default function IntegrationsPage() {
  const env = integrationEnvStatus();
  return (
    <PlannedPage
      title="Platform Integrations"
      phase={2}
      summary="Each platform gets its own isolated integration service. Connection state below reflects which credentials are present in your environment — no API calls are made yet."
      features={[
        "Twitch Helix clip discovery by streamer & game",
        "YouTube Data API search for short-form videos",
        "Kick adapter (official API where supported)",
        "Scheduled discovery jobs (Redis + BullMQ), default every 15 min",
        "Metadata sync + metric snapshots for growth tracking",
        "Rate limiting, retries and request logging per platform",
      ]}
    >
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Platform</th>
              <th className="px-4 py-2.5 font-medium">API</th>
              <th className="px-4 py-2.5 font-medium">Credentials</th>
              <th className="px-4 py-2.5 font-medium">Notes & limitations</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM_NOTES.map((p) => (
              <tr key={p.platform} className="border-b align-top last:border-b-0">
                <td className="px-4 py-3">
                  <PlatformBadge platform={p.platform} />
                </td>
                <td className="px-4 py-3 text-xs">{p.api}</td>
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
    </PlannedPage>
  );
}
