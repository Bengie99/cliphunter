import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { PlatformBadge, ScoreBadge } from "@/components/clips/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, PIPELINE_LABEL, timeAgo } from "@/lib/format";
import { PLATFORM_META } from "@/lib/platforms";
import { PIPELINE_STATUSES, PLATFORMS, type Clip, type DashboardStats } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, icon: Icon, href, hint }: { label: string; value: number; icon: LucideIcon; href?: string; hint?: string }) {
  const body = (
    <Card className={cn("p-4 transition-colors", href && "hover:border-zinc-600")}>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs font-medium">{label}</span>
        <Icon className="size-4" />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value.toLocaleString("en-US")}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function SectionCard({ title, href, children, className }: { title: string; href?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            View all <ArrowRight className="size-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

/** Compact clip list for dashboard sections. Links into the relevant page. */
export function MiniClipList({ clips, empty, linkFor }: { clips: Clip[]; empty: string; linkFor: (c: Clip) => string }) {
  if (!clips.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-2 space-y-0.5">
      {clips.map((c) => (
        <li key={c.id}>
          <Link href={linkFor(c)} className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]">
            <PlatformBadge platform={c.platform} compact className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{c.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {c.creator_name ?? "Unknown"} · {formatCount(c.views)} views · {timeAgo(c.discovered_at)}
              </p>
            </div>
            <ScoreBadge score={c.viral_score} className="shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PlatformActivity({ byPlatform }: { byPlatform: DashboardStats["byPlatform"] }) {
  const max = Math.max(1, ...Object.values(byPlatform));
  return (
    <ul className="space-y-3">
      {PLATFORMS.map((p) => (
        <li key={p}>
          <Link href={`/clips?platform=${p}`} className="group block">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground group-hover:text-foreground">{PLATFORM_META[p].label}</span>
              <span className="font-medium tabular-nums">{byPlatform[p]}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
              <div className="h-full rounded-full" style={{ width: `${(byPlatform[p] / max) * 100}%`, backgroundColor: PLATFORM_META[p].color, opacity: 0.85 }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PipelineSummary({ byPipeline }: { byPipeline: DashboardStats["byPipeline"] }) {
  return (
    <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
      {PIPELINE_STATUSES.map((s, i) => (
        <li key={s} className={cn("rounded-lg border bg-surface px-2.5 py-2", byPipeline[s] === 0 && "opacity-60")}>
          <div className="text-[10px] text-muted-foreground">
            {i + 1}. {PIPELINE_LABEL[s]}
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{byPipeline[s]}</div>
        </li>
      ))}
    </ol>
  );
}
