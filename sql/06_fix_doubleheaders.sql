-- Downtrack Media: repair divisional doubleheaders.
-- Problem: on weekends with two divisional races, the source files race 1's late rounds under race 2
-- (with duplicate race-2 entries for race 1's survivors). Race 1 then looks smaller than it was and
-- race 2 shows two sets of finalists, which breaks points and winners.
-- Rule: in race 2, a pairing at round r belongs to race 1 when its racers all won round r-1 of race 1
-- and are not race-2 winners of round r-1. Those pairings move back to race 1, their runs point at the
-- racer's race-1 entry, emptied duplicate entries are removed, and winner / runner-up flags are reset.
--
-- Step 1 (safe): run this file. It creates the function and shows a summary of every move, then rolls back.
-- Step 2: run   select dt.fix_doubleheaders(true);   then rebuild points (04_points.sql) or wait for the nightly refresh.

create or replace function dt.fix_doubleheaders(p_apply boolean default false)
returns table (category text, race_1 int, race_2 int, round_no int, pairings_moved int)
language plpgsql
as $$
declare
  pr record;
  r int;
  max_r int;
  moved int;
begin
  create temp table if not exists fx_log (category text, race_1 int, race_2 int, round_no int, pairings_moved int) on commit drop;
  create temp table if not exists fx_cand (pid bigint) on commit drop;
  create temp table if not exists fx_dup (pid bigint) on commit drop;
  truncate fx_log;

  -- Candidate pairs: same class, same division series, race 2 starts 1-3 days after race 1.
  for pr in
    select c.slug, ra.id as a_id, rb.id as b_id
    from dt.race ra
    join dt.event ea on ea.id = ra.event_id
    join dt.series s on s.id = ea.series_id and s.code like 'lodrs-d%'
    join dt.event eb on eb.series_id = ea.series_id
                    and eb.start_date between ea.start_date + 1 and ea.start_date + 3
    join dt.race rb on rb.event_id = eb.id and rb.category_id = ra.category_id
    join dt.category c on c.id = ra.category_id
    order by ea.start_date, ra.id
  loop
    select max(p.round_no) into max_r from dt.pairing p where p.race_id = pr.b_id and p.round_type = 'E';
    if max_r is null then continue; end if;

    for r in 2 .. max_r loop
      -- winners of round r-1 in each race (driver level)
      truncate fx_cand;
      insert into fx_cand
      with wa as (
        select distinct en.driver_id from dt.pairing p join dt.run x on x.pairing_id = p.id join dt.entry en on en.id = x.entry_id
        where p.race_id = pr.a_id and p.round_type = 'E' and p.round_no = r - 1 and x.is_win
      ), wb as (
        select distinct en.driver_id from dt.pairing p join dt.run x on x.pairing_id = p.id join dt.entry en on en.id = x.entry_id
        where p.race_id = pr.b_id and p.round_type = 'E' and p.round_no = r - 1 and x.is_win
      )
      select p.id
      from dt.pairing p
      where p.race_id = pr.b_id and p.round_type = 'E' and p.round_no = r
        and exists (select 1 from wa)
        and exists (select 1 from dt.run x where x.pairing_id = p.id)
        and not exists (  -- every racer in the pairing is a race-1 survivor and not a race-2 survivor
          select 1 from dt.run x join dt.entry en on en.id = x.entry_id
          where x.pairing_id = p.id
            and (en.driver_id not in (select driver_id from wa) or en.driver_id in (select driver_id from wb)));
      select count(*) into moved from fx_cand;

      if moved > 0 then
        insert into fx_log values (pr.slug, pr.a_id, pr.b_id, r, moved);
        if p_apply then
          -- the same matchup already stored in race 1: drop the race-2 copy
          truncate fx_dup;
          insert into fx_dup
          select c.pid from fx_cand c
          where exists (
            select 1 from dt.pairing pa
            where pa.race_id = pr.a_id and pa.round_type = 'E' and pa.round_no = r
              and (select array_agg(en.driver_id order by en.driver_id) from dt.run x join dt.entry en on en.id = x.entry_id where x.pairing_id = pa.id)
                = (select array_agg(en.driver_id order by en.driver_id) from dt.run x join dt.entry en on en.id = x.entry_id where x.pairing_id = c.pid));
          delete from dt.run x where x.pairing_id in (select pid from fx_dup);
          delete from dt.pairing p where p.id in (select pid from fx_dup);

          -- everything else moves: runs point at the racer's race-1 entry, pairing renumbered after race 1's own
          update dt.run x
          set entry_id = ea2.id
          from dt.entry eb2, dt.entry ea2
          where x.pairing_id in (select pid from fx_cand where pid not in (select pid from fx_dup))
            and eb2.id = x.entry_id and ea2.race_id = pr.a_id and ea2.driver_id = eb2.driver_id;
          update dt.pairing p
          set race_id = pr.a_id,
              pair_no = coalesce((select max(pa.pair_no) from dt.pairing pa where pa.race_id = pr.a_id and pa.round_code = p.round_code), 0) + p.pair_no
          where p.id in (select pid from fx_cand where pid not in (select pid from fx_dup));
        end if;
      end if;
    end loop;

    if p_apply then
      -- drop race-2 entries left with no runs at all
      delete from dt.entry en
      where en.race_id = pr.b_id
        and not exists (select 1 from dt.run x where x.entry_id = en.id);
      -- reset winner / runner-up from each race's own final
      update dt.entry en set is_winner = false, is_runner_up = false where en.race_id in (pr.a_id, pr.b_id);
      update dt.entry en
      set is_winner = x.is_win, is_runner_up = not x.is_win
      from dt.run x, dt.pairing p
      where x.entry_id = en.id and p.id = x.pairing_id and p.round_type = 'E'
        and p.race_id = en.race_id and en.race_id in (pr.a_id, pr.b_id)
        and p.round_no = (select max(p2.round_no) from dt.pairing p2 where p2.race_id = en.race_id and p2.round_type = 'E')
        and (select count(*) from dt.pairing p3 where p3.race_id = en.race_id and p3.round_type = 'E'
             and p3.round_no = p.round_no) = 1;   -- only when that round is a single final pairing
    end if;
  end loop;

  return query select * from fx_log order by 2, 4;
end
$$;

-- ===== DRY RUN: does the full repair, reports it, then rolls everything back (changes nothing) =====
begin;
select category, count(distinct race_1) as weekends, sum(pairings_moved) as pairings_moved,
       min(round_no) as from_round, max(round_no) as to_round
from dt.fix_doubleheaders(true)
group by category order by category;
rollback;
