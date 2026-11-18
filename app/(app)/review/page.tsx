import { PageHeader } from "@/components/layout/page-header";
import { ReviewQueue } from "@/components/review/review-queue";
import { getRepository } from "@/lib/data";
import type { SearchParams } from "@/lib/query-params";
import type { ClipSort } from "@/lib/types";

export const metadata = { title: "Review Queue" };

const QUEUE_SORTS: ClipSort[] = ["score_desc", "discovered_desc", "views_desc"];
const BATCH = 100;

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const sortParam = typeof searchParams.sort === "string" ? searchParams.sort : "";
  const sort = (QUEUE_SORTS as string[]).includes(sortParam) ? (sortParam as ClipSort) : "score_desc";
  const clipParam = typeof searchParams.clip === "string" ? searchParams.clip : undefined;

  const repo = getRepository();
  const page = await repo.listClips({ reviewStatuses: ["pending"], sort, pageSize: BATCH });

  // Deep link to a pending clip that isn't in the first batch: put it on top.
  let clips = page.clips;
  if (clipParam && !clips.some((c) => c.id === clipParam)) {
    const target = await repo.getClip(clipParam);
    if (target?.review_status === "pending") clips = [target, ...clips];
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Review Queue" description="Decide which clips are worth using. Keyboard: A approve · R reject · S save · N/P navigate." />
      <ReviewQueue
        // Remount when the sort changes so local state starts fresh
        key={sort}
        clips={clips}
        total={Math.max(page.total, clips.length)}
        initialClipId={clips.some((c) => c.id === clipParam) ? clipParam : undefined}
      />
    </div>
  );
}
