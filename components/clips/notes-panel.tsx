"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addNoteAction, deleteNoteAction, listNotesAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import type { ClipNote } from "@/lib/types";

export function NotesPanel({ clipId, autoFocus }: { clipId: string; autoFocus?: boolean }) {
  const [notes, setNotes] = useState<ClipNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, startSaving] = useTransition();

  const load = useCallback(async () => {
    setNotes(null);
    setError(null);
    const res = await listNotesAction(clipId);
    if (res.ok) setNotes(res.data);
    else setError(res.error);
  }, [clipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    startSaving(async () => {
      const res = await addNoteAction(clipId, text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setNotes((n) => [res.data, ...(n ?? [])]);
      setDraft("");
    });
  };

  const remove = (id: string) => {
    const prev = notes;
    setNotes((n) => n?.filter((x) => x.id !== id) ?? null);
    void deleteNoteAction(id).then((res) => {
      if (!res.ok) {
        toast.error(res.error);
        setNotes(prev);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={draft}
          autoFocus={autoFocus}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            e.stopPropagation(); // keep review-queue shortcuts from firing while typing
          }}
          placeholder="Add an internal note… (Ctrl+Enter to save)"
          maxLength={5000}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={saving || !draft.trim()}>
            {saving && <Loader2 className="animate-spin" />} Save note
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
          <Button size="sm" variant="ghost" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {notes === null && !error && (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}
      {notes?.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
      <ul className="space-y-2">
        {notes?.map((n) => (
          <li key={n.id} className="group rounded-md border bg-surface px-3 py-2">
            <p className="whitespace-pre-wrap text-sm">{n.note}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove(n.id)}
                aria-label="Delete note"
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
