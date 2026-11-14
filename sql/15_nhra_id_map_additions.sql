-- Downtrack Media: six NHRA racers whose name matched two of our records; matched by their 2026 results.
-- Run, then re-run 14_rebuild_nhra_overrides_2026.sql. Safe to re-run.
insert into dt.driver_nhra (nhra_id, driver_id, nhra_name) values
  (394685, 1349, 'Richie Crampton'),
  (95927,    89, 'Jeff Veale'),
  (948762,  838, 'Robert McCosh Jr'),
  (276048, 2706, 'John Pulyak'),
  (39366,  5472, 'Hank Stewart Jr'),
  (920917, 1200, 'Daniel T Gallo')
on conflict (nhra_id) do update set driver_id = excluded.driver_id, nhra_name = excluded.nhra_name, updated_at = now();

insert into dt.points_registration (season, category_id, driver_id, scope, division, nhra_points) values
  (2026, 10, 1349, 'nat', null, 253),
  (2026, 10,   89, 'nat', null, 31),
  (2026, 11,  838, 'nat', null, 636),
  (2026, 16, 2706, 'nat', null, 30),
  (2026, 16, 5472, 'nat', null, 30),
  (2026, 16, 1200, 'nat', null, 10)
on conflict (season, category_id, driver_id, scope) do update set nhra_points = excluded.nhra_points;

