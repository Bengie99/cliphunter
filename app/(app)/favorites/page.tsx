import { ClipListPage } from "@/components/clips/clip-list-page";
import type { SearchParams } from "@/lib/query-params";

export const metadata = { title: "Favorites" };

export default function FavoritesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ClipListPage
      title="Favorites"
      description="Clips you saved for later."
      searchParams={searchParams}
      fixed={{ favoritesOnly: true }}
      emptyTitle="No favorites yet"
      emptyHint="Press S in the review queue, or the star on any clip, to save it here."
    />
  );
}
