"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addTwitchStreamersAction, addYouTubeChannelsAction } from "@/app/discovery-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DiscoveryPlatform } from "@/lib/discovery/settings";

const PLACEHOLDER: Record<DiscoveryPlatform, string> = {
  twitch: "Twitch channel names or links, one per line or comma-separated\nkaicenat, xqc, https://twitch.tv/jynxzi",
  youtube: "YouTube @handles or channel links, one per line (a pasted Name/URL table works too)\nhttps://www.youtube.com/@IShowSpeed\n@TypicalGamer",
};

export function AddStreamersForm({ platform }: { platform: DiscoveryPlatform }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string | null>(null);

  function submit() {
    start(async () => {
      const res = await (platform === "twitch" ? addTwitchStreamersAction : addYouTubeChannelsAction)(text);
      if (!res.ok) return void toast.error(res.error);
      const { added, notFound, invalid } = res.data;
      if (added.length) toast.success(`Monitoring ${added.length} channel${added.length === 1 ? "" : "s"}`);
      const issues = [
        notFound.length ? `Not found: ${notFound.join(", ")}` : null,
        invalid.length ? `Couldn't read: ${invalid.join(", ")}` : null,
      ].filter(Boolean);
      setProblems(issues.length ? issues.join(" · ") : null);
      // keep only the entries that need fixing in the box
      setText([...notFound, ...invalid].join("\n"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={PLACEHOLDER[platform]} />
      {problems && <p className="text-xs text-amber-300">{problems}</p>}
      <Button onClick={submit} disabled={pending || !text.trim()} size="sm">
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add & monitor
      </Button>
    </div>
  );
}
