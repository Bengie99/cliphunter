-- ClipHunter — downloads without creator permission, recorded as "transformative_use"
--
-- The user can download a clip without permission on file after confirming it
-- will be substantially edited. The clip is marked 'transformative_use' so it
-- stays visible which footage has no permission behind it.

alter table public.clips drop constraint if exists clips_rights_status_check;
alter table public.clips add constraint clips_rights_status_check
  check (rights_status in ('unknown','public_discoverable','preview_allowed','transformative_use','download_authorized','republish_authorized'));

alter table public.clip_files drop constraint if exists clip_files_rights_status_check;
alter table public.clip_files add constraint clip_files_rights_status_check
  check (rights_status in ('unknown','public_discoverable','preview_allowed','transformative_use','download_authorized','republish_authorized'));

alter table public.clips drop constraint if exists clips_download_requires_rights;
alter table public.clips add constraint clips_download_requires_rights
  check (download_status not in ('queued','downloading')
         or rights_status in ('transformative_use','download_authorized','republish_authorized'));

-- Granting permission later upgrades transformative-use clips too.
create or replace function public.sync_creator_permission()
returns trigger language plpgsql as $$
begin
  if new.permission_status is distinct from old.permission_status then
    if new.permission_status = 'granted' then
      update public.clips set rights_status = 'republish_authorized'
       where creator_id = new.id and rights_status in ('unknown','public_discoverable','preview_allowed','transformative_use');
    elsif old.permission_status = 'granted' then
      update public.clips
         set rights_status = 'public_discoverable',
             download_status = case when download_status in ('queued','downloading') then 'not_available' else download_status end
       where creator_id = new.id and rights_status in ('download_authorized','republish_authorized');
    end if;
  end if;
  return new;
end $$;

create or replace function public.apply_creator_permission()
returns trigger language plpgsql as $$
begin
  if new.creator_id is not null
     and new.rights_status in ('unknown','public_discoverable','preview_allowed','transformative_use')
     and exists (select 1 from public.creators c where c.id = new.creator_id and c.permission_status = 'granted') then
    new.rights_status := 'republish_authorized';
  end if;
  return new;
end $$;
