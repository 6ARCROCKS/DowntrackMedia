-- Downtrack Media: staging cleanup
-- Frees ~200 MB by removing raw NHRA text rows that have already been loaded
-- into dt.run. The website never reads this table, and the loader
-- (dt.load_pending) only reads rows for events still waiting in dt.load_queue,
-- so neither is affected. Rows from loads that errored are kept for re-runs.
--
-- Run AFTER the stats v2 script has finished.
-- Run PART 1 and PART 2 as two separate Runs (Postgres won't vacuum inside
-- the same run as other statements).

-- ===== PART 1: paste and Run this block =====
delete from dt.stage_nhra_run s
using dt.load_queue q
where q.season = s.season
  and q.event_key = s.event_key
  and q.loaded_at is not null
  and coalesce(q.result ->> 'error', '') = '';

-- Keep it from growing again: clear loaded rows every night at 2:30 AM Central.
select cron.unschedule('downtrack-clean-staging')
where exists (select 1 from cron.job where jobname = 'downtrack-clean-staging');
select cron.schedule('downtrack-clean-staging', '30 8 * * *', $$
  delete from dt.stage_nhra_run s
  using dt.load_queue q
  where q.season = s.season and q.event_key = s.event_key
    and q.loaded_at is not null
    and coalesce(q.result ->> 'error', '') = ''
$$);

-- ===== PART 2: clear the editor, paste ONLY this line, and Run =====
-- vacuum full dt.stage_nhra_run;
