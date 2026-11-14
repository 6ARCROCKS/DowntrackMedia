-- Downtrack Media: three driver records whose "name" is spill-over text from a source results file
-- (a sponsor line, a car description, and a street address). The text is removed; results stay attached.
-- Safe to re-run.
update dt.driver
set display_name = 'Unidentified racer #' || id,
    first_name   = 'Unidentified',
    last_name    = 'racer #' || id,
    notes        = coalesce(notes || ' | ', '') || 'Name was source-file spill-over text; cleared ' || current_date
where id in (2518, 8248, 8254)
  and display_name not like 'Unidentified racer%';

select id, display_name from dt.driver where id in (2518, 8248, 8254);
