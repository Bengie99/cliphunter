import { ClipListPage } from "@/components/clips/clip-list-page";
import type { SearchParams } from "@/lib/query-params";
import { TRENDING_THRESHOLD } from "@/lib/scoring";

export const metadata = { title: "Trending" };

export default function TrendingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ClipListPage
      title="Trending"
      description={`Clips with a viral score of ${TRENDING_THRESHOLD}+ that are still in play (awaiting review or approved).`}
      searchParams={searchParams}
      defaults={{ sort: "score_desc", minScore: TRENDING_THRESHOLD }}
      fixed={{ reviewStatuses: ["pending", "approved"] }}
      emptyTitle="Nothing trending"
      emptyHint="No active clips meet the trending threshold right now."
    />
  );
}
