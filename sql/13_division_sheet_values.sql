-- Downtrack Media: re-apply NHRA division-sheet event values (2026) from the staged sheet rows.
-- Corrects Super Street: NHRA codes 111/310/410/610 are the SPORTSnationals Super Street races (events 284/300/307/324),
-- not the divisional race on the same weekend. Safe to re-run.
set statement_timeout = '0';

create temp table fx as
select image as part, ocr_text::jsonb as j from dt.stage_pdra_sheet where page = 'fix/nhra-div-2026';

delete from dt.points_manual where source like 'NHRA division sheet 2026%';

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
