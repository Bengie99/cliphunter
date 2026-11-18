import { Radar } from "lucide-react";
import { AddClipForm } from "@/components/clips/add-clip-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Discover Clips" };

const FORMATS: [string, string[]][] = [
  ["Twitch", ["clips.twitch.tv/<slug>", "twitch.tv/<channel>/clip/<slug>", "twitch.tv/videos/<id>"]],
  ["YouTube", ["youtube.com/shorts/<id>", "youtube.com/watch?v=<id>", "youtu.be/<id>"]],
  ["Kick", ["kick.com/<channel>/clips/<clip_id>", "kick.com/<channel>?clip=<clip_id>"]],
  ["TikTok", ["tiktok.com/@<user>/video/<id>", "vm.tiktok.com/<code> (short link)"]],
  ["Instagram", ["instagram.com/reel/<id>", "instagram.com/p/<id>"]],
];

export default function DiscoverPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Discover Clips" description="Add clips you find by URL. Automated discovery from platform APIs arrives in Phase 2." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Add clip by URL</CardTitle>
          </CardHeader>
          <CardContent>
            <AddClipForm />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Supported URL formats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {FORMATS.map(([name, list]) => (
                <div key={name}>
                  <p className="text-xs font-medium">{name}</p>
                  <ul className="mt-1 space-y-0.5">
                    {list.map((f) => (
                      <li key={f}>
                        <code className="text-[11px] text-muted-foreground">{f}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
                Title, creator and thumbnail are prefilled automatically for YouTube and TikTok via their public oEmbed endpoints.
                Other platforms need their API integration (Phase 2) — until then, fill in details by hand.
              </p>
            </CardContent>
          </Card>
          <Card className="border-dashed bg-card/50">
            <CardContent className="flex gap-3 pt-5">
              <Radar className="mt-0.5 size-4 shrink-0 text-violet-300" />
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Automated discovery — Phase 2</p>
                <p>
                  Scheduled jobs will pull clips from the Twitch Helix and YouTube Data APIs by streamer and game (e.g. Grand Theft Auto IV), every 15
                  minutes by default, with minimum views, max duration and date-range filters.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
