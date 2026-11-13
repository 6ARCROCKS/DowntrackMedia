-- Downtrack Media: Lucas Oil points engine (NHRA rules)
-- Source: https://www.nhra.com/how-points-are-earned/lucas-oil-national-championship-points
-- Builds: per-event points, national standings, divisional standings.
-- Run once in Supabase > SQL Editor. Safe to re-run. Refreshes nightly with the stats.

set statement_timeout = '0';

-- 1. Counting rules per class (editable without code; season range for future rule changes)
create table if not exists dt.points_rule (
  category_slug text not null,
  season_from   smallint not null default 2022,
  season_to     smallint not null default 2100,
  div_first     smallint,           -- eligible: first N divisional/regional events entered
  div_best      smallint,           -- best N of those count (national total)
  nat_first     smallint,           -- eligible: first N national events entered
  nat_best      smallint,           -- best N of those count
  has_national  boolean not null default true,
  has_division  boolean not null default true,
  division_first smallint default 8, -- division program: events eligible
  division_best  smallint default 5, -- division program: best N count
  division_max_out smallint default 2, -- division program: max out-of-division events counted
  primary key (category_slug, season_from)
);

insert into dt.points_rule (category_slug, div_first, div_best, nat_first, nat_best, has_national, has_division)
values
  ('super-stock',            8, 5,  6, 3, true,  true),
  ('stock-eliminator',       8, 5,  6, 3, true,  true),
  ('super-comp',             8, 5,  6, 3, true,  true),
  ('super-gas',              8, 5,  6, 3, true,  true),
  ('competition-eliminator', 8, 5,  5, 3, true,  true),
  ('top-dragster',           8, 5,  5, 3, true,  true),
  ('top-sportsman',          8, 5,  5, 3, true,  true),
  -- Top Alcohol: first 5 regional (best 3) + first 10 national (best 7). Regional program not built yet.
  ('top-alcohol-dragster',   5, 3, 10, 7, true,  false),
  ('top-alcohol-funny-car',  5, 3, 10, 7, true,  false),
  -- Super Street: division only (NHRA has no national; Mike: none yet).
  ('super-street',           8, 5,  0, 0, false, true)
on conflict (category_slug, season_from) do nothing;

-- 1b. Events NHRA scores differently from their series (from NHRA's per-driver points sheets)
create table if not exists dt.points_event_override (
  event_id int primary key,
  kind     text not null check (kind in ('nat','div')),
  note     text
);
insert into dt.points_event_override (event_id, kind, note) values
  -- 2026 SPORTSnationals: divisional race first, SPORTSnationals second on the same weekend
  (307, 'nat', '2026 Cajun SPORTSnationals, No Problem Raceway, Belle Rose (Mar 27-29)'),
  (324, 'nat', '2026 Canadian SPORTSnationals, Mission Raceway Park (Jun 11-12)'),
  (284, 'nat', '2026 Testo Chesapeake SPORTSnationals, Cecil County Dragway (moved to Aug)'),
  (300, 'nat', '2026 JEGS SPORTSnationals, Beech Bend, Bowling Green (BK1, moved to Aug 26-30)')
on conflict (event_id) do update set kind = excluded.kind, note = excluded.note;

-- 1c. NHRA points-sheet values: races NHRA never published results for, and races whose published
--     results are missing rounds (bracket doesn't add up). A row here replaces the computed score.
create table if not exists dt.points_manual (
  season      smallint not null,
  category_id int      not null,
  driver_id   int      not null,
  event_id    int      not null,
  points      int,               -- null = waived (NHRA type WvEv): the race is dropped entirely
  is_win      boolean  not null default false,
  is_ru       boolean  not null default false,
  source      text,
  primary key (driver_id, category_id, event_id)
);

alter table dt.points_manual alter column points drop not null;

-- 2. Points for a finish (NHRA table). lost_round = elimination round lost in (1 = first round).
create or replace function dt.lodrs_points(p_slug text, p_field int, p_lost int, p_win boolean, p_ru boolean)
returns int language sql immutable as $$
  select case
    when p_slug like 'top-alcohol-%' then
      case when p_win then 100 when p_ru then 80
           when p_field <= 4 then 40
           when p_field <= 8 then case p_lost when 1 then 40 else 60 end
           else case p_lost when 1 then 20 when 2 then 40 else 60 end end
    else
      (select case when p_win then w when p_ru then ru
                   else coalesce(l[least(greatest(p_lost, 1), array_length(l, 1))], l[1]) end
       from (values
         (4,    array[33],                   64,  85),
         (8,    array[32,43],                64,  85),
         (16,   array[31,42,53],             64,  85),
         (32,   array[30,41,52,63],          74,  95),
         (64,   array[30,40,51,62,73],       84, 105),
         (128,  array[30,40,50,61,72,83],    94, 105),
         (99999,array[30,40,50,60,71,82,93],104, 115)
       ) t(maxf, l, ru, w)
       where p_field <= maxf order by maxf limit 1)
  end
$$;

-- Top Alcohol qualifying points by position (plus 10 for a valid attempt)
create or replace function dt.ta_qual_points(p_pos int)
returns int language sql immutable as $$
  select case when p_pos is null then 0 when p_pos = 1 then 8 when p_pos = 2 then 7 when p_pos = 3 then 6
              when p_pos = 4 then 5 when p_pos <= 6 then 4 when p_pos <= 8 then 3
              when p_pos <= 12 then 2 when p_pos <= 16 then 1 else 0 end
$$;

-- 3. Points earned at every event, per driver and class
drop materialized view if exists dt.pts_division cascade;
drop materialized view if exists dt.pts_national cascade;
drop materialized view if exists dt.pts_event cascade;

create materialized view dt.pts_event as
with elim as (
  select p.race_id, r.entry_id, max(p.round_no) as last_round
  from dt.pairing p
  join dt.run r on r.pairing_id = p.id
  where p.round_type = 'E'
  group by p.race_id, r.entry_id
),
field as (  -- NHRA scores by ladder size: the larger of 2^rounds and the next power of two above the cars in eliminations
  select race_id, count(*) as field_n, max(last_round) as rounds_n,
         greatest(power(2, max(last_round)), power(2, ceil(log(2, greatest(count(*), 2)::numeric))))::int as ladder_n
  from elim group by race_id
),
qual as (  -- qualifying position from best qualifying ET when the source didn't record it (Top Alcohol bonus points)
  select en.id as entry_id,
         rank() over (partition by en.race_id order by min(r.et)) as qpos
  from dt.entry en
  join dt.run r on r.entry_id = en.id
  join dt.pairing p on p.id = r.pairing_id and p.round_type in ('Q', 'T')
  where r.et > 0 and coalesce(r.red_light, false) = false
  group by en.id, en.race_id
),
base as (
  select
    en.id as entry_id, en.driver_id, ra.category_id, c.slug, ev.season, ev.id as event_id, ev.name as event_name,
    coalesce(ev.start_date, ra.race_date) as event_date,
    coalesce(o.kind, case when s.code = 'nhra-national' then 'nat'
         when s.code like 'lodrs-d%' then 'div' end) as kind,
    nullif(substring(s.code from 'lodrs-d(\d+)'), '')::smallint as division,
    coalesce(nullif(ra.field_size, 0), f.field_n, 0) as field_n,   -- cars entered (shown on the site)
    coalesce(f.ladder_n, nullif(ra.field_size, 0), f.field_n, 0) as ladder_n,  -- used for points
    e.last_round, coalesce(en.is_winner, false) as is_win, coalesce(en.is_runner_up, false) as is_ru,
    coalesce(en.qual_pos, q.qpos) as qual_pos
  from dt.entry en
  join dt.race ra     on ra.id = en.race_id
  join dt.event ev    on ev.id = ra.event_id
  join dt.series s    on s.id = ev.series_id
  join dt.category c  on c.id = ra.category_id
  left join elim e    on e.race_id = ra.id and e.entry_id = en.id
  left join field f   on f.race_id = ra.id
  left join qual q    on q.entry_id = en.id
  left join dt.points_event_override o on o.event_id = ev.id
  where en.driver_id is not null
    and c.slug in (select category_slug from dt.points_rule)
    and (s.code = 'nhra-national' or s.code like 'lodrs-d%')
),
scored as (
  select b.*,
    case
      when b.last_round is null and not b.is_win then 10   -- non-qualifier / no-show
      else dt.lodrs_points(b.slug, b.ladder_n::int, b.last_round::int, b.is_win, b.is_ru)
    end
    + case when b.slug like 'top-alcohol-%' then 10 + dt.ta_qual_points(b.qual_pos::int) else 0 end as points
  from base b
  where b.kind is not null
),
manual as (
  select null::bigint as entry_id, m.driver_id, m.category_id, c.slug, m.season, ev.id as event_id, ev.name as event_name,
    ev.start_date as event_date,
    coalesce(o.kind, case when s.code = 'nhra-national' then 'nat' when s.code like 'lodrs-d%' then 'div' end) as kind,
    nullif(substring(s.code from 'lodrs-d(\d+)'), '')::smallint as division,
    null::bigint as field_n, null::int as last_round, m.is_win, m.is_ru, m.points
  from dt.points_manual m
  join dt.event ev   on ev.id = m.event_id
  join dt.series s   on s.id = ev.series_id
  join dt.category c on c.id = m.category_id
  left join dt.points_event_override o on o.event_id = ev.id
  where m.points is not null   -- a row with no points is a waiver: the result is removed and nothing replaces it
)
-- One score per driver per event per class (keep the best if entered twice)
select distinct on (driver_id, category_id, event_id)
  entry_id, driver_id, category_id, slug, season, event_id, event_name, event_date, kind, division,
  field_n, last_round, is_win, is_ru, points
from (
  select entry_id, driver_id, category_id, slug, season, event_id, event_name, event_date, kind, division,
         field_n::bigint, last_round::int, is_win, is_ru, points from scored x
  where not exists (select 1 from dt.points_manual m   -- an NHRA points-sheet value replaces a computed score
                    where m.driver_id = x.driver_id and m.category_id = x.category_id and m.event_id = x.event_id)
  union all
  select * from manual
) u
order by driver_id, category_id, event_id, points desc;

create unique index pts_event_pk on dt.pts_event (driver_id, category_id, event_id);
create index pts_event_season on dt.pts_event (season, category_id);

-- 4. National standings: first N divisional + first N national entered; best N of each count
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
select t.*, coalesce(a.nat_events, 0) as nat_events, coalesce(a.div_events, 0) as div_events,
  coalesce(a.wins, 0) as wins, coalesce(a.runner_ups, 0) as runner_ups,
  rank() over (partition by t.season, t.category_id order by t.total desc) as rank
from tot t
left join att a using (season, category_id, driver_id);

create unique index pts_national_pk on dt.pts_national (season, category_id, driver_id);

-- 5. Divisional standings: home division = the division raced most that season (NHRA uses the declared home division).
--    First 8 divisional events eligible; best 5 count, at most 2 from outside the home division.
create materialized view dt.pts_division as
with home as (  -- home division: the one raced most that season (ties: the one raced first)
  select distinct on (driver_id, category_id, season) driver_id, category_id, season, division as home_div
  from (
    select driver_id, category_id, season, division, count(*) as n, min(event_date) as first_date
    from dt.pts_event where kind = 'div' and division is not null
    group by driver_id, category_id, season, division
  ) x
  order by driver_id, category_id, season, n desc, first_date
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
select t.*, a.div_events, a.wins, a.runner_ups,
  rank() over (partition by t.season, t.category_id, t.division order by t.total desc) as rank
from tot t join att a using (season, category_id, driver_id)
where t.division is not null;

create unique index pts_division_pk on dt.pts_division (season, category_id, division, driver_id);

-- 6. Public read access
grant select on dt.pts_event, dt.pts_national, dt.pts_division, dt.points_rule, dt.points_event_override, dt.points_manual to anon, authenticated;

-- 7. Refresh with the nightly stats run
create or replace function dt.refresh_stats()
returns void
language sql
security definer
set search_path = dt, public
as $$
  refresh materialized view concurrently dt.stat_category;
  refresh materialized view concurrently dt.stat_driver;
  refresh materialized view concurrently dt.pts_event;
  refresh materialized view concurrently dt.pts_national;
  refresh materialized view concurrently dt.pts_division;
$$;
revoke execute on function dt.refresh_stats() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- 8. Check vs NHRA 2026 Stock: Adkinson 655, Hidalgo Jr 644, Santangelo 633, Brand 623, Oakes 600, Theobald 581, Strickland 567
select n.rank, d.display_name, n.total, n.div_pts, n.nat_pts
from dt.pts_national n
join dt.driver d on d.id = n.driver_id
join dt.category c on c.id = n.category_id
where n.season = 2026 and c.slug = 'stock-eliminator'
order by n.rank limit 10;
