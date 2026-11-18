import { ClipListPage } from "@/components/clips/clip-list-page";
import type { SearchParams } from "@/lib/query-params";

export const metadata = { title: "Rejected / Archived" };

export default function ArchivedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ClipListPage
      title="Rejected / Archived"
      description="Clips you passed on. Use Restore to send one back to the review queue."
      searchParams={searchParams}
      fixed={{ reviewStatuses: ["rejected", "archived"] }}
      emptyTitle="Nothing here"
      emptyHint="Rejected and archived clips will appear here."
    />
  );
}
