"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyPathButton({ path }: { path: string }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      title="Copy full file path"
      aria-label="Copy full file path"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(path);
          toast.success("Path copied — paste it into File Explorer's address bar");
        } catch {
          toast.error("Couldn't copy. Path: " + path);
        }
      }}
    >
      <Copy />
    </Button>
  );
}
