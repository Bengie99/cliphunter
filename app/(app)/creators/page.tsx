import Link from "next/link";
import { Users } from "lucide-react";
import { PlatformBadge, ScoreBadge } from "@/components/clips/badges";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getRepository } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Streamers & Creators" };

export default async function CreatorsPage() {
  const creators = await getRepository().listCreators();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Streamers & Creators"
        description="Creators are added automatically when you submit their clips. Monitoring and per-creator discovery settings arrive with the Phase 2 integrations."
      />
      {creators.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Users className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No creators yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a clip with a creator name and they&apos;ll appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Creator</th>
                <th className="px-4 py-2.5 font-medium">Platform</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 text-right font-medium">Clips</th>
                <th className="px-4 py-2.5 font-medium">Avg. score</th>
                <th className="px-4 py-2.5 font-medium">Monitoring</th>
                <th className="px-4 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.id} className="border-b last:border-b-0 hover:bg-white/[0.02]">
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
                    {c.is_monitored ? <Badge variant="success">Monitored</Badge> : <Badge variant="outline">Not monitored</Badge>}
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
