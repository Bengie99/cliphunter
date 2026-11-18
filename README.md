# ClipHunter

Private clip discovery, review and content-pipeline tool for a YouTube clipping channel.
Built with Next.js 14 (App Router) · TypeScript · Tailwind · shadcn/ui-style components · Supabase.

**Status: Phase 1 (core application) complete.** See [Roadmap](#roadmap).

---

## Quick start (demo mode, no accounts needed)

```bash
npm install
npm run dev          # http://localhost:3000
```

Without Supabase keys the app runs in **demo mode**: realistic sample data (fictional GTA IV
streamers) lives in a local file, `.data/demo-db.json`, and is never written to a real
database. Everything works: reviewing, favorites, notes, adding clips by URL.

```bash
npm run demo:reset   # wipe demo data; it re-seeds on next page load
```

## Production setup (Supabase)

1. **Create a project** at [supabase.com](https://supabase.com) (the free tier is fine).
2. **Run the migration**. Either:
   - paste [`supabase/migrations/20261118000000_init.sql`](supabase/migrations/20261118000000_init.sql) into *SQL Editor → New query → Run*, or
   - with the Supabase CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. **Create your user**: *Authentication → Users → Add user* (email + password, tick "auto confirm").
4. **Disable public sign-ups** (it's a private tool): *Authentication → Sign In / Providers → Email → disable "Allow new users to sign up"*.
5. **Configure env**: copy `.env.example` to `.env.local` and set
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (*Project Settings → API*).
6. Restart `npm run dev`. You'll be sent to `/login`.

Demo data is never copied into Supabase: production starts empty.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Smoke tests: URL parsing, viral score, and every repository operation (uses a temp DB) |
| `npm run demo:reset` | Delete local demo data |

## Environment variables

All variables are documented in [`.env.example`](.env.example). Only `NEXT_PUBLIC_*` values reach the browser;
everything else is server-only.

| Variable | Phase | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 1 | Database + auth. Leave empty for demo mode |
| `CLIPHUNTER_DATA_MODE=demo` | 1 | Optional: force demo mode |
| `SUPABASE_SERVICE_ROLE_KEY` | 2 | Background workers (bypasses RLS; never expose) |
| `REDIS_URL` | 2 | BullMQ job queue |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | 2 | Twitch Helix |
| `YOUTUBE_API_KEY` | 2 | YouTube Data API v3 |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | 2 | Kick API |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | 2 | TikTok (requires approval) |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | 2 | Instagram Graph API |
| `OPENAI_API_KEY` | future | Transcripts, summaries, title ideas |

## Architecture

```
app/
  (app)/            authenticated app shell (sidebar + top bar) and all pages
  actions.ts        server actions: the only mutation entry point (zod-validated)
  login/, auth/     Supabase email/password sign-in & sign-out
components/
  clips/            clip card/row, browser (grid/list + bulk), filters, dialogs, add-clip form, embed player
  review/           review queue workspace (keyboard driven)
  dashboard/        stat cards, discovery chart, platform/pipeline widgets
  layout/           app shell, nav, page header, "planned for phase N" placeholder
  ui/               shadcn/ui-style primitives
lib/
  data/             ClipRepository interface + SupabaseRepository + DemoRepository (+ demo seed)
  platforms.ts      URL parsing, platform metadata, official embed URLs
  scoring.ts        viral score model
  metadata/         URL → metadata lookup (public oEmbed only)
  supabase/         server client + session middleware
supabase/migrations SQL migrations (schema, RLS, triggers, RPC)
scripts/            smoke tests
```

- **One repository interface, two backends.** Pages and actions only call `getRepository()`, which
  returns the Supabase implementation when keys are set and the local demo store otherwise. Phase 2
  integrations will write through the same interface.
- **Auth**: `middleware.ts` refreshes the Supabase session on every request and redirects
  unauthenticated users to `/login`. Skipped entirely in demo mode.
- **Multi-user ready**: every table has `owner_id` (default `auth.uid()`) with owner-only RLS. Adding
  users later needs no schema change.

### Database

Defined in the migration: `users`, `platform_integrations`, `creators`, `clips`, `clip_metrics_history`,
`clip_files`, `clip_pipeline_history`, `discovery_settings`, `clip_favorites`, `clip_notes`.

- Duplicates are prevented by `unique (owner_id, platform, external_clip_id)`, checked before insert
  and handled again on race (`23505`).
- Triggers record a metrics snapshot whenever views/likes/comments change, and a pipeline-history row
  whenever `pipeline_status` changes, so Phase 3 growth scoring and Phase 5 history already have data.
- `engagement_rate` is a generated column (sortable).
- `dashboard_stats()` is a `security invoker` RPC, so RLS applies to dashboard aggregates.
- Status columns use `text + CHECK` rather than enums, which makes them easier to evolve in later migrations.
- Deviation from the brief: notes live only in `clip_notes` (many timestamped notes per clip) rather than
  also in a `clips.notes` column, to avoid two sources of truth.

### Viral score (`lib/scoring.ts`)

Weights from the brief: views per hour 35%, engagement 25%, recent growth 25%, creator relevance 15%.
Each component is log-normalised to 0–100. Missing components (e.g. Twitch has no likes; growth needs two
snapshots) are dropped and the remaining weights re-normalised. Because the main term is views *per hour*,
old clips don't outrank fresh fast-movers on total views. Tiers: 0–30 low, 31–60 interesting, 61–80 high,
81–100 viral candidate. Manually added clips get a score once views and upload date are provided.

## Compliance

- Previews use each platform's **official embed player** (YouTube, Twitch, TikTok, Instagram). Video is never proxied or downloaded. Kick has no clip embed, so the app links out instead.
- Metadata for manual submissions comes only from **public, keyless oEmbed** (YouTube, TikTok). There is no scraping.
- `rights_status` is tracked separately per clip (unknown → publicly discoverable → preview allowed → download authorized → republish authorized). **Discovery never implies permission to republish.**
- The Download button stays disabled until Phase 4, and even then only works for clips with an authorized source.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Next.js + Supabase setup, auth, schema, navigation, dashboard, clip cards, All Clips, Review Queue, manual URL submission, favorites & notes | ✅ Done |
| 2 | Twitch Helix + YouTube Data API integrations, Kick/TikTok/Instagram investigation, BullMQ scheduled discovery, metadata sync | Next |
| 3 | Growth-based scoring from snapshots, trending detection, creator monitoring, analytics, editable score weights | |
| 4 | Authorized downloads, uploads, FFmpeg metadata, Downloaded Footage page | |
| 5 | Kanban pipeline, editing notes, publishing metadata & history | |

Pages for later phases exist in the sidebar (tagged P2–P5) and show what's planned. They contain no
controls that pretend to work.

## Requirements & notes

- **Node.js ≥ 18.17**. Node 18 is end-of-life, so **upgrading to Node 20 or 22 LTS is recommended**. On Node 18,
  `@supabase/supabase-js` is pinned to 2.78 (newer versions require Node 22) and Next.js is on 14.2.
  After upgrading Node you can move to the latest Supabase SDK and Next.js 15.
- Twitch embeds require the page's hostname as a `parent` parameter; this is set automatically from `window.location`.
- Deployment: any Node host or Vercel. Set the same env vars there. Demo mode writes to the local filesystem,
  so use Supabase mode in serverless deployments.
