-- ClipHunter — record what a creator's public bio says about clipping
-- (filled by the "Scan bios" button on the Creators page; evidence only,
-- it never sets permission by itself)

alter table public.creators
  add column if not exists bio_clip_excerpt text check (bio_clip_excerpt is null or length(bio_clip_excerpt) <= 500),
  add column if not exists bio_checked_at timestamptz;
