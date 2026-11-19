-- ClipHunter — Phase 2: automated discovery
--
-- Adds a minimum clip length to discovery settings, a per-creator
-- "last discovered" marker and a log of every discovery run.
-- Discovery itself runs server-side with the service-role key, which
-- bypasses RLS, so every write sets owner_id explicitly.

alter table public.discovery_settings
  add column if not exists minimum_duration integer
    check (minimum_duration is null or minimum_duration >= 0);

alter table public.creators
  add column if not exists last_discovered_at timestamptz;

-- ---------------------------------------------------------------------------
-- discovery_runs — one row per platform per run (scheduled or manual)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  platform text not null check (platform in ('twitch','youtube','kick','tiktok','instagram')),
  trigger text not null default 'schedule' check (trigger in ('schedule','manual')),
  status text not null default 'running' check (status in ('running','success','partial','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  clips_seen integer not null default 0,
  clips_new integer not null default 0,
  clips_updated integer not null default 0,
  -- Short, human-readable messages (e.g. "Streamer foo not found"). Never secrets.
  messages text[] not null default '{}'
);
create index if not exists discovery_runs_owner_idx on public.discovery_runs (owner_id, platform, started_at desc);

alter table public.discovery_runs enable row level security;
-- Users can read their own run log; only the server (service role) writes it.
create policy "discovery_runs: owner read" on public.discovery_runs
  for select to authenticated using (owner_id = auth.uid());
