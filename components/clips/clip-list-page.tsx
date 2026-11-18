import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getRepository } from "@/lib/data";
import { parseClipSearchParams, type SearchParams } from "@/lib/query-params";
import type { ClipQuery } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { ClipBrowser } from "./clip-browser";
import { ClipFilters } from "./clip-filters";

/**
 * Shared server component behind All Clips, Trending, Approved, Archived…
 * `fixed` overrides whatever the URL says (e.g. Approved always filters by
 * review_status = approved).
 */
export async function ClipListPage({
  title,
  description,
  searchParams,
  fixed,
  defaults,
  emptyTitle,
  emptyHint,
  actions,
}: {
  title: string;
  description?: string;
  searchParams: SearchParams;
  fixed?: Partial<ClipQuery>;
  defaults?: Partial<ClipQuery>;
  emptyTitle?: string;
  emptyHint?: string;
  actions?: React.ReactNode;
}) {
  const { query, view } = parseClipSearchParams(searchParams);
  const repo = getRepository();
  const finalQuery: ClipQuery = { ...defaults, ...stripUndefined(query), ...fixed };
  const [page, categories, creators] = await Promise.all([repo.listClips(finalQuery), repo.listCategories(), repo.listCreators()]);

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") sp.set(k, v);
    sp.set("page", String(p));
    return `?${sp.toString()}`;
  };
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);

  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} actions={actions} />
      <ClipFilters
        categories={categories}
        creators={creators.map(({ id, name, platform }) => ({ id, name, platform }))}
        hideStatus={Boolean(fixed?.reviewStatuses)}
        defaultSort={defaults?.sort}
      />
      <ClipBrowser clips={page.clips} view={view} emptyTitle={emptyTitle} emptyHint={emptyHint} />
      {page.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {from}–{to} of {page.total}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <PagerButton href={pageHref(page.page - 1)} disabled={page.page <= 1} label="Previous page">
                <ChevronLeft />
              </PagerButton>
              <span className="px-2 tabular-nums">
                Page {page.page} / {totalPages}
              </span>
              <PagerButton href={pageHref(page.page + 1)} disabled={page.page >= totalPages} label="Next page">
                <ChevronRight />
              </PagerButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PagerButton({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <Button size="icon-sm" variant="outline" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild size="icon-sm" variant="outline">
      <Link href={href} aria-label={label} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
