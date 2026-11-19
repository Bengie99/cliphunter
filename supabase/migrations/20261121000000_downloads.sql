-- ClipHunter — authorized downloads (local helper: `npm run worker`)
--
-- Flow: Download button sets clips.download_status = 'queued' → the helper on
-- the user's PC claims it ('downloading'), saves the file, records it in
-- clip_files and marks the clip 'downloaded' (or 'failed' with an error).

alter table public.clips drop constraint if exists clips_download_status_check;
alter table public.clips add constraint clips_download_status_check
  check (download_status in ('not_available','awaiting_authorization','ready','queued','downloading','downloaded','failed'));

alter table public.clips
  add column if not exists download_error text,
  add column if not exists download_requested_at timestamptz;

-- Hard guard: nothing can be queued or downloaded without authorization,
-- whatever the UI or the helper do.
alter table public.clips drop constraint if exists clips_download_requires_rights;
alter table public.clips add constraint clips_download_requires_rights
  check (download_status not in ('queued','downloading')
         or rights_status in ('download_authorized','republish_authorized'));

create index if not exists clips_download_queue_idx on public.clips (owner_id, download_requested_at)
  where download_status = 'queued';

-- Revoking a creator's permission also cancels their pending downloads
-- (already-downloaded files stay listed so you can delete them).
create or replace function public.sync_creator_permission()
returns trigger language plpgsql as $$
begin
  if new.permission_status is distinct from old.permission_status then
    if new.permission_status = 'granted' then
      update public.clips set rights_status = 'republish_authorized'
       where creator_id = new.id and rights_status in ('unknown','public_discoverable','preview_allowed');
    elsif old.permission_status = 'granted' then
      update public.clips
         set rights_status = 'public_discoverable',
             download_status = case when download_status in ('queued','downloading') then 'not_available' else download_status end
       where creator_id = new.id and rights_status in ('download_authorized','republish_authorized');
    end if;
  end if;
  return new;
end $$;
