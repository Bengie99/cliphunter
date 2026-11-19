-- ClipHunter — Shorts editor
--
-- * clip_files.proxy_*  : a small 720p preview copy the helper uploads to
--                         Storage so the browser editor can play it
-- * clip_edits          : one edit per clip — the edit spec (cuts, layout,
--                         captions, audio, text), the transcript, render state
--                         and the YouTube title/description/tags
-- * audio_assets        : the user's music / sound-effect library (Storage)
-- * storage bucket media: private; every object lives under "<user id>/…"

alter table public.clip_files
  add column if not exists proxy_path text,
  add column if not exists proxy_status text not null default 'none'
    check (proxy_status in ('none','queued','running','done','failed')),
  add column if not exists proxy_error text;

create table if not exists public.clip_edits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  spec jsonb not null default '{}'::jsonb,
  transcript jsonb,
  transcript_status text not null default 'none'
    check (transcript_status in ('none','queued','running','done','failed')),
  transcript_error text,
  render_status text not null default 'none'
    check (render_status in ('none','queued','running','done','failed')),
  render_progress real,
  render_error text,
  output_path text,
  output_size bigint,
  rendered_at timestamptz,
  yt_title text check (yt_title is null or length(yt_title) <= 100),
  yt_description text check (yt_description is null or length(yt_description) <= 5000),
  yt_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, clip_id)
);
create trigger trg_clip_edits_updated before update on public.clip_edits
  for each row execute function public.set_updated_at();

create table if not exists public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  kind text not null check (kind in ('music','sfx')),
  name text not null check (length(name) between 1 and 200),
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.clip_edits enable row level security;
alter table public.audio_assets enable row level security;
create policy "clip_edits: owner access" on public.clip_edits for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "audio_assets: owner access" on public.audio_assets for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, each user only touches objects under their own id
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do nothing;

create policy "media: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
