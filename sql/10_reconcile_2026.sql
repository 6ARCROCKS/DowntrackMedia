-- Downtrack Media: reconcile 2026 NHRA national points with NHRA's own points sheets (all 9 classes, 3,946 racers).
-- The fix itself was computed from the staged NHRA sheets and stored in dt.stage_pdra_sheet (page 'fix/nhra-2026').
--  1. Merge duplicate racer records (same person, two records; results matched race-for-race). Suffix-only pairs (Jr/Sr/II/III) are NOT merged.
--  2. Add racers who are on NHRA's sheets but not in our data.
--  3. Store NHRA's value wherever ours differs: points, win / runner-up, missing results, waivers (null), results not on the racer's NHRA sheet (null).
-- Each row is tagged with why it changed. Safe to re-run.
set statement_timeout = '0';
alter table dt.points_manual alter column points drop not null;

-- 1. Merges ---------------------------------------------------------------
create temp table rc_merge as
select (m->>0)::int as drop_id, (m->>1)::int as keep_id
from dt.stage_pdra_sheet s, jsonb_array_elements(s.ocr_text::jsonb) m
where s.page = 'fix/nhra-2026' and s.image = 'merges';

update dt.entry en set driver_id = m.keep_id from rc_merge m where en.driver_id = m.drop_id;

delete from dt.points_manual pm using rc_merge m
where pm.driver_id = m.drop_id
  and exists (select 1 from dt.points_manual k where k.driver_id = m.keep_id and k.category_id = pm.category_id and k.event_id = pm.event_id);
update dt.points_manual pm set driver_id = m.keep_id from rc_merge m where pm.driver_id = m.drop_id;

-- any other plain table that carries a driver_id (aliases etc.)
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'dt' and c.column_name = 'driver_id'
      and c.table_name not in ('entry', 'points_manual', 'driver')
  loop
    begin
      execute format('update dt.%I x set driver_id = m.keep_id from rc_merge m where x.driver_id = m.drop_id', t.table_name);
    exception when others then
      raise notice 'skipped % (%)', t.table_name, sqlerrm;
    end;
  end loop;
end $$;

update dt.driver d set merged_into = m.keep_id,
  notes = coalesce(d.notes || ' | ', '') || 'Merged into ' || m.keep_id || ' (NHRA reconcile 2026)'
from rc_merge m where d.id = m.drop_id;

-- 2. New racers -------------------------------------------------------------
create temp table rc_new as
select r->>0 as name, (r->>1)::int as category_id, (r->>2)::int as event_id,
       (r->>3)::int as points, (r->>4)::int = 1 as is_win, (r->>5)::int = 1 as is_ru
from dt.stage_pdra_sheet s, jsonb_array_elements(s.ocr_text::jsonb) r
where s.page = 'fix/nhra-2026' and s.image = 'new-racers';

insert into dt.driver (display_name, first_name, last_name, notes)
select distinct n.name, split_part(n.name, ' ', 1), regexp_replace(n.name, '^\S+\s+', ''), 'Added from NHRA points sheet (reconcile 2026)'
from rc_new n
where not exists (select 1 from dt.driver d where lower(d.display_name) = lower(n.name) and d.merged_into is null);

-- 3. NHRA values ---------------------------------------------------------------
create temp table rc_rows as
select (r->>0)::int as driver_id, (r->>1)::int as category_id, (r->>2)::int as event_id,
       case when r->>3 is null or r->>3 = 'null' then null else (r->>3)::int end as points,
       coalesce((r->>4)::int, 0) = 1 as is_win, coalesce((r->>5)::int, 0) = 1 as is_ru, r->>6 as why
from dt.stage_pdra_sheet s, jsonb_array_elements(s.ocr_text::jsonb) r
where s.page = 'fix/nhra-2026' and s.image = 'rows'
union all
select (select d.id from dt.driver d where lower(d.display_name) = lower(n.name) and d.merged_into is null order by d.id limit 1),
       n.category_id, n.event_id, n.points, n.is_win, n.is_ru, 'new racer'
from rc_new n;

insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source)
select distinct on (driver_id, category_id, event_id)
  2026, category_id, driver_id, event_id, points, is_win, is_ru, 'NHRA points sheet: reconcile (' || why || ')'
from rc_rows
where driver_id is not null
order by driver_id, category_id, event_id, points desc nulls last
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, is_win = excluded.is_win, is_ru = excluded.is_ru, source = excluded.source;

select (select count(*) from rc_merge) as merged, (select count(distinct name) from rc_new) as new_racers,
       (select count(*) from dt.points_manual where source like 'NHRA points sheet: reconcile%') as nhra_values;

drop table rc_merge; drop table rc_new; drop table rc_rows;
