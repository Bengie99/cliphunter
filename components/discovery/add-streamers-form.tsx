"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addTwitchStreamersAction } from "@/app/discovery-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AddStreamersForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string | null>(null);

  function submit() {
    start(async () => {
      const res = await addTwitchStreamersAction(text);
      if (!res.ok) return void toast.error(res.error);
      const { added, notFound, invalid } = res.data;
      if (added.length) toast.success(`Monitoring ${added.length} streamer${added.length === 1 ? "" : "s"}: ${added.join(", ")}`);
      const issues = [
        notFound.length ? `Not found on Twitch: ${notFound.join(", ")}` : null,
        invalid.length ? `Not a valid channel name: ${invalid.join(", ")}` : null,
      ].filter(Boolean);
      setProblems(issues.length ? issues.join(" · ") : null);
      // keep only the entries that need fixing in the box
      setText([...notFound, ...invalid].join("\n"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={"Twitch channel names or links — one per line or comma-separated\nkaicenat, xqc, https://twitch.tv/jynxzi"}
      />
      {problems && <p className="text-xs text-amber-300">{problems}</p>}
      <Button onClick={submit} disabled={pending || !text.trim()} size="sm">
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add & monitor
      </Button>
    </div>
  );
}
