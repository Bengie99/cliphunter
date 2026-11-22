"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type Row = { user_id: string; hostname: string | null; activity: string | null; last_seen: string; version: string | null };

const ONLINE_MS = 90_000;
const POLL_MS = 20_000;

/**
 * Shows whether each team member's background helper is running (it reports
 * in every 30 s), so nobody needs to look at a console window.
 */
export function HelperStatus({ className }: { className?: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    let alive = true;
    void sb.auth.getUser().then(({ data }) => alive && setMe(data.user?.id ?? null));
    const load = async () => {
      const { data, error } = await sb.from("helper_status").select("user_id, hostname, activity, last_seen, version");
      if (alive) setRows(error ? [] : (data as Row[]));
    };
    void load();
    const t = setInterval(() => {
      void load();
      tick((n) => n + 1);
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (rows == null) return null;
  const online = (r: Row) => Date.now() - new Date(r.last_seen).getTime() < ONLINE_MS;
  const mine = rows.find((r) => r.user_id === me);
  const others = rows.filter((r) => r.user_id !== me && online(r));
  const ok = mine && online(mine);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}>
      <span
        className="inline-flex items-center gap-1.5"
        title={
          ok
            ? `${mine!.hostname ?? "your PC"} · helper ${mine!.version ?? ""}`
            : "Start “ClipHunter Helper” on your PC (it runs in the background with a tray icon and starts with Windows)."
        }
      >
        <span className={cn("size-2 rounded-full", ok ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" : "bg-zinc-500")} />
        <span className={ok ? "text-foreground" : "text-muted-foreground"}>
          {ok ? `Helper online${mine!.activity && mine!.activity !== "Idle" ? ` · ${mine!.activity}` : ""}` : "Your helper is offline"}
        </span>
      </span>
      {others.map((r) => (
        <span key={r.user_id} className="inline-flex items-center gap-1.5 text-muted-foreground" title={r.activity ?? ""}>
          <span className="size-2 rounded-full bg-emerald-400/70" />
          Teammate&apos;s helper ({r.hostname ?? "PC"}) online
        </span>
      ))}
    </div>
  );
}
