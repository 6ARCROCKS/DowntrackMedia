"""Build sql/05_workin_2026.sql from NHRA points-sheet rows.

Input (one row per racer per race, ';'-separated):
  code,category_id,driver_id_or_"Name",points,is_win,is_ru
  code 21 = Div 2 Orlando (Feb 27-28, 2026), code 46 = Div 4 Texas Motorplex (Oct 12-13, 2026).
NHRA scored both races but never published round-by-round results, so these rows
carry points only (no timeslips). Real results replace them automatically if NHRA posts them.
"""
import csv, io, sys

src = open(sys.argv[1]).read().strip()
rows = list(csv.reader(io.StringIO(src.replace(';', '\n'))))

def q(s):
    return "'" + s.replace("'", "''") + "'"

# One row per racer per class per race (keep the higher score if a name mapped twice),
# then winner = the single top score, runner-up = the single second score.
best = {}
for code, cat, who, pts, _w, _ru in rows:
    k = (code, cat, who)
    if k not in best or int(pts) > int(best[k][3]):
        best[k] = [code, cat, who, pts, '0', '0']
rows = list(best.values())
from collections import defaultdict
groups = defaultdict(list)
for r in rows:
    groups[(r[0], r[1])].append(r)
for g in groups.values():
    scores = sorted({int(r[3]) for r in g}, reverse=True)
    for i, flag in ((0, 4), (1, 5)):
        if len(scores) > i:
            top = [r for r in g if int(r[3]) == scores[i]]
            if len(top) == 1:
                top[0][flag] = '1'

new_names = sorted({r[2] for r in rows if not r[2].strip().isdigit()})
vals = []
for code, cat, who, pts, w, ru in rows:
    did = who if who.strip().isdigit() else 'null'
    name = 'null' if who.strip().isdigit() else q(who)
    vals.append(f"('{code}',{int(cat)},{did},{name},{int(pts)},{'true' if w == '1' else 'false'},{'true' if ru == '1' else 'false'})")

out = f"""-- Downtrack Media: 2026 work-in points for two divisionals NHRA scored but never published results for.
-- Source: NHRA national standings points-detail sheets (event codes 21-Orlando and 46-Dallas).
-- {len(rows)} racer results, {len(new_names)} racers new to the database. Safe to re-run.

set statement_timeout = '0';

create table if not exists dt.points_manual (
  season      smallint not null,
  category_id int      not null,
  driver_id   int      not null,
  event_id    int      not null,
  points      int      not null,
  is_win      boolean  not null default false,
  is_ru       boolean  not null default false,
  source      text,
  primary key (driver_id, category_id, event_id)
);

-- Start clean so a re-run replaces earlier work-in rows (waived events are left out: NHRA type WvEv)
delete from dt.points_manual where season = 2026 and source like 'NHRA points sheet%';

-- Orlando Speed World, Div 2 (NHRA's results pages for Feb 27-28 say "No Results")
insert into dt.event (series_id, source_id, source_key, season, name, start_date, end_date, dates_raw, source_url)
select s.id, 1, '2026/d2/20260227', 2026, 'Lucas Oil Division 2 — Feb 27, 2026', date '2026-02-27', date '2026-02-28',
       'Feb 27-28, 2026', 'https://www.nhra.com/results/2026/lucas-oil-drag-racing-series/d2/20260227'
from dt.series s
where s.code = 'lodrs-d2'
  and not exists (select 1 from dt.event e where e.source_key = '2026/d2/20260227');

-- Racers who only appear in these two races
insert into dt.driver (display_name, first_name, last_name, notes)
select n, split_part(n, ' ', 1), regexp_replace(n, '^\\S+\\s+', ''), 'Added from NHRA points sheet (2026 work-in)'
from (values {', '.join('(' + q(n) + ')' for n in new_names)}) v(n)
where not exists (select 1 from dt.driver d where lower(d.display_name) = lower(v.n) and d.merged_into is null);

create temp table wi (code text, category_id int, driver_id int, name text, points int, w boolean, ru boolean);
insert into wi values
{(','+chr(10)).join(vals)};

update wi set driver_id = (select d.id from dt.driver d where lower(d.display_name) = lower(wi.name) and d.merged_into is null order by d.id limit 1)
where driver_id is null;

insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source)
select distinct on (wi.driver_id, wi.category_id, ev.id)
  2026, wi.category_id, wi.driver_id, ev.id, wi.points, wi.w, wi.ru,
  case wi.code when '21' then 'NHRA points sheet: 21-Orlando' else 'NHRA points sheet: 46-Dallas' end
from wi
join dt.event ev on ev.id = case wi.code when '21' then (select id from dt.event where source_key = '2026/d2/20260227') else 314 end
where wi.driver_id is not null
order by wi.driver_id, wi.category_id, ev.id, wi.points desc
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, is_win = excluded.is_win, is_ru = excluded.is_ru, source = excluded.source;

grant select on dt.points_manual to anon, authenticated;

drop table if exists wi;

select count(*) as work_in_rows, count(*) filter (where source like '%Orlando') as orlando, count(*) filter (where source like '%Dallas') as dallas
from dt.points_manual where season = 2026;
"""
open(sys.argv[2], 'w').write(out)
print(len(rows), 'rows,', len(new_names), 'new racers')
