import { ClipListPage } from "@/components/clips/clip-list-page";
import type { SearchParams } from "@/lib/query-params";

export const metadata = { title: "All Clips" };

export default function AllClipsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ClipListPage
      title="All Clips"
      description="Every clip in your library. Filter, search, and act in bulk."
      searchParams={searchParams}
    />
  );
}
