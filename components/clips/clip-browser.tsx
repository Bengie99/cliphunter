"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Inbox, Loader2, RotateCcw, Star, StarOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Clip } from "@/lib/types";
import { ClipCard, ClipRow } from "./clip-card";
import { NotesDialog, PreviewDialog } from "./clip-dialogs";
import { useClipActions } from "./use-clip-actions";

export function ClipBrowser({
  clips,
  view,
  emptyTitle = "No clips found",
  emptyHint = "Try adjusting your filters, or add a clip by URL.",
}: {
  clips: Clip[];
  view: "grid" | "list";
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [notesId, setNotesId] = useState<string | null>(null);
  const { setReview, setFavorite, isPending } = useClipActions();

  // Drop selections that are no longer on the page (after filtering/paging/actions)
  const ids = useMemo(() => new Set(clips.map((c) => c.id)), [clips]);
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [ids]);

  // Look clips up by id so dialogs always reflect the latest server data
  const previewClip = clips.find((c) => c.id === previewId) ?? null;
  const notesClip = clips.find((c) => c.id === notesId) ?? null;

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const allSelected = clips.length > 0 && selected.size === clips.length;
  const someSelected = selected.size > 0 && !allSelected;
  const selIds = [...selected];
  const clear = () => setSelected(new Set());

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
        <Inbox className="mb-3 size-8 text-muted-foreground" />
        <p className="font-medium">{emptyTitle}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => setSelected(v === true ? new Set(clips.map((c) => c.id)) : new Set())}
            aria-label="Select all on this page"
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all"}
        </label>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card px-1.5 py-1 animate-in fade-in-0">
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setReview(selIds, "approved", { onDone: clear })}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setReview(selIds, "rejected", { onDone: clear })}>
              <X /> Reject
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setReview(selIds, "archived", { onDone: clear })}>
              <Archive /> Archive
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setReview(selIds, "pending", { onDone: clear })}>
              <RotateCcw /> To queue
            </Button>
            <span className="mx-1 h-4 w-px bg-border" />
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setFavorite(selIds, true)}>
              <Star /> Favorite
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setFavorite(selIds, false)}>
              <StarOff /> Unfavorite
            </Button>
            {isPending && <Loader2 className="mx-1 size-4 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {clips.map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              selected={selected.has(c.id)}
              onSelectedChange={(on) => toggle(c.id, on)}
              onPreview={() => setPreviewId(c.id)}
              onNotes={() => setNotesId(c.id)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[auto_112px_minmax(0,1fr)_90px_70px_64px_110px_auto] gap-3 border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span className="w-4" />
            <span />
            <span>Clip</span>
            <span>Views</span>
            <span>Length</span>
            <span>Score</span>
            <span>Status</span>
            <span className="w-[164px] text-right">Actions</span>
          </div>
          {clips.map((c) => (
            <ClipRow
              key={c.id}
              clip={c}
              selected={selected.has(c.id)}
              onSelectedChange={(on) => toggle(c.id, on)}
              onPreview={() => setPreviewId(c.id)}
              onNotes={() => setNotesId(c.id)}
            />
          ))}
        </div>
      )}

      <PreviewDialog clip={previewClip} onOpenChange={(o) => !o && setPreviewId(null)} />
      <NotesDialog clip={notesClip} onOpenChange={(o) => !o && setNotesId(null)} />
    </div>
  );
}
