-- ClipHunter — YouTube discovery + per-creator permission tracking

-- ---------------------------------------------------------------------------
-- YouTube keyword search (expensive: 100 quota units per search)
-- ---------------------------------------------------------------------------
alter table public.discovery_settings
  add column if not exists search_terms text[] not null default '{}',
  add column if not exists last_search_at timestamptz;

-- ---------------------------------------------------------------------------
-- Permission to clip/republish, tracked per creator with proof
-- ---------------------------------------------------------------------------
alter table public.creators
  add column if not exists permission_status text not null default 'none'
    check (permission_status in ('none','requested','granted','denied')),
  add column if not exists permission_proof_url text,
  add column if not exists permission_granted_at date,
  add column if not exists permission_notes text
    check (permission_notes is null or length(permission_notes) <= 2000);

-- Keep clip rights in sync with the creator's permission:
--   granted          -> their clips become republish_authorized
--   revoked/changed  -> all their authorized clips fall back to public_discoverable
create or replace function public.sync_creator_permission()
returns trigger language plpgsql as $$
begin
  if new.permission_status is distinct from old.permission_status then
    if new.permission_status = 'granted' then
      update public.clips set rights_status = 'republish_authorized'
       where creator_id = new.id and rights_status in ('unknown','public_discoverable','preview_allowed');
    elsif old.permission_status = 'granted' then
      update public.clips set rights_status = 'public_discoverable'
       where creator_id = new.id and rights_status in ('download_authorized','republish_authorized');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_creators_permission on public.creators;
create trigger trg_creators_permission after update of permission_status on public.creators
  for each row execute function public.sync_creator_permission();

-- New clips from a creator who already granted permission start authorized.
create or replace function public.apply_creator_permission()
returns trigger language plpgsql as $$
begin
  if new.creator_id is not null
     and new.rights_status in ('unknown','public_discoverable','preview_allowed')
     and exists (select 1 from public.creators c where c.id = new.creator_id and c.permission_status = 'granted') then
    new.rights_status := 'republish_authorized';
  end if;
  return new;
end $$;

drop trigger if exists trg_clips_permission on public.clips;
create trigger trg_clips_permission before insert or update of creator_id on public.clips
  for each row execute function public.apply_creator_permission();
