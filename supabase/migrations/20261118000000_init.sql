-- ClipHunter — initial schema (Phase 1)
--
-- Multi-user ready: every row has an owner_id that defaults to auth.uid(),
-- and RLS restricts all access to the owner. The app is single-user today;
-- adding users later requires no schema change.
--
-- Background workers (Phase 2) will use the service-role key, which bypasses
-- RLS, so they must set owner_id explicitly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- users: mirror of auth.users for app-level references
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill any users that existed before this migration
insert into public.users (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- platform_integrations
-- ---------------------------------------------------------------------------
create table public.platform_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  platform text not null check (platform in ('twitch','youtube','kick','tiktok','instagram')),
  connection_status text not null default 'disconnected'
    check (connection_status in ('disconnected','connected','error','not_supported')),
  -- Reference to a secret stored elsewhere (e.g. Supabase Vault). Never store raw secrets here.
  encrypted_credentials_reference text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, platform)
);
create trigger trg_platform_integrations_updated before update on public.platform_integrations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- creators
-- ---------------------------------------------------------------------------
create table public.creators (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  platform text not null check (platform in ('twitch','youtube','kick','tiktok','instagram')),
  external_creator_id text not null,
  name text not null,
  profile_url text,
  profile_image text,
  category text,
  is_monitored boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, platform, external_creator_id)
);
create index creators_owner_idx on public.creators (owner_id);

-- ---------------------------------------------------------------------------
-- clips
-- ---------------------------------------------------------------------------
create table public.clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  platform text not null check (platform in ('twitch','youtube','kick','tiktok','instagram')),
  external_clip_id text not null,
  creator_id uuid references public.creators (id) on delete set null,
  -- Denormalised for fast search/sort; source of truth for name is creators.name
  creator_name text,
  creator_url text,
  title text not null,
  description text,
  original_url text not null,
  thumbnail_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  views bigint check (views is null or views >= 0),
  likes bigint check (likes is null or likes >= 0),
  comments bigint check (comments is null or comments >= 0),
  engagement_rate numeric generated always as (
    case when views > 0 and (likes is not null or comments is not null)
      then (coalesce(likes, 0) + coalesce(comments, 0))::numeric / views end
  ) stored,
  category text,
  language text,
  uploaded_at timestamptz,
  discovered_at timestamptz not null default now(),
  last_checked_at timestamptz,
  viral_score smallint check (viral_score is null or viral_score between 0 and 100),
  review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected','archived')),
  pipeline_status text not null default 'awaiting_review'
    check (pipeline_status in ('discovered','awaiting_review','approved','ready_for_download','downloaded',
                               'ready_for_editing','editing','edited','ready_to_publish','published')),
  rights_status text not null default 'unknown'
    check (rights_status in ('unknown','public_discoverable','preview_allowed','download_authorized','republish_authorized')),
  download_status text not null default 'not_available'
    check (download_status in ('not_available','awaiting_authorization','ready','downloading','downloaded','failed')),
  source text not null default 'manual' check (source in ('manual','discovery')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Duplicate prevention: platform + external id, per owner
  unique (owner_id, platform, external_clip_id)
);
create index clips_owner_discovered_idx on public.clips (owner_id, discovered_at desc);
create index clips_owner_review_idx on public.clips (owner_id, review_status, discovered_at desc);
create index clips_owner_score_idx on public.clips (owner_id, viral_score desc nulls last);
create index clips_owner_views_idx on public.clips (owner_id, views desc nulls last);
create index clips_creator_idx on public.clips (creator_id);
create trigger trg_clips_updated before update on public.clips
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- clip_metrics_history — snapshots used for growth calculation (Phase 3)
-- ---------------------------------------------------------------------------
create table public.clip_metrics_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  views bigint,
  likes bigint,
  comments bigint,
  recorded_at timestamptz not null default now()
);
create index clip_metrics_history_clip_idx on public.clip_metrics_history (clip_id, recorded_at);

create or replace function public.record_clip_metrics()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT'
     or new.views is distinct from old.views
     or new.likes is distinct from old.likes
     or new.comments is distinct from old.comments then
    if new.views is not null or new.likes is not null or new.comments is not null then
      insert into public.clip_metrics_history (owner_id, clip_id, views, likes, comments)
      values (new.owner_id, new.id, new.views, new.likes, new.comments);
    end if;
  end if;
  return new;
end $$;
create trigger trg_clips_metrics after insert or update on public.clips
  for each row execute function public.record_clip_metrics();

-- ---------------------------------------------------------------------------
-- clip_files — downloaded / uploaded footage (Phase 4)
-- ---------------------------------------------------------------------------
create table public.clip_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  duration_seconds numeric,
  resolution text,
  checksum_sha256 text,
  source_url text,
  rights_status text not null default 'unknown'
    check (rights_status in ('unknown','public_discoverable','preview_allowed','download_authorized','republish_authorized')),
  download_status text not null default 'not_available'
    check (download_status in ('not_available','awaiting_authorization','ready','downloading','downloaded','failed')),
  downloaded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, checksum_sha256)
);
create index clip_files_clip_idx on public.clip_files (clip_id);

-- ---------------------------------------------------------------------------
-- clip_pipeline_history — every stage transition is recorded automatically
-- ---------------------------------------------------------------------------
create table public.clip_pipeline_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now()
);
create index clip_pipeline_history_clip_idx on public.clip_pipeline_history (clip_id, changed_at);

create or replace function public.record_pipeline_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.clip_pipeline_history (owner_id, clip_id, previous_status, new_status)
    values (new.owner_id, new.id, null, new.pipeline_status);
  elsif new.pipeline_status is distinct from old.pipeline_status then
    insert into public.clip_pipeline_history (owner_id, clip_id, previous_status, new_status)
    values (new.owner_id, new.id, old.pipeline_status, new.pipeline_status);
  end if;
  return new;
end $$;
create trigger trg_clips_pipeline after insert or update on public.clips
  for each row execute function public.record_pipeline_change();

-- ---------------------------------------------------------------------------
-- discovery_settings (Phase 2)
-- ---------------------------------------------------------------------------
create table public.discovery_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  platform text not null check (platform in ('twitch','youtube','kick','tiktok','instagram')),
  discovery_enabled boolean not null default false,
  frequency_minutes integer not null default 15 check (frequency_minutes >= 5),
  minimum_views integer not null default 0 check (minimum_views >= 0),
  maximum_duration integer check (maximum_duration is null or maximum_duration > 0),
  upload_window_hours integer default 72,
  languages text[] not null default '{}',
  categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, platform)
);
create trigger trg_discovery_settings_updated before update on public.discovery_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- clip_favorites
-- ---------------------------------------------------------------------------
create table public.clip_favorites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, clip_id)
);
create index clip_favorites_clip_idx on public.clip_favorites (clip_id);

-- ---------------------------------------------------------------------------
-- clip_notes
-- ---------------------------------------------------------------------------
create table public.clip_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  note text not null check (length(trim(note)) > 0 and length(note) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clip_notes_clip_idx on public.clip_notes (clip_id, created_at desc);
create trigger trg_clip_notes_updated before update on public.clip_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — owner-only access everywhere
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
create policy "users: read own row" on public.users for select using (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'platform_integrations','creators','clips','clip_metrics_history','clip_files',
    'clip_pipeline_history','discovery_settings','clip_favorites','clip_notes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%1$s: owner access" on public.%1$I for all to authenticated
         using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- History tables are written by triggers only; block direct client edits.
create policy "clip_metrics_history: no client updates" on public.clip_metrics_history
  as restrictive for update to authenticated using (false);
create policy "clip_pipeline_history: no client updates" on public.clip_pipeline_history
  as restrictive for update to authenticated using (false);

-- ---------------------------------------------------------------------------
-- Dashboard aggregate (runs as the caller, so RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats(trending_threshold int default 61, days int default 14)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total',           (select count(*) from clips),
    'new_today',       (select count(*) from clips where discovered_at >= date_trunc('day', now())),
    'trending',        (select count(*) from clips where viral_score >= trending_threshold
                                                     and review_status in ('pending','approved')),
    'awaiting_review', (select count(*) from clips where review_status = 'pending'),
    'approved',        (select count(*) from clips where review_status = 'approved'),
    'downloaded',      (select count(*) from clips where download_status = 'downloaded'),
    'by_platform',     (select coalesce(jsonb_object_agg(platform, n), '{}'::jsonb)
                          from (select platform, count(*) n from clips group by platform) s),
    'by_pipeline',     (select coalesce(jsonb_object_agg(pipeline_status, n), '{}'::jsonb)
                          from (select pipeline_status, count(*) n from clips
                                 where review_status not in ('rejected','archived')
                                 group by pipeline_status) s),
    'per_day',         (select jsonb_agg(jsonb_build_object('day', d::date, 'count', coalesce(c.n, 0)) order by d)
                          from generate_series(current_date - (days - 1), current_date, interval '1 day') d
                          left join (select discovered_at::date as day, count(*) n from clips
                                      where discovered_at >= current_date - (days - 1)
                                      group by 1) c on c.day = d::date)
  );
$$;

grant execute on function public.dashboard_stats(int, int) to authenticated;
