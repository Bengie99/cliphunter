import { CalendarPlus, CheckCircle2, Clapperboard, Flame, HardDrive, Inbox } from "lucide-react";
import { DiscoveryChart } from "@/components/dashboard/discovery-chart";
import { MiniClipList, PipelineSummary, PlatformActivity, SectionCard, StatCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/layout/page-header";
import { getRepository } from "@/lib/data";
import { TRENDING_THRESHOLD } from "@/lib/scoring";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const repo = getRepository();
  const [stats, recent, trending, review] = await Promise.all([
    repo.getDashboardStats(),
    repo.listClips({ sort: "discovered_desc", pageSize: 6 }),
    repo.listClips({ sort: "score_desc", minScore: TRENDING_THRESHOLD, reviewStatuses: ["pending", "approved"], pageSize: 6 }),
    repo.listClips({ reviewStatuses: ["pending"], sort: "score_desc", pageSize: 6 }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" description="Overview of discovered clips and your content pipeline." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total clips" value={stats.total} icon={Clapperboard} href="/clips" />
        <StatCard label="New today" value={stats.newToday} icon={CalendarPlus} href="/clips?discovered=24h" hint="Since 00:00 UTC" />
        <StatCard label="Trending" value={stats.trending} icon={Flame} href="/trending" hint={`Score ≥ ${TRENDING_THRESHOLD}`} />
        <StatCard label="Awaiting review" value={stats.awaitingReview} icon={Inbox} href="/review" />
        <StatCard label="Approved" value={stats.approved} icon={CheckCircle2} href="/approved" />
        <StatCard label="Downloaded footage" value={stats.downloaded} icon={HardDrive} hint="Phase 4" />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <SectionCard title="Clips discovered · last 14 days" className="xl:col-span-2">
          <DiscoveryChart data={stats.perDay} />
        </SectionCard>
        <SectionCard title="Platform activity" href="/clips">
          <PlatformActivity byPlatform={stats.byPlatform} />
        </SectionCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Recently discovered" href="/clips">
          <MiniClipList clips={recent.clips} empty="No clips yet — add one by URL." linkFor={(c) => `/clips?q=${encodeURIComponent(c.title.slice(0, 60))}`} />
        </SectionCard>
        <SectionCard title="Trending right now" href="/trending">
          <MiniClipList clips={trending.clips} empty={`No clips scoring ${TRENDING_THRESHOLD}+ yet.`} linkFor={(c) => (c.review_status === "pending" ? `/review?clip=${c.id}` : `/clips?q=${encodeURIComponent(c.title.slice(0, 60))}`)} />
        </SectionCard>
        <SectionCard title="Review required" href="/review">
          <MiniClipList clips={review.clips} empty="Nothing waiting for review." linkFor={(c) => `/review?clip=${c.id}`} />
        </SectionCard>
      </div>

      <SectionCard title="Content pipeline" href="/pipeline">
        <PipelineSummary byPipeline={stats.byPipeline} />
      </SectionCard>
    </div>
  );
}
