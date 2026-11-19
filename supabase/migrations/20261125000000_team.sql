-- ClipHunter — team workspaces
--
-- A workspace is identified by its owner's user id. Members are linked to an
-- owner in team_members; everything a member creates is stored under the
-- workspace owner's id, and every row-level-security policy compares against
-- public.workspace_id() instead of auth.uid(). So the whole team shares one set
-- of clips, creators, settings, edits and audio, and duplicate detection
-- (unique per owner_id) works across the team.
--
-- Downloaded files live on one specific PC, so clips/clip_files also record
-- WHO requested / downloaded them; each person's helper only handles their own.
--
-- Add a member (run in the SQL editor, with real emails):
--   insert into public.team_members (member_id, workspace_owner_id)
--   select m.id, o.id from auth.users m, auth.users o
--   where m.email = '<member email>' and o.email = '<owner email>';

create table if not exists public.team_members (
  member_id uuid primary key references public.users (id) on delete cascade,
  workspace_owner_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (member_id <> workspace_owner_id)
);

-- The caller's workspace: the owner they're linked to, or themselves.
create or replace function public.workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((select workspace_owner_id from public.team_members where member_id = auth.uid()), auth.uid());
$$;
grant execute on function public.workspace_id() to authenticated;

alter table public.team_members enable row level security;
create policy "team_members: workspace read" on public.team_members for select to authenticated
  using (workspace_owner_id = (select public.workspace_id()));

-- Teammates can see each other's email (e.g. "downloaded on Igor's PC").
create policy "users: workspace read" on public.users for select to authenticated
  using (
    id = (select public.workspace_id())
    or id in (select member_id from public.team_members where workspace_owner_id = (select public.workspace_id()))
  );

-- ---------------------------------------------------------------------------
-- Every owned table: default owner = workspace, policies compare to workspace
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'platform_integrations','creators','clips','clip_metrics_history','clip_files',
    'clip_pipeline_history','discovery_settings','clip_favorites','clip_notes',
    'clip_edits','audio_assets'
  ] loop
    execute format('alter table public.%I alter column owner_id set default public.workspace_id()', t);
    execute format('drop policy if exists "%1$s: owner access" on public.%1$I', t);
    execute format(
      'create policy "%1$s: workspace access" on public.%1$I for all to authenticated
         using (owner_id = (select public.workspace_id())) with check (owner_id = (select public.workspace_id()))', t);
  end loop;
end $$;

alter table public.discovery_runs alter column owner_id set default public.workspace_id();
drop policy if exists "discovery_runs: owner read" on public.discovery_runs;
create policy "discovery_runs: workspace read" on public.discovery_runs for select to authenticated
  using (owner_id = (select public.workspace_id()));

-- ---------------------------------------------------------------------------
-- Which PC: who queued a download, who holds the file
-- ---------------------------------------------------------------------------
alter table public.clips
  add column if not exists download_requested_by uuid references public.users (id) on delete set null;

alter table public.clip_files
  add column if not exists downloaded_by uuid default auth.uid() references public.users (id) on delete set null;
-- everything downloaded so far was downloaded by the workspace owner
update public.clip_files set downloaded_by = owner_id where downloaded_by is null;

-- ---------------------------------------------------------------------------
-- Storage: the media bucket is shared per workspace ("<workspace id>/…")
-- ---------------------------------------------------------------------------
drop policy if exists "media: owner read" on storage.objects;
drop policy if exists "media: owner insert" on storage.objects;
drop policy if exists "media: owner update" on storage.objects;
drop policy if exists "media: owner delete" on storage.objects;
create policy "media: workspace read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.workspace_id())::text);
create policy "media: workspace insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.workspace_id())::text);
create policy "media: workspace update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.workspace_id())::text);
create policy "media: workspace delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.workspace_id())::text);
