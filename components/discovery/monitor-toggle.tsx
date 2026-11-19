"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setCreatorMonitoredAction } from "@/app/discovery-actions";
import { Badge } from "@/components/ui/badge";

export function MonitorToggle({ creatorId, monitored, enabled }: { creatorId: string; monitored: boolean; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const badge = monitored ? <Badge variant="success">Monitored</Badge> : <Badge variant="outline">Not monitored</Badge>;
  if (!enabled) return badge;
  return (
    <button
      type="button"
      disabled={pending}
      className="disabled:opacity-50"
      title={monitored ? "Stop monitoring" : "Monitor this streamer"}
      onClick={() =>
        start(async () => {
          const res = await setCreatorMonitoredAction(creatorId, !monitored);
          if (!res.ok) toast.error(res.error);
          else router.refresh();
        })
      }
    >
      {badge}
    </button>
  );
}
