-- ClipHunter — schedule discovery every 15 minutes (run ONCE in Supabase SQL Editor).
--
-- Not a migration: it contains your deployment URL and CRON_SECRET.
-- Before running, replace the two placeholders below:
--   <YOUR_CRON_SECRET>   the exact CRON_SECRET value you set in Vercel
--   <YOUR_APP_URL>       e.g. https://cliphunter-six.vercel.app
--
-- The secret goes into Supabase Vault (encrypted), not into the job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<YOUR_CRON_SECRET>', 'cliphunter_cron_secret');

select cron.schedule(
  'cliphunter-discover',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := '<YOUR_APP_URL>/api/cron/discover',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cliphunter_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Check it:     select * from cron.job_run_details order by start_time desc limit 5;
-- Responses:    select status_code, content from net._http_response order by created desc limit 5;
-- Change secret: select vault.update_secret((select id from vault.secrets where name = 'cliphunter_cron_secret'), '<NEW_SECRET>');
-- Remove:       select cron.unschedule('cliphunter-discover');
