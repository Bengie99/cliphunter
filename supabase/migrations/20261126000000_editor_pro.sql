-- ClipHunter — pro editor + background helper
--
-- * clip_edits.analysis  : audio envelope, loudness and scene changes the helper
--                          measures (drives silence removal, auto-zoom, waveform)
-- * clip_edits.cover_*   : cover frame the helper renders next to the Short
-- * audio_assets.kind    : the library also holds images and video overlays
-- * edit_presets         : saved looks (layout, caption style, audio…), optionally
--                          the default for one creator
-- * helper_status        : heartbeat of each person's background helper
-- * file_requests        : "Save MP4" — the helper holding the file uploads a
--                          temporary copy the browser downloads
--
-- Safe to run more than once.

alter table public.clip_edits
  add column if not exists analysis jsonb,
  add column if not exists cover_path text,
  add column if not exists output_cloud_path text;

alter table public.audio_assets drop constraint if exists audio_assets_kind_check;
alter table public.audio_assets add constraint audio_assets_kind_check
  check (kind in ('music','sfx','image','video'));

-- ---------------------------------------------------------------------------
-- presets
-- ---------------------------------------------------------------------------
create table if not exists public.edit_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.workspace_id() references public.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  creator_id uuid references public.creators (id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- at most one default preset per creator
create unique index if not exists edit_presets_creator_idx on public.edit_presets (owner_id, creator_id) where creator_id is not null;
drop trigger if exists trg_edit_presets_updated on public.edit_presets;
create trigger trg_edit_presets_updated before update on public.edit_presets
  for each row execute function public.set_updated_at();

alter table public.edit_presets enable row level security;
drop policy if exists "edit_presets: workspace access" on public.edit_presets;
create policy "edit_presets: workspace access" on public.edit_presets for all to authenticated
  using (owner_id = (select public.workspace_id())) with check (owner_id = (select public.workspace_id()));

-- ---------------------------------------------------------------------------
-- helper heartbeat (one row per person)
-- ---------------------------------------------------------------------------
create table if not exists public.helper_status (
  user_id uuid primary key default auth.uid() references public.users (id) on delete cascade,
  owner_id uuid not null default public.workspace_id() references public.users (id) on delete cascade,
  hostname text,
  version text,
  activity text,
  last_seen timestamptz not null default now()
);
alter table public.helper_status enable row level security;
drop policy if exists "helper_status: workspace read" on public.helper_status;
drop policy if exists "helper_status: own write" on public.helper_status;
create policy "helper_status: workspace read" on public.helper_status for select to authenticated
  using (owner_id = (select public.workspace_id()));
create policy "helper_status: own write" on public.helper_status for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and owner_id = (select public.workspace_id()));

-- ---------------------------------------------------------------------------
-- Save MP4 requests
-- ---------------------------------------------------------------------------
create table if not exists public.file_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.workspace_id() references public.users (id) on delete cascade,
  requested_by uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  kind text not null check (kind in ('source','render')),
  status text not null default 'queued' check (status in ('queued','uploading','ready','failed')),
  storage_path text,
  file_name text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists file_requests_queue_idx on public.file_requests (owner_id, created_at) where status = 'queued';
drop trigger if exists trg_file_requests_updated on public.file_requests;
create trigger trg_file_requests_updated before update on public.file_requests
  for each row execute function public.set_updated_at();

alter table public.file_requests enable row level security;
drop policy if exists "file_requests: workspace access" on public.file_requests;
create policy "file_requests: workspace access" on public.file_requests for all to authenticated
  using (owner_id = (select public.workspace_id())) with check (owner_id = (select public.workspace_id()));
