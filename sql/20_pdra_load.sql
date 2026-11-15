-- Downtrack Media: PDRA (Professional Drag Racers Association) into the database, kept separate from NHRA.
--   * series 'pdra', source 'pdra', PDRA classes (ids 101-120, org = 'pdra', 660 ft), PDRA racers (dt.driver.org = 'pdra').
--   * PDRA racers are their own records: never matched or merged with NHRA racers.
--   * Data: elimination sheets read from racepdra.com, bracket-verified (sql/tools/pdra_*.py). Sheets have reaction time,
--     dial-in, ET and MPH only (no 60-ft or other increments, no lanes: lane holds the print order, 1 = winner).
-- Payload: dt.stage_pdra_sheet page 'load/pdra' (staged from sql/data/pdra/load/pdra_load_v1.json).
-- Re-running reloads all PDRA races from the staged file.
set statement_timeout = '0';

do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'dt.series'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%sanction%' loop
    execute format('alter table dt.series drop constraint %I', c);
  end loop;
end $$;
alter table dt.series add constraint series_sanction_check check (sanction in ('NHRA', 'bracket', 'PDRA'));
insert into dt.series (id, code, name, sanction) values (60, 'pdra', 'PDRA', 'PDRA') on conflict (id) do nothing;
insert into dt.source (id, code, name, base_url) values (6, 'pdra', 'PDRA results sheets (racepdra.com)', 'https://racepdra.com/results')
on conflict (id) do nothing;

alter table dt.category add column if not exists org text not null default 'nhra';
alter table dt.driver   add column if not exists org text not null default 'nhra';
create index if not exists driver_org on dt.driver (org);

create temp table px as
select ocr_text::jsonb as j from dt.stage_pdra_sheet where page = 'load/pdra' order by id desc limit 1;

-- classes
insert into dt.category (id, slug, code, name, kind, uses_dial, index_et, distance_ft, in_scope, org)
select (c->>0)::smallint, c->>1, c->>2, c->>3, c->>4, (c->>5)::boolean, nullif(c->>6, 'null')::numeric, 660, true, 'pdra'
from px cross join lateral jsonb_array_elements(px.j->'cats') c
on conflict (id) do update set slug = excluded.slug, code = excluded.code, name = excluded.name, kind = excluded.kind,
  uses_dial = excluded.uses_dial, index_et = excluded.index_et, distance_ft = 660, org = 'pdra';

-- tracks
insert into dt.venue (name, city, state)
select distinct e->'venue'->>0, e->'venue'->>1, e->'venue'->>2
from px cross join lateral jsonb_array_elements(px.j->'events') e
where jsonb_typeof(e->'venue') = 'array'
on conflict (name) do nothing;
update dt.venue v set city = coalesce(v.city, x.city), state = coalesce(v.state, x.state)
from (select distinct e->'venue'->>0 as name, e->'venue'->>1 as city, e->'venue'->>2 as state
      from px cross join lateral jsonb_array_elements(px.j->'events') e where jsonb_typeof(e->'venue') = 'array') x
where v.name = x.name and (v.city is null or v.state is null);

-- events (date = the elimination day printed on the sheets; where a sheet date could not be read, the results post date)
insert into dt.event (series_id, source_id, source_key, season, name, venue_id, start_date, end_date, dates_raw, source_url)
select 60, 6, e->>'key', (e->>'season')::smallint, e->>'name',
       (select v.id from dt.venue v where v.name = e->'venue'->>0),
       (e->>'date')::date, (e->>'date')::date,
       case when (e->>'date_from_sheet')::boolean then null else 'date approximate (results post date)' end, e->>'url'
from px cross join lateral jsonb_array_elements(px.j->'events') e
on conflict (source_id, source_key) do update set name = excluded.name, venue_id = excluded.venue_id,
  start_date = excluded.start_date, end_date = excluded.end_date, dates_raw = excluded.dates_raw, season = excluded.season;

-- racers (PDRA only; key kept in notes so a reload finds the same record)
create temp table pd as
select d->>0 as dkey, d->>1 as name, nullif(d->>2, 'null') as hometown
from px cross join lateral jsonb_array_elements(px.j->'drivers') d;
insert into dt.driver (display_name, first_name, last_name, hometown, org, notes)
select pd.name, split_part(pd.name, ' ', 1), regexp_replace(pd.name, '^\S+\s+', ''), pd.hometown, 'pdra', 'pdra:' || pd.dkey
from pd where not exists (select 1 from dt.driver d where d.org = 'pdra' and d.notes = 'pdra:' || pd.dkey);
update dt.driver d set display_name = pd.name, first_name = split_part(pd.name, ' ', 1),
  last_name = regexp_replace(pd.name, '^\S+\s+', ''), hometown = pd.hometown
from pd where d.org = 'pdra' and d.notes = 'pdra:' || pd.dkey and (d.display_name, d.hometown) is distinct from (pd.name, pd.hometown);

-- reload: clear PDRA races (entries, pairings and runs go with them)
delete from dt.race where event_id in (select id from dt.event where source_id = 6);

create temp table pr as
select (o - 1)::int as idx, nextval('dt.race_id_seq')::int as id, r->>0 as ekey, r->>1 as slug, r->>2 as status, (r->>3)::smallint as field
from px cross join lateral jsonb_array_elements(px.j->'races') with ordinality as t(r, o);
insert into dt.race (id, event_id, category_id, field_size, status, verification)
select pr.id, ev.id, c.id, pr.field, pr.status, 'verified'
from pr join dt.event ev on ev.source_id = 6 and ev.source_key = pr.ekey join dt.category c on c.slug = pr.slug;

create temp table pe as
select (o - 1)::int as idx, nextval('dt.entry_id_seq')::int as id, (e->>0)::int as ridx, nullif(e->>1, 'null') as dkey, e->>2 as car,
       nullif(e->>3, 'null')::smallint as qual, (e->>4)::boolean as w, (e->>5)::boolean as ru, e->>6 as fin
from px cross join lateral jsonb_array_elements(px.j->'entries') with ordinality as t(e, o);
insert into dt.entry (id, race_id, driver_id, car_no, class_code, qual_pos, finish_round, is_winner, is_runner_up)
select pe.id, pr.id, d.id, pe.car, c.code, pe.qual, pe.fin, pe.w, pe.ru
from pe join pr on pr.idx = pe.ridx join dt.category c on c.slug = pr.slug
left join dt.driver d on d.org = 'pdra' and d.notes = 'pdra:' || pe.dkey;

create temp table pu as
select (u->>0)::int as ridx, (u->>1)::smallint as rnd, (u->>2)::smallint as pair, (u->>3)::smallint as slot, (u->>4)::int as eidx,
       nullif(u->>5, 'null')::numeric as rt, nullif(u->>6, 'null')::numeric as dial, nullif(u->>7, 'null')::numeric as et,
       nullif(u->>8, 'null')::numeric as mph, (u->>9)::boolean as win, nullif(u->>10, 'null')::boolean as red, nullif(u->>11, 'null')::boolean as brk
from px cross join lateral jsonb_array_elements(px.j->'runs') u;
create temp table pp as
select ridx, rnd, pair, nextval('dt.pairing_id_seq') as id from (select distinct ridx, rnd, pair from pu) x;
insert into dt.pairing (id, race_id, round_code, round_type, round_no, pair_no)
select pp.id, pr.id, 'E' || pp.rnd, 'E', pp.rnd, pp.pair from pp join pr on pr.idx = pp.ridx;
-- red_light, breakout and package are generated columns (from rt and ov_un)
insert into dt.run (pairing_id, entry_id, lane, dial, rt, et, mph, ov_un, is_win)
select pp.id, pe.id, case pu.slot when 0 then 'single' else pu.slot::text end, pu.dial,
       pu.rt, pu.et, pu.mph, round(pu.et - pu.dial, 3), pu.win
from pu join pp on pp.ridx = pu.ridx and pp.rnd = pu.rnd and pp.pair = pu.pair join pe on pe.idx = pu.eidx;

notify pgrst, 'reload schema';
-- Then run on its own, as a separate query (it takes ~30 minutes; keeping it out of this run keeps table locks short):
--   select dt.refresh_stats();

select (select count(*) from dt.event where source_id = 6) as events,
       (select count(*) from dt.race ra join dt.event ev on ev.id = ra.event_id where ev.source_id = 6) as races,
       (select count(*) from dt.driver where org = 'pdra') as racers,
       (select count(*) from dt.entry en join dt.race ra on ra.id = en.race_id join dt.event ev on ev.id = ra.event_id where ev.source_id = 6) as entries,
       (select count(*) from dt.run ru join dt.pairing p on p.id = ru.pairing_id join dt.race ra on ra.id = p.race_id join dt.event ev on ev.id = ra.event_id where ev.source_id = 6) as runs;
