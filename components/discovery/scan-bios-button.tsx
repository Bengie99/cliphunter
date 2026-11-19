"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { scanCreatorBiosAction } from "@/app/discovery-actions";
import { Button } from "@/components/ui/button";

export function ScanBiosButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      title="Reads every creator's Twitch and YouTube bio and shows any sentence about clipping, re-uploads or copyright"
      onClick={() =>
        start(async () => {
          const res = await scanCreatorBiosAction();
          if (!res.ok) return void toast.error(res.error);
          const { scanned, mentions, failed } = res.data;
          toast.success(`Scanned ${scanned} bios — ${mentions} mention clipping or copyright`);
          failed.forEach((f) => toast.error(f));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <ScanSearch />} Scan bios for clipping policy
    </Button>
  );
}
