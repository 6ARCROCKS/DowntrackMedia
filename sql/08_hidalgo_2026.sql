-- Downtrack Media: split Jimmy Hidalgo Jr (driver 120) and Jimmy Hidalgo Sr (driver 5915) in 2026 Stock.
-- The source put both on one record (they met in the Belle Rose final). Each now carries its own NHRA sheet
-- (NHRA #377409 Jr = 644, #45844 Sr = 396). Races not on Jr's sheet are dropped from record 120;
-- the stray "Jimmy Hidalgo Jr" record (5303) loses its duplicate Dallas runner-up.
set statement_timeout = '0';
alter table dt.points_manual alter column points drop not null;
delete from dt.points_manual where season = 2026 and source = 'NHRA points sheet: identity';
insert into dt.points_manual (season, category_id, driver_id, event_id, points, is_win, is_ru, source) values
(2026,14,120,1,30,false,false,'NHRA points sheet: identity'),
(2026,14,120,287,72,false,false,'NHRA points sheet: identity'),
(2026,14,120,306,94,false,true,'NHRA points sheet: identity'),
(2026,14,120,307,40,false,false,'NHRA points sheet: identity'),
(2026,14,120,308,40,false,false,'NHRA points sheet: identity'),
(2026,14,120,309,84,false,false,'NHRA points sheet: identity'),
(2026,14,120,299,105,true,false,'NHRA points sheet: identity'),
(2026,14,120,300,40,false,false,'NHRA points sheet: identity'),
(2026,14,120,110,50,false,false,'NHRA points sheet: identity'),
(2026,14,120,312,105,true,false,'NHRA points sheet: identity'),
(2026,14,120,313,51,false,false,'NHRA points sheet: identity'),
(2026,14,120,18,73,false,false,'NHRA points sheet: identity'),
(2026,14,120,314,40,false,false,'NHRA points sheet: identity'),
(2026,14,120,111,61,false,false,'NHRA points sheet: identity'),
(2026,14,120,20,51,false,false,'NHRA points sheet: identity'),
(2026,14,120,341,30,false,false,'NHRA points sheet: identity'),
(2026,14,120,305,null,false,false,'NHRA points sheet: identity'),
(2026,14,5303,309,null,false,false,'NHRA points sheet: identity'),
(2026,14,5915,1,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,287,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,306,105,true,false,'NHRA points sheet: identity'),
(2026,14,5915,307,40,false,false,'NHRA points sheet: identity'),
(2026,14,5915,308,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,309,40,false,false,'NHRA points sheet: identity'),
(2026,14,5915,299,10,false,false,'NHRA points sheet: identity'),
(2026,14,5915,300,50,false,false,'NHRA points sheet: identity'),
(2026,14,5915,110,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,312,51,false,false,'NHRA points sheet: identity'),
(2026,14,5915,313,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,18,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,314,30,false,false,'NHRA points sheet: identity'),
(2026,14,5915,111,50,false,false,'NHRA points sheet: identity')
on conflict (driver_id, category_id, event_id) do update
  set points = excluded.points, is_win = excluded.is_win, is_ru = excluded.is_ru, source = excluded.source;
update dt.driver set display_name = 'Jimmy Hidalgo Jr' where id = 120 and display_name = 'Jimmy Hidalgo';
