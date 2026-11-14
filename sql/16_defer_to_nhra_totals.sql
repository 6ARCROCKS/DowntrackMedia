-- Downtrack Media: standings defer to NHRA's published total wherever our calculation differs (sections 4-6 of 04_points.sql).
set statement_timeout = '0';
drop materialized view if exists dt.pts_division;
drop materialized view if exists dt.pts_national;

-- 4. National standings: first N divisional + first N national entered; best N of each count.
--    Policy (Mike, Nov 14 2026): we calculate once; wherever NHRA publishes a different total, NHRA's total is shown.
create materialized view dt.pts_national as
with r as (
  select pe.*, pr.div_first, pr.div_best, pr.nat_first, pr.nat_best,
    row_number() over (partition by driver_id, category_id, season, kind order by event_date, event_id) as nth
  from dt.pts_event pe
  join dt.points_rule pr on pr.category_slug = pe.slug and pe.season between pr.season_from and pr.season_to
  where pr.has_national
),
elig as (
  select r.*,
    row_number() over (partition by driver_id, category_id, season, kind order by points desc, event_date) as best_rank
  from r
  where (kind = 'div' and nth <= div_first) or (kind = 'nat' and nth <= nat_first)
),
counted as (
  select * from elig
  where (kind = 'div' and best_rank <= div_best) or (kind = 'nat' and best_rank <= nat_best)
),
tot as (
  select season, category_id, driver_id,
    sum(points)                                   as total,
    sum(points) filter (where kind = 'div')       as div_pts,
    sum(points) filter (where kind = 'nat')       as nat_pts,
    count(*) filter (where kind = 'div')          as div_counted,
    count(*) filter (where kind = 'nat')          as nat_counted,
    array_agg(event_id order by event_date)       as counted_events
  from counted
  group by season, category_id, driver_id
),
att as (
  select season, category_id, driver_id,
    count(*) filter (where kind = 'nat') as nat_events,
    count(*) filter (where kind = 'div') as div_events,
    count(*) filter (where is_win)       as wins,
    count(*) filter (where is_ru)        as runner_ups
  from dt.pts_event group by season, category_id, driver_id
)
select season, category_id, driver_id,
  coalesce(g.nhra_points, t.total)::bigint as total,   -- NHRA's published total wins when ours differs or we have no results
  t.div_pts, t.nat_pts, coalesce(t.div_counted, 0) as div_counted, coalesce(t.nat_counted, 0) as nat_counted,
  coalesce(t.counted_events, '{}') as counted_events,
  coalesce(a.nat_events, 0) as nat_events, coalesce(a.div_events, 0) as div_events,
  coalesce(a.wins, 0) as wins, coalesce(a.runner_ups, 0) as runner_ups,
  rank() over (partition by season, category_id order by coalesce(g.nhra_points, t.total) desc) as rank,
  t.total as calc_total                               -- what our own calculation gives (null = no results on file)
from tot t
full join (select season, category_id, driver_id, nhra_points from dt.points_registration where scope = 'nat') g
  using (season, category_id, driver_id)
left join att a using (season, category_id, driver_id)
where g.nhra_points is not null
   or not exists (select 1 from dt.points_registration x where x.season = t.season and x.category_id = t.category_id and x.scope = 'nat');

create unique index pts_national_pk on dt.pts_national (season, category_id, driver_id);

-- 5. Divisional standings: home division = NHRA's registered home division (dt.points_registration), else the division raced most.
--    First 8 divisional events eligible; best 5 count, at most 2 from outside the home division.
create materialized view dt.pts_division as
with raced as (  -- fallback: the division raced most that season (ties: the one raced first)
  select distinct on (driver_id, category_id, season) driver_id, category_id, season, division as home_div
  from (
    select driver_id, category_id, season, division, count(*) as n, min(event_date) as first_date
    from dt.pts_event where kind = 'div' and division is not null
    group by driver_id, category_id, season, division
  ) x
  order by driver_id, category_id, season, n desc, first_date
),
home as (
  select r.driver_id, r.category_id, r.season, coalesce(g.division, r.home_div) as home_div
  from raced r
  left join dt.points_registration g
    on g.season = r.season and g.category_id = r.category_id and g.driver_id = r.driver_id and g.scope = 'div'
),
d as (
  select pe.*, pr.division_first, pr.division_best, pr.division_max_out,
    row_number() over (partition by pe.driver_id, pe.category_id, pe.season order by pe.event_date, pe.event_id) as nth,
    h.home_div
  from dt.pts_event pe
  join dt.points_rule pr on pr.category_slug = pe.slug and pe.season between pr.season_from and pr.season_to
  join home h on h.driver_id = pe.driver_id and h.category_id = pe.category_id and h.season = pe.season
  where pe.kind = 'div' and pr.has_division
),
elig as (
  select d.*, (division = home_div) as is_home,
    row_number() over (partition by driver_id, category_id, season, (division = home_div)
                       order by points desc, event_date) as side_rank
  from d where nth <= division_first
),
cand as (  -- every home event, plus the best out-of-division events up to the cap
  select * from elig where is_home or side_rank <= division_max_out
),
best as (
  select cand.*, row_number() over (partition by driver_id, category_id, season order by points desc, event_date) as best_rank
  from cand
),
counted as (select * from best where best_rank <= division_best),
tot as (
  select season, category_id, home_div as division, driver_id,
    sum(points) as total,
    count(*) as events_counted,
    count(*) filter (where not is_home) as out_counted,
    array_agg(event_id order by event_date) as counted_events
  from counted group by season, category_id, home_div, driver_id
),
att as (
  select season, category_id, driver_id,
    count(*) as div_events,
    count(*) filter (where is_win) as wins,
    count(*) filter (where is_ru)  as runner_ups
  from dt.pts_event where kind = 'div' group by season, category_id, driver_id
)
select season, category_id, coalesce(g.division, t.division) as division, driver_id,
  coalesce(g.nhra_points, t.total)::bigint as total,   -- NHRA's published total wins when ours differs or we have no results
  coalesce(t.events_counted, 0) as events_counted, coalesce(t.out_counted, 0) as out_counted,
  coalesce(t.counted_events, '{}') as counted_events,
  coalesce(a.div_events, 0) as div_events, coalesce(a.wins, 0) as wins, coalesce(a.runner_ups, 0) as runner_ups,
  rank() over (partition by season, category_id, coalesce(g.division, t.division)
               order by coalesce(g.nhra_points, t.total) desc) as rank,
  t.total as calc_total
from tot t
full join (select season, category_id, driver_id, division, nhra_points from dt.points_registration where scope = 'div') g
  using (season, category_id, driver_id)
left join att a using (season, category_id, driver_id)
where coalesce(g.division, t.division) is not null
  and (g.nhra_points is not null
       or not exists (select 1 from dt.points_registration x where x.season = t.season and x.category_id = t.category_id and x.scope = 'div'));

create unique index pts_division_pk on dt.pts_division (season, category_id, division, driver_id);

-- 6. Public read access
grant select on dt.pts_event, dt.pts_national, dt.pts_division, dt.points_rule, dt.points_event_override, dt.points_manual, dt.points_registration to anon, authenticated;

notify pgrst, 'reload schema';

select 'national' as standings, count(*) as racers, count(*) filter (where calc_total is distinct from total) as using_nhra_total from dt.pts_national where season = 2026
union all
select 'division', count(*), count(*) filter (where calc_total is distinct from total) from dt.pts_division where season = 2026;
