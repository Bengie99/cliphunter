import { ClipListPage } from "@/components/clips/clip-list-page";
import type { SearchParams } from "@/lib/query-params";

export const metadata = { title: "Approved Clips" };

export default function ApprovedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ClipListPage
      title="Approved Clips"
      description="Clips you've approved for editing. Approval is your editorial decision — check rights before republishing."
      searchParams={searchParams}
      fixed={{ reviewStatuses: ["approved"] }}
      emptyTitle="No approved clips yet"
      emptyHint="Approve clips from the review queue and they'll show up here."
    />
  );
}
