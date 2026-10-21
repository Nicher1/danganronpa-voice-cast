-- Run after shared-scheduling-migration.sql on Supabase.
-- Named jobs are updated in place when this script is run again.
begin;
create extension if not exists pg_cron;
select cron.schedule('cast-shared-scheduling','* * * * *','select public.cast_schedule_tick();');
commit;
