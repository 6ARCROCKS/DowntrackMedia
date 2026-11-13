-- Downtrack Media: stats layer
-- Pre-computes average, median and trend for every split, by class and by driver,
-- across five time windows: all, 3yr, season, last3, today.
-- Run once in Supabase > SQL Editor. Safe to re-run.

set statement_timeout = '0';

-- 1. One row per run per metric (the long, "unpivoted" form the stats are built from)
create or replace view dt.run_metric as
select
  r.id                                   as run_id,
  e.driver_id,
  ra.category_id,
  ra.id                                  as race_id,
  ev.id                                  as event_id,
  ev.season,
  coalesce(ra.race_date, ev.start_date)  as run_date,
  m.metric,
  m.value
from dt.run r
join dt.pairing p on p.id  = r.pairing_id
join dt.race   ra on ra.id = p.race_id
join dt.event  ev on ev.id = ra.event_id
join dt.entry  e  on e.id  = r.entry_id
cross join lateral (values
  ('rt',           case when coalesce(r.red_light, false) then null else r.rt end),
  ('rt_plus_60',   case when coalesce(r.red_light, false) then null else r.rt_plus_60 end),
  ('ft60',         r.ft60),
  ('ft330',        r.ft330),
  ('ft660',        r.ft660),
  ('mph660',       r.mph660),
  ('ft1000',       r.ft1000),
  ('et',           r.et),
  ('mph',          r.mph),
  ('s60_330',      r.ft330  - r.ft60),
  ('s330_660',     r.ft660  - r.ft330),
  ('s660_1000',    r.ft1000 - r.ft660),
  ('s1000_1320',   r.et     - r.ft1000),
  ('mph_660_1320', r.mph    - r.mph660),
  ('package',      r.package),
  ('ov_un',        r.ov_un),
  -- 1 = red light, 0 = clean start; its average is the red-light rate
  ('red_light',    case when r.red_light is null then null
                        when r.red_light then 1::numeric else 0::numeric end)
) as m(metric, value)
where m.value is not null;

-- 2. Class-level stats
drop materialized view if exists dt.stat_category;
create materialized view dt.stat_category as
with latest as (
  select max(ev.season) as s
  from dt.event ev
  where exists (select 1 from dt.race ra where ra.event_id = ev.id)
),
ev_rank as (
  select ra.category_id, ra.event_id,
         dense_rank() over (partition by ra.category_id
                            order by max(coalesce(ra.race_date, ev.start_date)) desc) as rk
  from dt.race ra
  join dt.event ev on ev.id = ra.event_id
  group by ra.category_id, ra.event_id
),
tagged as (
  select b.category_id, b.metric, b.value, b.run_date, w.win
  from dt.run_metric b
  join ev_rank er on er.category_id = b.category_id and er.event_id = b.event_id
  cross join latest l
  cross join lateral (values
    ('all'),
    (case when b.season >= l.s - 2         then '3yr'    end),
    (case when b.season =  l.s             then 'season' end),
    (case when er.rk <= 3                  then 'last3'  end),
    (case when b.run_date = current_date   then 'today'  end)
  ) as w(win)
  where w.win is not null
)
select
  category_id,
  win                                                         as time_window,
  metric,
  count(*)                                                    as n,
  round(avg(value), 4)                                        as avg_val,
  round(percentile_cont(0.5) within group (order by value)::numeric, 4) as median_val,
  round((regr_slope(value, extract(epoch from run_date) / 86400.0) * 365)::numeric, 4) as trend_per_year,
  min(run_date)                                               as first_run,
  max(run_date)                                               as last_run
from tagged
group by category_id, win, metric;

create unique index stat_category_pk on dt.stat_category (category_id, time_window, metric);

-- 3. Driver-level stats (per driver, per class)
drop materialized view if exists dt.stat_driver;
create materialized view dt.stat_driver as
with latest as (
  select max(ev.season) as s
  from dt.event ev
  where exists (select 1 from dt.race ra where ra.event_id = ev.id)
),
drv_ev as (
  select en.driver_id, ra.category_id, ra.event_id,
         dense_rank() over (partition by en.driver_id, ra.category_id
                            order by max(coalesce(ra.race_date, ev.start_date)) desc) as rk
  from dt.entry en
  join dt.race  ra on ra.id = en.race_id
  join dt.event ev on ev.id = ra.event_id
  group by en.driver_id, ra.category_id, ra.event_id
),
tagged as (
  select b.driver_id, b.category_id, b.metric, b.value, b.run_date, w.win
  from dt.run_metric b
  join drv_ev de on de.driver_id = b.driver_id
                and de.category_id = b.category_id
                and de.event_id = b.event_id
  cross join latest l
  cross join lateral (values
    ('all'),
    (case when b.season >= l.s - 2         then '3yr'    end),
    (case when b.season =  l.s             then 'season' end),
    (case when de.rk <= 3                  then 'last3'  end),
    (case when b.run_date = current_date   then 'today'  end)
  ) as w(win)
  where w.win is not null
)
select
  driver_id,
  category_id,
  win                                                         as time_window,
  metric,
  count(*)                                                    as n,
  round(avg(value), 4)                                        as avg_val,
  round(percentile_cont(0.5) within group (order by value)::numeric, 4) as median_val,
  round((regr_slope(value, extract(epoch from run_date) / 86400.0) * 365)::numeric, 4) as trend_per_year,
  min(run_date)                                               as first_run,
  max(run_date)                                               as last_run
from tagged
group by driver_id, category_id, win, metric;

create unique index stat_driver_pk on dt.stat_driver (driver_id, category_id, time_window, metric);
create index stat_driver_cat on dt.stat_driver (category_id, time_window, metric);

-- 4. Public read access (finished numbers only)
grant select on dt.stat_category, dt.stat_driver to anon, authenticated;
revoke all on dt.run_metric from anon, authenticated;

-- 5. Refresh: nightly at 3:00 AM Central (09:00 UTC), and callable after each data load
create or replace function dt.refresh_stats()
returns void
language sql
security definer
set search_path = dt, public
as $$
  refresh materialized view concurrently dt.stat_category;
  refresh materialized view concurrently dt.stat_driver;
$$;

revoke execute on function dt.refresh_stats() from public, anon, authenticated;

select cron.unschedule('downtrack-refresh-stats')
where exists (select 1 from cron.job where jobname = 'downtrack-refresh-stats');
select cron.schedule('downtrack-refresh-stats', '0 9 * * *', $$select dt.refresh_stats()$$);
