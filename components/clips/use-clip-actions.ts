"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setFavoriteAction, setReviewStatusAction } from "@/app/actions";
import type { ReviewStatus } from "@/lib/types";

const REVIEW_TOAST: Record<ReviewStatus, string> = {
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
  pending: "Moved back to review queue",
};

/** Shared mutations for clip cards, rows, bulk bars and the review queue. */
export function useClipActions() {
  const [isPending, startTransition] = useTransition();

  const setReview = (ids: string[], status: ReviewStatus, opts?: { silent?: boolean; onDone?: () => void }) =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        const res = await setReviewStatusAction(ids, status);
        if (!res.ok) {
          toast.error(res.error);
          resolve(false);
          return;
        }
        if (!opts?.silent) {
          toast.success(ids.length > 1 ? `${REVIEW_TOAST[status]}: ${res.data.count} clips` : REVIEW_TOAST[status]);
        }
        opts?.onDone?.();
        resolve(true);
      }),
    );

  const setFavorite = (ids: string[], favorite: boolean, opts?: { silent?: boolean }) =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        const res = await setFavoriteAction(ids, favorite);
        if (!res.ok) {
          toast.error(res.error);
          resolve(false);
          return;
        }
        if (!opts?.silent) {
          const n = ids.length > 1 ? ` (${ids.length})` : "";
          toast.success(favorite ? `Saved to favorites${n}` : `Removed from favorites${n}`);
        }
        resolve(true);
      }),
    );

  return { isPending, setReview, setFavorite };
}
