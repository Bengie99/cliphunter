import Link from "next/link";
import { Users } from "lucide-react";
import { PlatformBadge, ScoreBadge } from "@/components/clips/badges";
import { PageHeader } from "@/components/layout/page-header";
import { AddStreamersForm } from "@/components/discovery/add-streamers-form";
import { MonitorToggle } from "@/components/discovery/monitor-toggle";
import { PermissionDialog } from "@/components/discovery/permission-dialog";
import { ScanBiosButton } from "@/components/discovery/scan-bios-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepository } from "@/lib/data";
import { getDataMode } from "@/lib/env";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Streamers & Creators" };

export default async function CreatorsPage() {
  const creators = await getRepository().listCreators();
  const canMonitor = getDataMode() === "supabase";
  return (
    <div className="space-y-5">
      <PageHeader
        title="Streamers & Creators"
        description="Monitored channels are checked for new clips on every discovery run. Click a Monitoring badge to switch it on or off, and a Clipping permission badge to set Yes / No."
        actions={canMonitor ? <ScanBiosButton /> : undefined}
      />
      {canMonitor && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Monitor Twitch streamers</CardTitle>
            </CardHeader>
            <CardContent>
              <AddStreamersForm platform="twitch" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Monitor YouTube channels</CardTitle>
            </CardHeader>
            <CardContent>
              <AddStreamersForm platform="youtube" />
            </CardContent>
          </Card>
        </div>
      )}
      {creators.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Users className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No creators yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add Twitch streamers or YouTube channels above, or add a clip with a creator name.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Creator</th>
                <th className="px-4 py-2.5 font-medium">Platform</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 text-right font-medium">Clips</th>
                <th className="px-4 py-2.5 font-medium">Avg. score</th>
                <th className="px-4 py-2.5 font-medium">Monitoring</th>
                <th className="px-4 py-2.5 font-medium">Clipping permission</th>
                <th className="px-4 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.id} className="border-b align-top last:border-b-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/clips?creator=${c.id}`} className="font-medium hover:text-violet-300">
                      {c.name}
                    </Link>
                    {c.profile_url && (
                      <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-muted-foreground hover:underline">
                        profile ↗
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <PlatformBadge platform={c.platform} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.category ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.clip_count}</td>
                  <td className="px-4 py-2.5">
                    <ScoreBadge score={c.avg_viral_score} />
                  </td>
                  <td className="px-4 py-2.5">
                    <MonitorToggle creatorId={c.id} monitored={c.is_monitored} enabled={canMonitor && (c.platform === "twitch" || c.platform === "youtube")} />
                  </td>
                  <td className="px-4 py-2.5">
                    <PermissionDialog creator={c} editable={canMonitor} />
                    {c.bio_clip_excerpt ? (
                      <p className="mt-1 max-w-[280px] text-[11px] leading-snug text-amber-200/90" title="From their public bio — check it, then set Yes/No">
                        Bio: “{c.bio_clip_excerpt}”
                      </p>
                    ) : c.bio_checked_at ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">Bio says nothing about clipping</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
