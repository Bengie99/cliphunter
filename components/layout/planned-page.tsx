import { Construction } from "lucide-react";
import { PageHeader } from "./page-header";

/**
 * Clearly-labelled development placeholder for pages scheduled in a later
 * phase. Contains no controls that pretend to work.
 */
export function PlannedPage({
  title,
  phase,
  summary,
  features,
  children,
}: {
  title: string;
  phase: number;
  summary: string;
  features: string[];
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} />
      <div className="rounded-xl border border-dashed bg-card/50 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-violet-300">
            <Construction className="size-4" />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Planned for Phase {phase}</p>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{summary}</p>
            </div>
            <ul className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-zinc-500" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
