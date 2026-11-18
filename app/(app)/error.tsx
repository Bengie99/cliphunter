"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 px-6 py-16 text-center">
      <AlertTriangle className="mb-3 size-7 text-red-400" />
      <p className="font-medium">Something went wrong loading this page</p>
      <p className="mt-1 max-w-lg break-words text-sm text-muted-foreground">{error.message || "Unknown error"}</p>
      {error.message?.includes("relation") && (
        <p className="mt-2 max-w-lg text-xs text-muted-foreground">Have you run the database migration? See README → “Database setup”.</p>
      )}
      <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
