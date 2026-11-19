import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDataMode, integrationEnvStatus } from "@/lib/env";
import { DEFAULT_WEIGHTS, TRENDING_THRESHOLD } from "@/lib/scoring";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  const mode = getDataMode();
  const env = integrationEnvStatus();
  const rows: [string, boolean, string][] = [
    ["Supabase (database + auth)", env.supabase, "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ["Supabase service role (workers)", env.supabaseServiceRole, "SUPABASE_SERVICE_ROLE_KEY — needed for discovery"],
    ["Redis (job queue)", env.redis, "REDIS_URL — Phase 2"],
    ["OpenAI (AI features)", env.openai, "OPENAI_API_KEY — future"],
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data source</CardTitle>
            {mode === "demo" ? <Badge variant="warning">Demo mode</Badge> : <Badge variant="success">Supabase</Badge>}
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {mode === "demo" ? (
              <>
                <p>
                  Using local sample data in <code>.data/demo-db.json</code>. Nothing is written to a real database. Reset it with{" "}
                  <code>npm run demo:reset</code>.
                </p>
                <p>To switch to production data, add your Supabase keys to <code>.env.local</code>, run the migration, and restart the dev server.</p>
              </>
            ) : (
              <p>Connected to Supabase. All data is protected by row-level security and scoped to your account.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {rows.map(([label, ok, hint]) => (
                <li key={label} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm">{label}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{hint}</p>
                  </div>
                  {ok ? <Badge variant="success">Set</Badge> : <Badge variant="outline">Not set</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Viral score model</CardTitle>
            <Badge variant="outline">Editable in Phase 3</Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["Views per hour", DEFAULT_WEIGHTS.viewsPerHour],
                  ["Engagement rate", DEFAULT_WEIGHTS.engagement],
                  ["Recent view growth", DEFAULT_WEIGHTS.growth],
                  ["Creator relevance", DEFAULT_WEIGHTS.creator],
                ] as const
              ).map(([k, w]) => (
                <div key={k} className="rounded-lg border bg-surface px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{k}</div>
                  <div className="text-lg font-semibold tabular-nums">{Math.round(w * 100)}%</div>
                </div>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each component is log-normalised to 0–100. Missing metrics (e.g. Twitch has no likes; growth needs two snapshots) are dropped and the
              remaining weights re-normalised, so clips aren&apos;t penalised for data a platform doesn&apos;t expose. Trending threshold: {TRENDING_THRESHOLD}.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
