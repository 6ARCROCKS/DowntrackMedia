-- Downtrack Media: stats layer v2
-- Replaces v1. Adds:
--   * junk-run filtering (limits live in dt.config, editable without code)
--   * spread (std dev) and "change over the window" trend
--   * dial_variance for dial-in classes
--   * index metrics for Comp, Stock and Super Stock
-- Run once in Supabase > SQL Editor. If the dashboard says it can't reach the
-- server, the script is still running. Do not click Run again.

set statement_timeout = '0';

-- 0. Editable limits for what counts as a clean run
insert into dt.config (key, value)
select x.k, x.v
from (values
  ('stats.rt_max',            '1.0'),   -- RT above this is a bye, a sleeper or bad data
  ('stats.dial_over_max',     '0.50'),  -- ET more than this over the dial = lifted or broke
  ('stats.dial_under_max',    '0.50'),  -- dial-in classes: ET more than this under the dial = bad data
  ('stats.pro_et_ratio_max',  '1.15')   -- heads-up pro classes: ET 15%+ slower than the race's best = smoked or lifted
) as x(k, v)
where not exists (select 1 from dt.config c where c.key = x.k);

-- 1. Drop v1 objects (rebuilt below)
drop materialized view if exists dt.stat_driver;
drop materialized view if exists dt.stat_category;
drop view if exists dt.run_metric;

-- 2. One row per run per metric, junk filtered
create view dt.run_metric as
with cfg as (
  select
    coalesce(max(case when key = 'stats.rt_max'           then value end)::numeric, 1.0)  as rt_max,
    coalesce(max(case when key = 'stats.dial_over_max'    then value end)::numeric, 0.50) as over_max,
    coalesce(max(case when key = 'stats.dial_under_max'   then value end)::numeric, 0.50) as under_max,
    coalesce(max(case when key = 'stats.pro_et_ratio_max' then value end)::numeric, 1.15) as pro_ratio
  from dt.config
),
base as (
  select
    r.id as run_id, r.entry_id, r.dial, r.rt, r.ft60, r.ft330, r.ft660, r.mph660, r.ft1000,
    r.et, r.mph, r.package, r.rt_plus_60, r.red_light,
    p.round_type,
    en.driver_id, en.class_code,
    ra.id as race_id, ra.category_id,
    ev.id as event_id, ev.season,
    coalesce(ra.race_date, ev.start_date) as run_date,
    c.slug, c.uses_dial,
    c.slug in ('stock-eliminator', 'super-stock', 'competition-eliminator') as idx_class,
    min(r.et) over (partition by ra.id) as race_best_et
  from dt.run r
  join dt.pairing  p  on p.id  = r.pairing_id
  join dt.race     ra on ra.id = p.race_id
  join dt.event    ev on ev.id = ra.event_id
  join dt.entry    en on en.id = r.entry_id
  join dt.category c  on c.id  = ra.category_id
),
-- In Stock, Super Stock and Comp qualifying, the published "dial" is the class index.
e_idx as (
  select entry_id, mode() within group (order by dial) as idx
  from base
  where idx_class and round_type = 'Q' and dial is not null
  group by entry_id
),
q_idx as (
  select race_id, class_code, mode() within group (order by dial) as idx
  from base
  where idx_class and round_type = 'Q' and dial is not null
  group by race_id, class_code
),
f as (
  select
    b.*,
    coalesce(ei.idx, qi.idx) as class_index,
    cfg.rt_max,
    case
      when b.et is null then false
      when b.idx_class then
        coalesce(b.dial, coalesce(ei.idx, qi.idx)) is not null
        and b.et <= coalesce(b.dial, coalesce(ei.idx, qi.idx)) + cfg.over_max
      when b.uses_dial then
        b.dial is null or (b.et - b.dial between -cfg.under_max and cfg.over_max)
      else
        b.race_best_et is null or b.et <= b.race_best_et * cfg.pro_ratio
    end as clean_run
  from base b
  cross join cfg
  left join e_idx ei on ei.entry_id = b.entry_id
  left join q_idx qi on qi.race_id = b.race_id and qi.class_code = b.class_code
)
select
  f.run_id, f.driver_id, f.category_id, f.race_id, f.event_id, f.season, f.run_date,
  m.metric, m.value
from f
cross join lateral (values
  ('rt',           case when not coalesce(f.red_light, false) and f.rt between 0 and f.rt_max then f.rt end),
  ('rt_plus_60',   case when not coalesce(f.red_light, false) and f.rt between 0 and f.rt_max and f.clean_run then f.rt_plus_60 end),
  ('ft60',         case when f.clean_run then f.ft60 end),
  ('ft330',        case when f.clean_run then f.ft330 end),
  ('ft660',        case when f.clean_run then f.ft660 end),
  ('mph660',       case when f.clean_run then f.mph660 end),
  ('ft1000',       case when f.clean_run then f.ft1000 end),
  ('et',           case when f.clean_run then f.et end),
  ('mph',          case when f.clean_run then f.mph end),
  ('s60_330',      case when f.clean_run then f.ft330  - f.ft60   end),
  ('s330_660',     case when f.clean_run then f.ft660  - f.ft330  end),
  ('s660_1000',    case when f.clean_run then f.ft1000 - f.ft660  end),
  ('s1000_1320',   case when f.clean_run then f.et     - f.ft1000 end),
  ('mph_660_1320', case when f.clean_run then f.mph    - f.mph660 end),
  ('package',      case when f.clean_run then f.package end),
  -- 1 = red light, 0 = clean start; average = red-light rate
  ('red_light',    case when f.red_light is null then null when f.red_light then 1::numeric else 0::numeric end),
  -- Dial-in classes: ET minus dial (+ = over, - = breakout)
  ('dial_variance', case when f.clean_run and f.uses_dial and not f.idx_class and f.dial is not null then f.et - f.dial end),
  -- Comp, Stock, Super Stock: positive = under the index
  ('q_under_index', case when f.idx_class and f.round_type = 'Q' and f.clean_run and f.dial is not null
                         then f.dial - f.et end),
  ('dial_under_index', case when f.idx_class and f.slug <> 'competition-eliminator' and f.round_type = 'E'
                              and f.dial is not null and f.class_index is not null and f.dial < f.class_index
                            then f.class_index - f.dial end),
  ('headsup_under_index', case when f.idx_class and f.round_type = 'E' and f.clean_run and f.dial is not null
                                 and (f.slug = 'competition-eliminator' or f.dial = f.class_index)
                               then f.dial - f.et end),
  -- Stock and Super Stock: 1 = round run heads-up on the index, 0 = dialed under
  ('headsup_rate', case when f.idx_class and f.slug <> 'competition-eliminator' and f.round_type = 'E'
                          and f.dial is not null and f.class_index is not null
                        then case when f.dial = f.class_index then 1::numeric else 0::numeric end end)
) as m(metric, value)
where m.value is not null;

revoke all on dt.run_metric from anon, authenticated;

-- 3. Class-level stats
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
    (case when b.season >= l.s - 2        then '3yr'    end),
    (case when b.season =  l.s            then 'season' end),
    (case when er.rk <= 3                 then 'last3'  end),
    (case when b.run_date = current_date  then 'today'  end)
  ) as w(win)
  where w.win is not null
)
select
  category_id,
  win as time_window,
  metric,
  count(*) as n,
  round(avg(value), 4) as avg_val,
  round(percentile_cont(0.5) within group (order by value)::numeric, 4) as median_val,
  round(stddev_samp(value), 4) as std_val,
  round((regr_slope(value, (run_date - date '2000-01-01')::float8)
         * (max(run_date) - min(run_date)))::numeric, 4) as trend_change,
  min(run_date) as first_run,
  max(run_date) as last_run
from tagged
group by category_id, win, metric;

create unique index stat_category_pk on dt.stat_category (category_id, time_window, metric);

-- 4. Driver-level stats (per driver, per class)
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
    (case when b.season >= l.s - 2        then '3yr'    end),
    (case when b.season =  l.s            then 'season' end),
    (case when de.rk <= 3                 then 'last3'  end),
    (case when b.run_date = current_date  then 'today'  end)
  ) as w(win)
  where w.win is not null
)
select
  driver_id,
  category_id,
  win as time_window,
  metric,
  count(*) as n,
  round(avg(value), 4) as avg_val,
  round(percentile_cont(0.5) within group (order by value)::numeric, 4) as median_val,
  round(stddev_samp(value), 4) as std_val,
  round((regr_slope(value, (run_date - date '2000-01-01')::float8)
         * (max(run_date) - min(run_date)))::numeric, 4) as trend_change,
  min(run_date) as first_run,
  max(run_date) as last_run
from tagged
group by driver_id, category_id, win, metric;

create unique index stat_driver_pk on dt.stat_driver (driver_id, category_id, time_window, metric);
create index stat_driver_cat on dt.stat_driver (category_id, time_window, metric);

-- 5. Public read access to finished numbers only
grant select on dt.stat_category, dt.stat_driver to anon, authenticated;

-- 6. Refresh function and nightly schedule (3:00 AM Central)
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
