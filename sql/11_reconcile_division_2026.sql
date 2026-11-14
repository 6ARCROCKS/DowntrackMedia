-- Downtrack Media: reconcile 2026 NHRA DIVISION standings with NHRA's own division standings and per-racer division sheets
-- (8 classes x 7 divisions, 4,213 racers). Run AFTER 04_points.sql (which adds the event overrides and dt.points_registration).
-- The fix was computed in the browser from NHRA's pages and staged in dt.stage_pdra_sheet (page 'fix/nhra-div-2026').
--
-- What was wrong, and what this does about it:
--  1. Racer identity: 54 of our drivers were two NHRA racers merged together (father/son, or two people with the same name).
--     They are split: the second person gets their own record and the results NHRA credits only to them.
--     6 NHRA racers were missing entirely; they are added.
--  2. NHRA id map (dt.driver_nhra): every NHRA racer id linked to our driver record, so this never has to be guessed again.
--  3. Registration + home division (dt.points_registration): NHRA ranks only racers registered for points, in their registered
--     home division. We were ranking everyone who raced, in the division they raced most.
--  4. Per-event values: where our computed points still differ from NHRA's division sheet (incomplete or mis-numbered rounds,
--     doubleheaders, waived events), NHRA's value is stored in dt.points_manual, tagged 'NHRA division sheet 2026'.
-- Safe to re-run.
set statement_timeout = '0';

create table if not exists dt.driver_nhra (
  nhra_id   int primary key,
  driver_id int not null,
  nhra_name text,
  hometown  text,
  updated_at timestamptz default now()
);
create index if not exists driver_nhra_driver on dt.driver_nhra (driver_id);
grant select on dt.driver_nhra to anon, authenticated;

create temp table fx as
select image as part, ocr_text::jsonb as j from dt.stage_pdra_sheet where page = 'fix/nhra-div-2026';

-- 1a. New racers (split-off people and racers we never had) ----------------------------------
create temp table fx_new as
select (r->>0)::int as nhra_id, r->>1 as name, nullif(r->>2, 'null') as hometown
from fx cross join lateral jsonb_array_elements(fx.j) r where fx.part = 'newDrivers';

insert into dt.driver (display_name, first_name, last_name, hometown, notes)
select n.name, split_part(n.name, ' ', 1), regexp_replace(n.name, '^\S+\s+', ''), n.hometown,
       'NHRA racer ' || n.nhra_id || ' (division reconcile 2026)'
from fx_new n
where not exists (select 1 from dt.driver_nhra m where m.nhra_id = n.nhra_id);

insert into dt.driver_nhra (nhra_id, driver_id, nhra_name, hometown)
select n.nhra_id, d.id, n.name, n.hometown
from fx_new n
join dt.driver d on d.notes = 'NHRA racer ' || n.nhra_id || ' (division reconcile 2026)'
on conflict (nhra_id) do nothing;

-- 2. NHRA id -> driver map -----------------------------------------------------------------
insert into dt.driver_nhra (nhra_id, driver_id)
select (r->>0)::int, (r->>1)::int
from fx cross join lateral jsonb_array_elements(fx.j) r where fx.part = 'map'
on conflict (nhra_id) do update set driver_id = excluded.driver_id, updated_at = now()
  where dt.driver_nhra.driver_id is distinct from excluded.driver_id
    and not exists (select 1 from fx_new n where n.nhra_id = excluded.nhra_id);

-- 1b. Move the split-off person's results to their own record --------------------------------
create temp table fx_move as
select (r->>0)::int as old_driver, m.driver_id as new_driver, (r->>2)::int as event_id, (r->>3)::int as category_id
from fx cross join lateral jsonb_array_elements(fx.j) r
join dt.driver_nhra m on m.nhra_id = (r->>1)::int
where fx.part = 'moves';

update dt.entry en set driver_id = mv.new_driver
from fx_move mv, dt.race ra
where en.race_id = ra.id and ra.event_id = mv.event_id and ra.category_id = mv.category_id
  and en.driver_id = mv.old_driver;

delete from dt.points_manual pm using fx_move mv
where pm.driver_id = mv.old_driver and pm.event_id = mv.event_id and pm.category_id = mv.category_id;

-- 3. Registration and home division ---------------------------------------------------------
delete from dt.points_registration where season = 2026;
insert into dt.points_registration (season, category_id, driver_id, scope, division, nhra_points)
select distinct on (m.driver_id, (r->>1)::int, r->>2)
  2026, (r->>1)::int, m.driver_id, r->>2, nullif(r->>3, 'null')::smallint, (r->>4)::int
from fx cross join lateral jsonb_array_elements(fx.j) r
join dt.driver_nhra m on m.nhra_id = (r->>0)::int
where fx.part = 'reg'
order by m.driver_id, (r->>1)::int, r->>2, (r->>4)::int desc;

-- 4. Per-event NHRA values ------------------------------------------------------------------------
refresh materialized view dt.pts_event;

create temp table fx_sheet as
select distinct on (m.driver_id, (r->>1)::int, (r->>2)::int)
  m.driver_id, (r->>1)::int as category_id, (r->>2)::int as event_id,
  case when r->>3 is null or r->>3 = 'null' then null else (r->>3)::int end as points
from fx cross join lateral jsonb_array_elements(fx.j) r
join dt.driver_nhra m on m.nhra_id = (r->>0)::int
where fx.part = 'sheet'
order by m.driver_id, (r->>1)::int, (r->>2)::int;

insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source)
select 2026, s.category_id, s.driver_id, s.event_id, s.points,
       coalesce(pe.is_win, false), coalesce(pe.is_ru, false),
       case when s.points is null then 'NHRA division sheet 2026: waived'
            when pe.driver_id is null then 'NHRA division sheet 2026: result missing'
            else 'NHRA division sheet 2026: points' end
from fx_sheet s
left join dt.pts_event pe on pe.driver_id = s.driver_id and pe.category_id = s.category_id and pe.event_id = s.event_id
where pe.points is distinct from s.points
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, source = excluded.source;

-- Division results we credit to a registered racer that are not on their NHRA division sheet (wrong person or
-- a race NHRA didn't score for them): drop them.
insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source)
select 2026, pe.category_id, pe.driver_id, pe.event_id, null, false, false, 'NHRA division sheet 2026: not on racer''s sheet'
from dt.pts_event pe
join dt.points_registration g on g.season = 2026 and g.category_id = pe.category_id and g.driver_id = pe.driver_id and g.scope = 'div'
where pe.season = 2026 and pe.kind = 'div'
  and not exists (select 1 from fx_sheet s where s.driver_id = pe.driver_id and s.category_id = pe.category_id and s.event_id = pe.event_id)
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, source = excluded.source;

refresh materialized view dt.pts_event;
refresh materialized view dt.pts_national;
refresh materialized view dt.pts_division;

-- 5. Check: our division standings vs NHRA's published totals --------------------------------------
select c.slug,
  count(*) as nhra_racers,
  count(*) filter (where d.total = g.nhra_points and d.division = g.division) as exact,
  count(*) filter (where d.driver_id is not null and d.total <> g.nhra_points) as points_off,
  count(*) filter (where d.driver_id is null) as not_listed
from dt.points_registration g
join dt.category c on c.id = g.category_id
left join dt.pts_division d on d.season = g.season and d.category_id = g.category_id and d.driver_id = g.driver_id
where g.season = 2026 and g.scope = 'div'
group by c.slug order by c.slug;
