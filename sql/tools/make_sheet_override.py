"""Build sql/07_nhra_sheet_2026.sql: NHRA points-sheet values for 2026 races whose published
results are incomplete (bracket check failed), plus every waived (WvEv) result NHRA lists.
Input rows (';'-separated): event_id,category_id,driver_id,points_or_W,is_win,is_ru   (W = waived)"""
import sys
rows = [r.split(',') for r in open(sys.argv[1]).read().strip().split(';') if r]
seen = {}
for ev, cat, d, pts, w, ru in rows:
    k = (ev, cat, d)
    if k not in seen or (pts != 'W' and (seen[k][3] == 'W' or int(pts) > int(seen[k][3]))):
        seen[k] = [ev, cat, d, pts, w, ru]
vals = []
for ev, cat, d, pts, w, ru in seen.values():
    p = 'null' if pts == 'W' else str(int(pts))
    src = "'NHRA points sheet: waived'" if pts == 'W' else "'NHRA points sheet: incomplete results'"
    vals.append(f"(2026,{int(cat)},{int(d)},{int(ev)},{p},{'true' if w=='1' else 'false'},{'true' if ru=='1' else 'false'},{src})")
waived = sum(1 for v in seen.values() if v[3] == 'W')
out = f"""-- Downtrack Media: NHRA points-sheet values for 2026 races with incomplete published results,
-- plus NHRA waivers (WvEv). {len(seen)} rows ({waived} waivers). Safe to re-run.
set statement_timeout = '0';
alter table dt.points_manual alter column points drop not null;
delete from dt.points_manual where season = 2026 and source in ('NHRA points sheet: incomplete results', 'NHRA points sheet: waived');
insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source) values
{(','+chr(10)).join(vals)}
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, is_win = excluded.is_win, is_ru = excluded.is_ru, source = excluded.source;
"""
open(sys.argv[2], 'w').write(out)
print(len(seen), 'rows,', waived, 'waivers')
