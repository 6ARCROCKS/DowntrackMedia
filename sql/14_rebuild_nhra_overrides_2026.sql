-- Downtrack Media: rebuild the 2026 NHRA override layer from NHRA's points sheets (national sheets, 9 classes, plus
-- division sheets, 8 classes), with every NHRA event code matched to one of our events from clean computed results.
-- Replaces the earlier national reconcile (10) and division values (11 step 4 / 13), which had the Canadian
-- SPORTSnationals (NHRA code MC2) attached to the Bristol national. The old rows were backed up to
-- dt.points_manual_backup_20261114 and cleared before this ran. Payload: dt.stage_pdra_sheet page 'fix/nhra-all-2026'.
-- Safe to re-run.
set statement_timeout = '0';

create temp table fx as
select image as part, ocr_text::jsonb as j from dt.stage_pdra_sheet where page = 'fix/nhra-all-2026';

-- 1. Classes NHRA scores as divisional/regional at an event we treat as national (or the reverse)
insert into dt.points_event_override (event_id, category_slug, kind, note)
select (r->>0)::int, r->>1, r->>2, 'From NHRA points sheets (type on ' || (r->>3) || ' sheets)'
from fx cross join lateral jsonb_array_elements(fx.j) r where fx.part = 'overrides'
on conflict (event_id, category_slug) do update set kind = excluded.kind, note = excluded.note;

refresh materialized view dt.pts_event;

-- 2. NHRA's value for every racer / class / event on a sheet
create temp table fx_sheet as
select distinct on (m.driver_id, (r->>1)::int, (r->>2)::int)
  m.driver_id, (r->>1)::int as category_id, (r->>2)::int as event_id,
  case when r->>3 is null or r->>3 = 'null' then null else (r->>3)::int end as points,
  (r->>4)::int = 1 as w, (r->>5)::int = 1 as ru
from fx cross join lateral jsonb_array_elements(fx.j) r
join dt.driver_nhra m on m.nhra_id = (r->>0)::int
where fx.part = 'sheet'
order by m.driver_id, (r->>1)::int, (r->>2)::int, (r->>3)::int desc nulls last;

insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source)
select 2026, s.category_id, s.driver_id, s.event_id, s.points,
       coalesce(pe.is_win, s.w, false), coalesce(pe.is_ru, s.ru, false),
       case when s.points is null then 'NHRA sheet 2026: waived'
            when pe.driver_id is null then 'NHRA sheet 2026: result missing'
            else 'NHRA sheet 2026: points' end
from fx_sheet s
left join dt.pts_event pe on pe.driver_id = s.driver_id and pe.category_id = s.category_id and pe.event_id = s.event_id
where pe.points is distinct from s.points
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, source = excluded.source,
      is_win = dt.points_manual.is_win or excluded.is_win, is_ru = dt.points_manual.is_ru or excluded.is_ru;

-- 3. Results we credit to a racer NHRA has a sheet for, at an event that is not on that sheet: drop them
--    (wrong person, or a qualifying-only entry at a race the class didn't run).
insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source)
select 2026, pe.category_id, pe.driver_id, pe.event_id, null, false, false, 'NHRA sheet 2026: not on racer''s sheet'
from dt.pts_event pe
where pe.season = 2026 and pe.event_date <= date '2026-11-08'
  and exists (select 1 from fx_sheet s where s.driver_id = pe.driver_id and s.category_id = pe.category_id)
  and not exists (select 1 from fx_sheet s where s.driver_id = pe.driver_id and s.category_id = pe.category_id and s.event_id = pe.event_id)
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, source = excluded.source;

refresh materialized view dt.pts_event;
refresh materialized view dt.pts_national;
refresh materialized view dt.pts_division;

-- 4. Check against NHRA's published totals
select g.scope, c.slug, count(*) as nhra_racers,
  count(*) filter (where coalesce(d.total, n.total) = g.nhra_points) as exact
from dt.points_registration g
join dt.category c on c.id = g.category_id
left join dt.pts_division d on g.scope = 'div' and d.season = g.season and d.category_id = g.category_id and d.driver_id = g.driver_id and d.division = g.division
left join dt.pts_national n on g.scope = 'nat' and n.season = g.season and n.category_id = g.category_id and n.driver_id = g.driver_id
where g.season = 2026
group by g.scope, c.slug order by g.scope, c.slug;
