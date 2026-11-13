-- Downtrack Media: apply the doubleheader repair, load the 2026 Orlando/Dallas work-in, rebuild points.
-- 1) Doubleheader repair (dry run reviewed Nov 13: ~75 weekends, all classes)
-- 2) Work-in points for Div 2 Orlando + Div 4 Dallas (686 results, waived events excluded)
-- 3) Points engine rebuild + check vs NHRA
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


select category, count(distinct race_1) as weekends, sum(pairings_moved) as pairings_moved
from dt.fix_doubleheaders(true)
group by category order by category;

-- Downtrack Media: 2026 work-in points for two divisionals NHRA scored but never published results for.
-- Source: NHRA national standings points-detail sheets (event codes 21-Orlando and 46-Dallas).
-- 686 racer results, 15 racers new to the database. Safe to re-run.

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
select n, split_part(n, ' ', 1), regexp_replace(n, '^\S+\s+', ''), 'Added from NHRA points sheet (2026 work-in)'
from (values ('Aaron Jones'), ('Andrew Sheppard II'), ('Brandon Thomas'), ('Casey Holtzman'), ('Crystal Peterson-Martinez'), ('Hailey Hawkins'), ('Jesse Wareham'), ('Kayla Contardo'), ('Michael South'), ('Monique Ambruosi'), ('Robbie Mayse'), ('Scott Sanders'), ('Shannon Waycaster'), ('Shelby Wood'), ('William Hughes')) v(n)
where not exists (select 1 from dt.driver d where lower(d.display_name) = lower(v.n) and d.merged_into is null);

create temp table wi (code text, category_id int, driver_id int, name text, points int, w boolean, ru boolean);
insert into wi values
('46',12,1062,null,30,false,false),
('46',12,2424,null,52,false,false),
('21',12,107,null,85,true,false),
('46',12,107,null,74,false,true),
('46',12,851,null,30,false,false),
('46',12,1352,null,63,false,false),
('46',12,57,null,41,false,false),
('46',12,2200,null,41,false,false),
('46',12,1485,null,30,false,false),
('46',12,2440,null,41,false,false),
('46',12,3118,null,95,true,false),
('46',12,4078,null,52,false,false),
('21',12,64,null,42,false,false),
('46',12,1486,null,30,false,false),
('46',12,4675,null,30,false,false),
('46',12,5483,null,41,false,false),
('46',12,3120,null,63,false,false),
('46',12,3114,null,41,false,false),
('21',12,1059,null,42,false,false),
('46',12,58,null,52,false,false),
('21',12,110,null,31,false,false),
('21',12,101,null,64,false,true),
('21',12,104,null,31,false,false),
('46',12,4796,null,30,false,false),
('21',12,2153,null,42,false,false),
('21',12,102,null,31,false,false),
('46',12,3079,null,30,false,false),
('21',12,855,null,31,false,false),
('46',12,794,null,52,false,false),
('46',12,5484,null,30,false,false),
('46',12,5310,null,30,false,false),
('21',12,108,null,31,false,false),
('21',12,4119,null,31,false,false),
('46',12,856,null,30,false,false),
('46',12,4795,null,30,false,false),
('46',12,8488,null,30,false,false),
('46',12,3866,null,30,false,false),
('46',12,4602,null,41,false,false),
('46',12,3121,null,30,false,false),
('46',12,8500,null,30,false,false),
('46',12,5507,null,30,false,false),
('21',12,2150,null,53,false,false),
('46',12,424,null,41,false,false),
('46',12,426,null,41,false,false),
('46',13,2148,null,40,false,false),
('46',13,455,null,94,false,true),
('46',13,1271,null,83,false,false),
('46',13,1094,null,30,false,false),
('46',13,780,null,50,false,false),
('46',13,449,null,105,true,false),
('46',13,138,null,40,false,false),
('21',13,112,null,40,false,false),
('46',13,157,null,61,false,false),
('21',13,107,null,51,false,false),
('46',13,3136,null,40,false,false),
('21',13,127,null,30,false,false),
('46',13,1273,null,72,false,false),
('21',13,3996,null,30,false,false),
('21',13,114,null,40,false,false),
('46',13,114,null,40,false,false),
('21',13,135,null,105,true,false),
('46',13,2433,null,30,false,false),
('21',13,155,null,40,false,false),
('46',13,4171,null,40,false,false),
('21',13,139,null,40,false,false),
('46',13,139,null,61,false,false),
('46',13,443,null,30,false,false),
('46',13,3129,null,40,false,false),
('21',13,158,null,51,false,false),
('21',13,115,null,30,false,false),
('21',13,136,null,30,false,false),
('46',13,136,null,61,false,false),
('21',13,144,null,51,false,false),
('21',13,119,null,40,false,false),
('46',13,862,null,40,false,false),
('21',13,2143,null,51,false,false),
('46',13,3089,null,30,false,false),
('21',13,153,null,30,false,false),
('21',13,164,null,62,false,false),
('21',13,148,null,51,false,false),
('21',13,163,null,40,false,false),
('21',13,159,null,30,false,false),
('46',13,159,null,30,false,false),
('21',13,129,null,73,false,false),
('21',13,168,null,30,false,false),
('21',13,150,null,30,false,false),
('46',13,150,null,30,false,false),
('46',13,2437,null,61,false,false),
('21',13,5028,null,40,false,false),
('46',13,134,null,40,false,false),
('46',13,2215,null,40,false,false),
('46',13,3140,null,30,false,false),
('46',13,3122,null,30,false,false),
('21',13,145,null,30,false,false),
('46',13,146,null,40,false,false),
('46',13,2531,null,30,false,false),
('46',13,2442,null,40,false,false),
('21',13,124,null,51,false,false),
('46',13,5439,null,50,false,false),
('21',13,125,null,30,false,false),
('21',13,184,null,30,false,false),
('46',13,184,null,40,false,false),
('46',13,2445,null,50,false,false),
('21',13,156,null,40,false,false),
('46',13,3126,null,30,false,false),
('46',13,3128,null,50,false,false),
('46',13,3138,null,30,false,false),
('46',13,2203,null,30,false,false),
('21',13,160,null,40,false,false),
('46',13,2201,null,40,false,false),
('46',13,3124,null,50,false,false),
('21',13,2526,null,62,false,false),
('21',13,415,null,30,false,false),
('46',13,2439,null,30,false,false),
('21',13,152,null,30,false,false),
('46',13,2926,null,30,false,false),
('46',13,2922,null,40,false,false),
('21',13,170,null,40,false,false),
('21',13,126,null,73,false,false),
('46',13,961,null,30,false,false),
('46',13,5487,null,30,false,false),
('21',13,171,null,10,false,false),
('21',13,169,null,30,false,false),
('21',13,167,null,30,false,false),
('21',13,121,null,84,false,true),
('46',13,3141,null,30,false,false),
('21',13,1287,null,30,false,false),
('46',13,4964,null,30,false,false),
('21',13,161,null,30,false,false),
('21',13,5677,null,30,false,false),
('46',13,5489,null,30,false,false),
('46',13,3123,null,30,false,false),
('46',13,3173,null,50,false,false),
('46',13,3130,null,30,false,false),
('46',13,5491,null,30,false,false),
('46',13,5488,null,30,false,false),
('46',13,4797,null,30,false,false),
('21',13,2150,null,10,false,false),
('21',13,8321,null,30,false,false),
('21',13,5841,null,30,false,false),
('46',13,1836,null,30,false,false),
('46',13,4170,null,40,false,false),
('21',13,7412,null,40,false,false),
('46',13,3144,null,30,false,false),
('46',13,3131,null,30,false,false),
('21',13,2989,null,40,false,false),
('21',13,3370,null,30,false,false),
('21',13,null,'Shelby Wood',30,false,false),
('46',13,3091,null,30,false,false),
('46',13,414,null,30,false,false),
('21',14,158,null,51,false,false),
('46',14,780,null,30,false,false),
('46',14,176,null,83,false,false),
('21',14,1291,null,51,false,false),
('46',14,449,null,105,true,false),
('21',14,187,null,62,false,false),
('46',14,909,null,50,false,false),
('21',14,1298,null,40,false,false),
('46',14,1381,null,61,false,false),
('46',14,939,null,61,false,false),
('46',14,157,null,30,false,false),
('46',14,6629,null,61,false,false),
('46',14,3151,null,94,false,true),
('21',14,4132,null,40,false,false),
('46',14,4132,null,40,false,false),
('46',14,2433,null,30,false,false),
('21',14,178,null,40,false,false),
('46',14,443,null,30,false,false),
('21',14,179,null,62,false,false),
('46',14,2442,null,50,false,false),
('46',14,1390,null,40,false,false),
('21',14,190,null,10,false,false),
('46',14,190,null,30,false,false),
('46',14,2217,null,30,false,false),
('46',14,202,null,30,false,false),
('21',14,135,null,84,false,true),
('21',14,150,null,51,false,false),
('46',14,150,null,30,false,false),
('46',14,1302,null,30,false,false),
('21',14,185,null,51,false,false),
('21',14,3689,null,51,false,false),
('21',14,183,null,30,false,false),
('46',14,134,null,50,false,false),
('46',14,921,null,40,false,false),
('46',14,1393,null,30,false,false),
('46',14,468,null,50,false,false),
('46',14,5495,null,30,false,false),
('21',14,219,null,105,true,false),
('46',14,790,null,30,false,false),
('46',14,3153,null,50,false,false),
('46',14,5492,null,30,false,false),
('46',14,930,null,30,false,false),
('21',14,191,null,40,false,false),
('21',14,1293,null,30,false,false),
('46',14,4171,null,30,false,false),
('21',14,184,null,40,false,false),
('21',14,207,null,30,false,false),
('46',14,862,null,40,false,false),
('21',14,211,null,51,false,false),
('46',14,3092,null,72,false,false),
('21',14,5028,null,30,false,false),
('21',14,224,null,40,false,false),
('21',14,189,null,40,false,false),
('21',14,177,null,40,false,false),
('21',14,214,null,30,false,false),
('21',14,2156,null,73,false,false),
('21',14,220,null,62,false,false),
('21',14,1295,null,62,false,false),
('46',14,3161,null,30,false,false),
('21',14,203,null,30,false,false),
('46',14,3128,null,61,false,false),
('21',14,3911,null,51,false,false),
('46',14,3091,null,30,false,false),
('46',14,2437,null,50,false,false),
('21',14,778,null,30,false,false),
('46',14,3166,null,40,false,false),
('21',14,198,null,30,false,false),
('21',14,223,null,40,false,false),
('46',14,3162,null,40,false,false),
('46',14,3156,null,30,false,false),
('21',14,181,null,30,false,false),
('46',14,3154,null,30,false,false),
('21',14,5075,null,30,false,false),
('46',14,2534,null,30,false,false),
('46',14,null,'William Hughes',30,false,false),
('21',14,144,null,30,false,false),
('21',14,206,null,30,false,false),
('46',14,2931,null,40,false,false),
('46',14,2455,null,30,false,false),
('46',14,1296,null,30,false,false),
('21',14,195,null,30,false,false),
('21',14,186,null,40,false,false),
('46',14,3175,null,40,false,false),
('21',14,199,null,30,false,false),
('46',14,3168,null,40,false,false),
('46',14,3159,null,30,false,false),
('46',14,3165,null,50,false,false),
('46',14,4051,null,30,false,false),
('21',14,2173,null,73,false,false),
('46',14,2203,null,40,false,false),
('21',14,194,null,30,false,false),
('46',14,3171,null,61,false,false),
('21',14,228,null,30,false,false),
('21',14,8323,null,30,false,false),
('21',14,4710,null,30,false,false),
('46',14,426,null,40,false,false),
('46',14,4802,null,40,false,false),
('46',14,5224,null,30,false,false),
('21',14,2153,null,40,false,false),
('21',14,3359,null,30,false,false),
('46',14,4800,null,30,false,false),
('46',14,3147,null,50,false,false),
('21',14,5452,null,30,false,false),
('21',14,8324,null,30,false,false),
('46',14,6837,null,30,false,false),
('46',14,5493,null,30,false,false),
('46',14,2221,null,30,false,false),
('21',14,781,null,30,false,false),
('21',14,3897,null,30,false,false),
('46',14,4039,null,30,false,false),
('46',14,6193,null,30,false,false),
('21',14,6854,null,40,false,false),
('46',14,6219,null,30,false,false),
('21',14,5848,null,40,false,false),
('21',14,218,null,40,false,false),
('21',14,139,null,30,false,false),
('46',14,3233,null,30,false,false),
('21',14,116,null,30,false,false),
('21',14,2740,null,30,false,false),
('46',14,2550,null,30,false,false),
('46',14,null,'Jesse Wareham',30,false,false),
('21',15,3309,null,30,false,false),
('21',15,284,null,51,false,false),
('46',15,284,null,30,false,false),
('21',15,234,null,105,true,false),
('46',15,282,null,40,false,false),
('46',15,951,null,50,false,false),
('46',15,1691,null,30,false,false),
('46',15,493,null,50,false,false),
('46',15,232,null,72,false,false),
('21',15,239,null,62,false,false),
('21',15,13,null,51,false,false),
('46',15,13,null,50,false,false),
('21',15,245,null,30,false,false),
('46',15,1309,null,30,false,false),
('46',15,4681,null,83,false,false),
('21',15,256,null,62,false,false),
('46',15,256,null,61,false,false),
('21',15,253,null,51,false,false),
('46',15,793,null,50,false,false),
('21',15,248,null,40,false,false),
('46',15,502,null,40,false,false),
('46',15,794,null,30,false,false),
('46',15,3013,null,30,false,false),
('46',15,1897,null,40,false,false),
('46',15,3186,null,30,false,false),
('21',15,230,null,40,false,false),
('21',15,7783,null,84,false,true),
('21',15,796,null,10,false,false),
('46',15,796,null,30,false,false),
('21',15,251,null,30,false,false),
('21',15,240,null,40,false,false),
('46',15,237,null,30,false,false),
('21',15,247,null,40,false,false),
('21',15,287,null,30,false,false),
('21',15,288,null,51,false,false),
('46',15,1919,null,30,false,false),
('46',15,944,null,40,false,false),
('46',15,2226,null,50,false,false),
('21',15,112,null,51,false,false),
('46',15,270,null,72,false,false),
('21',15,241,null,30,false,false),
('46',15,792,null,40,false,false),
('46',15,1352,null,105,true,false),
('46',15,521,null,61,false,false),
('46',15,1323,null,40,false,false),
('21',15,254,null,73,false,false),
('46',15,3103,null,61,false,false),
('21',15,255,null,30,false,false),
('21',15,283,null,30,false,false),
('21',15,274,null,73,false,false),
('46',15,16,null,40,false,false),
('46',15,5498,null,30,false,false),
('21',15,277,null,40,false,false),
('46',15,281,null,30,false,false),
('46',15,3177,null,30,false,false),
('46',15,3191,null,30,false,false),
('21',15,1172,null,30,false,false),
('46',15,1172,null,40,false,false),
('46',15,8505,null,40,false,false),
('21',15,273,null,30,false,false),
('46',15,273,null,30,false,false),
('46',15,1563,null,30,false,false),
('46',15,2617,null,40,false,false),
('46',15,3101,null,30,false,false),
('46',15,3183,null,30,false,false),
('46',15,3179,null,30,false,false),
('21',15,5852,null,40,false,false),
('21',15,2163,null,10,false,false),
('46',15,5499,null,61,false,false),
('46',15,1320,null,50,false,false),
('46',15,1921,null,30,false,false),
('46',15,3194,null,50,false,false),
('21',15,285,null,30,false,false),
('21',15,211,null,30,false,false),
('46',15,4807,null,30,false,false),
('46',15,4805,null,61,false,false),
('21',15,266,null,30,false,false),
('46',15,266,null,40,false,false),
('46',15,3193,null,40,false,false),
('21',15,271,null,30,false,false),
('46',15,431,null,30,false,false),
('46',15,4653,null,30,false,false),
('21',15,278,null,30,false,false),
('46',15,513,null,30,false,false),
('46',15,3182,null,50,false,false),
('46',15,3184,null,40,false,false),
('21',15,269,null,30,false,false),
('21',15,268,null,30,false,false),
('46',15,2482,null,30,false,false),
('21',15,171,null,10,false,false),
('46',15,4450,null,30,false,false),
('46',15,6162,null,40,false,false),
('21',15,276,null,51,false,false),
('21',15,5328,null,40,false,false),
('46',15,4986,null,10,false,false),
('46',15,3236,null,30,false,false),
('46',15,4980,null,30,false,false),
('21',15,243,null,62,false,false),
('21',15,246,null,30,false,false),
('21',15,280,null,40,false,false),
('46',15,4982,null,50,false,false),
('46',15,4964,null,40,false,false),
('46',15,6166,null,30,false,false),
('46',15,3180,null,40,false,false),
('46',15,8514,null,30,false,false),
('21',15,1559,null,10,false,false),
('46',15,3190,null,30,false,false),
('21',15,249,null,30,false,false),
('21',15,238,null,30,false,false),
('46',15,3260,null,30,false,false),
('46',15,1908,null,40,false,false),
('46',15,5497,null,40,false,false),
('46',15,3950,null,30,false,false),
('21',15,2537,null,30,false,false),
('46',15,1312,null,30,false,false),
('46',15,8513,null,30,false,false),
('46',15,null,'Casey Holtzman',94,false,true),
('21',15,2542,null,30,false,false),
('46',15,4047,null,50,false,false),
('21',15,308,null,40,false,false),
('21',15,5853,null,40,false,false),
('46',15,3932,null,40,false,false),
('21',15,2794,null,30,false,false),
('46',15,3181,null,30,false,false),
('46',15,5496,null,30,false,false),
('46',15,939,null,50,false,false),
('21',15,320,null,40,false,false),
('21',15,null,'Scott Sanders',40,false,false),
('21',15,7404,null,40,false,false),
('46',15,null,'Robbie Mayse',40,false,false),
('21',15,null,'Shannon Waycaster',30,false,false),
('46',15,6009,null,30,false,false),
('46',15,null,'Aaron Jones',30,false,false),
('21',15,null,'Andrew Sheppard II',10,false,false),
('46',16,4105,null,61,false,false),
('21',16,323,null,40,false,false),
('46',16,944,null,30,false,false),
('21',16,253,null,51,false,false),
('21',16,307,null,40,false,false),
('46',16,307,null,83,false,false),
('21',16,301,null,30,false,false),
('46',16,951,null,50,false,false),
('21',16,287,null,73,false,false),
('46',16,2232,null,40,false,false),
('46',16,2550,null,105,true,false),
('21',16,295,null,40,false,false),
('46',16,295,null,30,false,false),
('21',16,304,null,62,false,false),
('46',16,540,null,30,false,false),
('46',16,3949,null,30,false,false),
('46',16,1309,null,61,false,false),
('21',16,297,null,30,false,false),
('46',16,297,null,50,false,false),
('46',16,541,null,72,false,false),
('21',16,3362,null,84,false,true),
('46',16,3201,null,30,false,false),
('46',16,1937,null,40,false,false),
('46',16,989,null,30,false,false),
('21',16,1568,null,40,false,false),
('21',16,308,null,73,false,false),
('46',16,1333,null,40,false,false),
('21',16,327,null,40,false,false),
('46',16,327,null,50,false,false),
('21',16,283,null,30,false,false),
('46',16,1381,null,72,false,false),
('46',16,4803,null,40,false,false),
('21',16,296,null,51,false,false),
('46',16,1329,null,30,false,false),
('21',16,306,null,30,false,false),
('46',16,802,null,50,false,false),
('21',16,341,null,30,false,false),
('46',16,6866,null,50,false,false),
('46',16,1719,null,40,false,false),
('21',16,332,null,51,false,false),
('46',16,281,null,30,false,false),
('21',16,799,null,40,false,false),
('46',16,4994,null,72,false,false),
('21',16,248,null,62,false,false),
('46',16,2617,null,40,false,false),
('46',16,793,null,40,false,false),
('46',16,3198,null,61,false,false),
('46',16,3203,null,30,false,false),
('46',16,3101,null,40,false,false),
('21',16,7458,null,30,false,false),
('21',16,314,null,51,false,false),
('46',16,3103,null,40,false,false),
('46',16,4051,null,50,false,false),
('46',16,218,null,30,false,false),
('46',16,4629,null,50,false,false),
('21',16,333,null,30,false,false),
('21',16,320,null,40,false,false),
('21',16,311,null,30,false,false),
('46',16,326,null,50,false,false),
('46',16,1908,null,40,false,false),
('46',16,3209,null,30,false,false),
('21',16,310,null,30,false,false),
('46',16,3202,null,40,false,false),
('46',16,3200,null,40,false,false),
('21',16,305,null,62,false,false),
('46',16,1320,null,30,false,false),
('21',16,5863,null,105,true,false),
('46',16,1463,null,10,false,false),
('46',16,4807,null,30,false,false),
('46',16,529,null,30,false,false),
('21',16,246,null,30,false,false),
('46',16,5469,null,40,false,false),
('46',16,3197,null,50,false,false),
('46',16,3179,null,30,false,false),
('46',16,5502,null,30,false,false),
('46',16,1476,null,40,false,false),
('21',16,303,null,30,false,false),
('21',16,324,null,30,false,false),
('21',16,803,null,30,false,false),
('21',16,345,null,40,false,false),
('46',16,3208,null,30,false,false),
('46',16,2849,null,30,false,false),
('46',16,4808,null,30,false,false),
('46',16,3224,null,30,false,false),
('21',16,299,null,40,false,false),
('21',16,5042,null,40,false,false),
('46',16,5501,null,40,false,false),
('21',16,4160,null,30,false,false),
('46',16,6885,null,30,false,false),
('46',16,2178,null,30,false,false),
('21',16,5649,null,40,false,false),
('21',16,315,null,40,false,false),
('46',16,1188,null,40,false,false),
('21',16,800,null,30,false,false),
('46',16,4802,null,40,false,false),
('46',16,513,null,30,false,false),
('46',16,6202,null,30,false,false),
('46',16,3222,null,30,false,false),
('46',16,5500,null,30,false,false),
('46',16,3190,null,40,false,false),
('21',16,316,null,30,false,false),
('21',16,5856,null,51,false,false),
('21',16,312,null,30,false,false),
('46',16,3199,null,30,false,false),
('46',16,3196,null,30,false,false),
('46',16,1722,null,30,false,false),
('46',16,3950,null,30,false,false),
('21',16,340,null,30,false,false),
('21',16,2537,null,51,false,false),
('21',16,5039,null,30,false,false),
('46',16,3215,null,10,false,false),
('21',16,238,null,30,false,false),
('21',16,7881,null,30,false,false),
('21',16,2743,null,30,false,false),
('46',16,3221,null,40,false,false),
('21',16,5858,null,30,false,false),
('46',16,3205,null,30,false,false),
('46',16,3266,null,30,false,false),
('46',16,5002,null,50,false,false),
('46',16,6175,null,30,false,false),
('21',16,2562,null,10,false,false),
('46',16,null,'Michael South',10,false,false),
('46',18,1956,null,41,false,false),
('46',18,2236,null,30,false,false),
('46',18,237,null,63,false,false),
('21',18,806,null,41,false,false),
('46',18,493,null,95,true,false),
('46',18,2187,null,30,false,false),
('21',18,278,null,30,false,false),
('46',18,278,null,30,false,false),
('21',18,347,null,30,false,false),
('21',18,365,null,30,false,false),
('46',18,552,null,52,false,false),
('21',18,351,null,41,false,false),
('46',18,351,null,74,false,true),
('46',18,1897,null,30,false,false),
('46',18,547,null,41,false,false),
('46',18,2553,null,30,false,false),
('46',18,1966,null,41,false,false),
('46',18,265,null,30,false,false),
('46',18,355,null,30,false,false),
('46',18,360,null,63,false,false),
('46',18,521,null,30,false,false),
('21',18,354,null,63,false,false),
('21',18,266,null,52,false,false),
('46',18,266,null,41,false,false),
('21',18,348,null,43,false,false),
('46',18,361,null,30,false,false),
('46',18,3226,null,30,false,false),
('46',18,566,null,52,false,false),
('21',18,275,null,95,true,false),
('46',18,1027,null,41,false,false),
('46',18,3230,null,30,false,false),
('46',18,3497,null,41,false,false),
('21',18,2182,null,74,false,true),
('21',18,284,null,30,false,false),
('46',18,3228,null,30,false,false),
('46',18,3227,null,41,false,false),
('21',18,256,null,42,false,false),
('46',18,256,null,30,false,false),
('46',18,562,null,30,false,false),
('46',18,3209,null,30,false,false),
('21',18,816,null,52,false,false),
('21',18,346,null,30,false,false),
('21',18,368,null,52,false,false),
('46',18,1028,null,30,false,false),
('21',18,5345,null,30,false,false),
('21',18,352,null,30,false,false),
('46',18,3773,null,30,false,false),
('21',18,2186,null,41,false,false),
('21',18,358,null,30,false,false),
('46',18,3229,null,52,false,false),
('46',18,8518,null,30,false,false),
('46',18,4059,null,30,false,false),
('46',18,5504,null,30,false,false),
('46',18,null,'Crystal Peterson-Martinez',30,false,false),
('21',18,357,null,10,false,false),
('46',18,null,'Kayla Contardo',30,false,false),
('46',18,6125,null,41,false,false),
('46',18,8429,null,30,false,false),
('21',18,5860,null,30,false,false),
('46',18,4739,null,30,false,false),
('21',18,350,null,30,false,false),
('21',18,356,null,30,false,false),
('21',18,5591,null,63,false,false),
('21',18,369,null,30,false,false),
('21',18,2185,null,30,false,false),
('21',18,null,'Brandon Thomas',52,false,false),
('21',18,null,'Hailey Hawkins',41,false,false),
('21',18,null,'Monique Ambruosi',41,false,false),
('21',18,5896,null,30,false,false),
('46',18,3238,null,30,false,false),
('46',19,2500,null,30,false,false),
('46',19,2499,null,52,false,false),
('21',19,378,null,63,false,false),
('46',19,1616,null,41,false,false),
('46',19,391,null,30,false,false),
('46',19,1342,null,63,false,false),
('46',19,1036,null,30,false,false),
('21',19,370,null,52,false,false),
('46',19,1436,null,41,false,false),
('46',19,571,null,41,false,false),
('46',19,360,null,30,false,false),
('46',19,1966,null,30,false,false),
('21',19,383,null,52,false,false),
('46',19,383,null,30,false,false),
('21',19,159,null,41,false,false),
('46',19,159,null,30,false,false),
('46',19,1980,null,41,false,false),
('46',19,390,null,30,false,false),
('21',19,532,null,30,false,false),
('46',19,1732,null,30,false,false),
('21',19,5332,null,41,false,false),
('46',19,4067,null,41,false,false),
('21',19,376,null,30,false,false),
('46',19,5594,null,41,false,false),
('46',19,1625,null,30,false,false),
('21',19,377,null,41,false,false),
('46',19,380,null,30,false,false),
('21',19,379,null,41,false,false),
('46',19,5505,null,74,false,true),
('46',19,804,null,30,false,false),
('21',19,6721,null,95,true,false),
('46',19,2563,null,30,false,false),
('46',19,3246,null,30,false,false),
('46',19,2962,null,95,true,false),
('46',19,1435,null,41,false,false),
('46',19,1629,null,30,false,false),
('21',19,333,null,41,false,false),
('46',19,3236,null,52,false,false),
('46',19,3234,null,30,false,false),
('46',19,5165,null,30,false,false),
('46',19,5506,null,30,false,false),
('21',19,288,null,30,false,false),
('46',19,3226,null,52,false,false),
('46',19,2752,null,30,false,false),
('46',19,3237,null,52,false,false),
('46',19,3243,null,63,false,false),
('21',19,395,null,30,false,false),
('21',19,389,null,74,false,true),
('46',19,4833,null,41,false,false),
('21',19,2562,null,30,false,false),
('21',19,346,null,30,false,false),
('21',19,393,null,30,false,false),
('21',19,4142,null,30,false,false),
('21',19,4146,null,30,false,false),
('46',13,120,null,30,false,false),
('46',13,1818,null,50,false,false),
('46',13,5486,null,72,false,false),
('21',13,2212,null,30,false,false),
('46',13,3142,null,30,false,false),
('46',13,3148,null,40,false,false),
('46',13,5490,null,30,false,false),
('46',13,5287,null,50,false,false),
('46',13,1828,null,30,false,false),
('46',13,1835,null,40,false,false),
('46',14,120,null,40,false,false),
('46',14,4043,null,50,false,false),
('46',14,4803,null,40,false,false),
('46',14,3373,null,40,false,false),
('46',14,4042,null,40,false,false),
('21',14,175,null,30,false,false),
('46',15,5455,null,30,false,false),
('46',15,4987,null,40,false,false),
('46',15,499,null,30,false,false),
('46',15,798,null,40,false,false),
('46',15,961,null,30,false,false),
('46',15,3185,null,10,false,false),
('21',15,2162,null,30,false,false),
('46',15,3192,null,30,false,false),
('46',15,4717,null,30,false,false),
('46',15,4984,null,30,false,false),
('46',16,801,null,30,false,false),
('46',16,1323,null,61,false,false),
('46',16,499,null,94,false,true),
('46',16,3211,null,40,false,false),
('46',16,2490,null,30,false,false),
('46',16,3210,null,40,false,false),
('46',16,1936,null,30,false,false),
('46',18,3225,null,30,false,false),
('46',18,3972,null,30,false,false);

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


-- ===== Rebuild the points engine =====
-- Downtrack Media: Lucas Oil points engine (NHRA rules)
-- Source: https://www.nhra.com/how-points-are-earned/lucas-oil-national-championship-points
-- Builds: per-event points, national standings, divisional standings.
-- Run once in Supabase > SQL Editor. Safe to re-run. Refreshes nightly with the stats.

set statement_timeout = '0';

-- 1. Counting rules per class (editable without code; season range for future rule changes)
create table if not exists dt.points_rule (
  category_slug text not null,
  season_from   smallint not null default 2022,
  season_to     smallint not null default 2100,
  div_first     smallint,           -- eligible: first N divisional/regional events entered
  div_best      smallint,           -- best N of those count (national total)
  nat_first     smallint,           -- eligible: first N national events entered
  nat_best      smallint,           -- best N of those count
  has_national  boolean not null default true,
  has_division  boolean not null default true,
  division_first smallint default 8, -- division program: events eligible
  division_best  smallint default 5, -- division program: best N count
  division_max_out smallint default 2, -- division program: max out-of-division events counted
  primary key (category_slug, season_from)
);

insert into dt.points_rule (category_slug, div_first, div_best, nat_first, nat_best, has_national, has_division)
values
  ('super-stock',            8, 5,  6, 3, true,  true),
  ('stock-eliminator',       8, 5,  6, 3, true,  true),
  ('super-comp',             8, 5,  6, 3, true,  true),
  ('super-gas',              8, 5,  6, 3, true,  true),
  ('competition-eliminator', 8, 5,  5, 3, true,  true),
  ('top-dragster',           8, 5,  5, 3, true,  true),
  ('top-sportsman',          8, 5,  5, 3, true,  true),
  -- Top Alcohol: first 5 regional (best 3) + first 10 national (best 7). Regional program not built yet.
  ('top-alcohol-dragster',   5, 3, 10, 7, true,  false),
  ('top-alcohol-funny-car',  5, 3, 10, 7, true,  false),
  -- Super Street: division only (NHRA has no national; Mike: none yet).
  ('super-street',           8, 5,  0, 0, false, true)
on conflict (category_slug, season_from) do nothing;

-- 1b. Events NHRA scores differently from their series (from NHRA's per-driver points sheets)
create table if not exists dt.points_event_override (
  event_id int primary key,
  kind     text not null check (kind in ('nat','div')),
  note     text
);
insert into dt.points_event_override (event_id, kind, note) values
  -- 2026 SPORTSnationals: divisional race first, SPORTSnationals second on the same weekend
  (307, 'nat', '2026 Cajun SPORTSnationals, No Problem Raceway, Belle Rose (Mar 27-29)'),
  (324, 'nat', '2026 Canadian SPORTSnationals, Mission Raceway Park (Jun 11-12)'),
  (284, 'nat', '2026 Testo Chesapeake SPORTSnationals, Cecil County Dragway (moved to Aug)'),
  (300, 'nat', '2026 JEGS SPORTSnationals, Beech Bend, Bowling Green (BK1, moved to Aug 26-30)')
on conflict (event_id) do update set kind = excluded.kind, note = excluded.note;

-- 1c. Work-in points for races NHRA scored but never published results for (from NHRA points sheets).
--     Real results always win: a manual row is used only when no result exists for that racer, class and event.
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

-- 2. Points for a finish (NHRA table). lost_round = elimination round lost in (1 = first round).
create or replace function dt.lodrs_points(p_slug text, p_field int, p_lost int, p_win boolean, p_ru boolean)
returns int language sql immutable as $$
  select case
    when p_slug like 'top-alcohol-%' then
      case when p_win then 100 when p_ru then 80
           when p_field <= 4 then 40
           when p_field <= 8 then case p_lost when 1 then 40 else 60 end
           else case p_lost when 1 then 20 when 2 then 40 else 60 end end
    else
      (select case when p_win then w when p_ru then ru
                   else coalesce(l[least(greatest(p_lost, 1), array_length(l, 1))], l[1]) end
       from (values
         (4,    array[33],                   64,  85),
         (8,    array[32,43],                64,  85),
         (16,   array[31,42,53],             64,  85),
         (32,   array[30,41,52,63],          74,  95),
         (64,   array[30,40,51,62,73],       84, 105),
         (128,  array[30,40,50,61,72,83],    94, 105),
         (99999,array[30,40,50,60,71,82,93],104, 115)
       ) t(maxf, l, ru, w)
       where p_field <= maxf order by maxf limit 1)
  end
$$;

-- Top Alcohol qualifying points by position (plus 10 for a valid attempt)
create or replace function dt.ta_qual_points(p_pos int)
returns int language sql immutable as $$
  select case when p_pos is null then 0 when p_pos = 1 then 8 when p_pos = 2 then 7 when p_pos = 3 then 6
              when p_pos = 4 then 5 when p_pos <= 6 then 4 when p_pos <= 8 then 3
              when p_pos <= 12 then 2 when p_pos <= 16 then 1 else 0 end
$$;

-- 3. Points earned at every event, per driver and class
drop materialized view if exists dt.pts_division cascade;
drop materialized view if exists dt.pts_national cascade;
drop materialized view if exists dt.pts_event cascade;

create materialized view dt.pts_event as
with elim as (
  select p.race_id, r.entry_id, max(p.round_no) as last_round
  from dt.pairing p
  join dt.run r on r.pairing_id = p.id
  where p.round_type = 'E'
  group by p.race_id, r.entry_id
),
field as (  -- NHRA scores by ladder size: a 7-round ladder is the 65-128 car row, and so on
  select race_id, count(*) as field_n, max(last_round) as rounds_n from elim group by race_id
),
base as (
  select
    en.id as entry_id, en.driver_id, ra.category_id, c.slug, ev.season, ev.id as event_id, ev.name as event_name,
    coalesce(ev.start_date, ra.race_date) as event_date,
    coalesce(o.kind, case when s.code = 'nhra-national' then 'nat'
         when s.code like 'lodrs-d%' then 'div' end) as kind,
    nullif(substring(s.code from 'lodrs-d(\d+)'), '')::smallint as division,
    coalesce(nullif(ra.field_size, 0), f.field_n, 0) as field_n,   -- cars entered (shown on the site)
    coalesce((2 ^ least(f.rounds_n, 10))::int, nullif(ra.field_size, 0), f.field_n, 0) as ladder_n,  -- used for points
    e.last_round, coalesce(en.is_winner, false) as is_win, coalesce(en.is_runner_up, false) as is_ru,
    en.qual_pos
  from dt.entry en
  join dt.race ra     on ra.id = en.race_id
  join dt.event ev    on ev.id = ra.event_id
  join dt.series s    on s.id = ev.series_id
  join dt.category c  on c.id = ra.category_id
  left join elim e    on e.race_id = ra.id and e.entry_id = en.id
  left join field f   on f.race_id = ra.id
  left join dt.points_event_override o on o.event_id = ev.id
  where en.driver_id is not null
    and c.slug in (select category_slug from dt.points_rule)
    and (s.code = 'nhra-national' or s.code like 'lodrs-d%')
),
scored as (
  select b.*,
    case
      when b.last_round is null and not b.is_win then 10   -- non-qualifier / no-show
      else dt.lodrs_points(b.slug, b.ladder_n::int, b.last_round::int, b.is_win, b.is_ru)
    end
    + case when b.slug like 'top-alcohol-%' then 10 + dt.ta_qual_points(b.qual_pos::int) else 0 end as points
  from base b
  where b.kind is not null
),
manual as (
  select null::bigint as entry_id, m.driver_id, m.category_id, c.slug, m.season, ev.id as event_id, ev.name as event_name,
    ev.start_date as event_date,
    coalesce(o.kind, case when s.code = 'nhra-national' then 'nat' when s.code like 'lodrs-d%' then 'div' end) as kind,
    nullif(substring(s.code from 'lodrs-d(\d+)'), '')::smallint as division,
    null::bigint as field_n, null::int as last_round, m.is_win, m.is_ru, m.points
  from dt.points_manual m
  join dt.event ev   on ev.id = m.event_id
  join dt.series s   on s.id = ev.series_id
  join dt.category c on c.id = m.category_id
  left join dt.points_event_override o on o.event_id = ev.id
  where not exists (select 1 from scored x where x.driver_id = m.driver_id and x.category_id = m.category_id and x.event_id = m.event_id)
)
-- One score per driver per event per class (keep the best if entered twice)
select distinct on (driver_id, category_id, event_id)
  entry_id, driver_id, category_id, slug, season, event_id, event_name, event_date, kind, division,
  field_n, last_round, is_win, is_ru, points
from (
  select entry_id, driver_id, category_id, slug, season, event_id, event_name, event_date, kind, division,
         field_n::bigint, last_round::int, is_win, is_ru, points from scored
  union all
  select * from manual
) u
order by driver_id, category_id, event_id, points desc;

create unique index pts_event_pk on dt.pts_event (driver_id, category_id, event_id);
create index pts_event_season on dt.pts_event (season, category_id);

-- 4. National standings: first N divisional + first N national entered; best N of each count
create materialized view dt.pts_national as
with r as (
  select pe.*, pr.div_first, pr.div_best, pr.nat_first, pr.nat_best,
    row_number() over (partition by driver_id, category_id, season, kind order by event_date, event_id) as nth
  from dt.pts_event pe
  join dt.points_rule pr on pr.category_slug = pe.slug and pe.season between pr.season_from and pr.season_to
  where pr.has_national
),
elig as (
  select r.*,
    row_number() over (partition by driver_id, category_id, season, kind order by points desc, event_date) as best_rank
  from r
  where (kind = 'div' and nth <= div_first) or (kind = 'nat' and nth <= nat_first)
),
counted as (
  select * from elig
  where (kind = 'div' and best_rank <= div_best) or (kind = 'nat' and best_rank <= nat_best)
),
tot as (
  select season, category_id, driver_id,
    sum(points)                                   as total,
    sum(points) filter (where kind = 'div')       as div_pts,
    sum(points) filter (where kind = 'nat')       as nat_pts,
    count(*) filter (where kind = 'div')          as div_counted,
    count(*) filter (where kind = 'nat')          as nat_counted,
    array_agg(event_id order by event_date)       as counted_events
  from counted
  group by season, category_id, driver_id
),
att as (
  select season, category_id, driver_id,
    count(*) filter (where kind = 'nat') as nat_events,
    count(*) filter (where kind = 'div') as div_events,
    count(*) filter (where is_win)       as wins,
    count(*) filter (where is_ru)        as runner_ups
  from dt.pts_event group by season, category_id, driver_id
)
select t.*, coalesce(a.nat_events, 0) as nat_events, coalesce(a.div_events, 0) as div_events,
  coalesce(a.wins, 0) as wins, coalesce(a.runner_ups, 0) as runner_ups,
  rank() over (partition by t.season, t.category_id order by t.total desc) as rank
from tot t
left join att a using (season, category_id, driver_id);

create unique index pts_national_pk on dt.pts_national (season, category_id, driver_id);

-- 5. Divisional standings: home division = the division raced most that season (NHRA uses the declared home division).
--    First 8 divisional events eligible; best 5 count, at most 2 from outside the home division.
create materialized view dt.pts_division as
with home as (  -- home division: the one raced most that season (ties: the one raced first)
  select distinct on (driver_id, category_id, season) driver_id, category_id, season, division as home_div
  from (
    select driver_id, category_id, season, division, count(*) as n, min(event_date) as first_date
    from dt.pts_event where kind = 'div' and division is not null
    group by driver_id, category_id, season, division
  ) x
  order by driver_id, category_id, season, n desc, first_date
),
d as (
  select pe.*, pr.division_first, pr.division_best, pr.division_max_out,
    row_number() over (partition by pe.driver_id, pe.category_id, pe.season order by pe.event_date, pe.event_id) as nth,
    h.home_div
  from dt.pts_event pe
  join dt.points_rule pr on pr.category_slug = pe.slug and pe.season between pr.season_from and pr.season_to
  join home h on h.driver_id = pe.driver_id and h.category_id = pe.category_id and h.season = pe.season
  where pe.kind = 'div' and pr.has_division
),
elig as (
  select d.*, (division = home_div) as is_home,
    row_number() over (partition by driver_id, category_id, season, (division = home_div)
                       order by points desc, event_date) as side_rank
  from d where nth <= division_first
),
cand as (  -- every home event, plus the best out-of-division events up to the cap
  select * from elig where is_home or side_rank <= division_max_out
),
best as (
  select cand.*, row_number() over (partition by driver_id, category_id, season order by points desc, event_date) as best_rank
  from cand
),
counted as (select * from best where best_rank <= division_best),
tot as (
  select season, category_id, home_div as division, driver_id,
    sum(points) as total,
    count(*) as events_counted,
    count(*) filter (where not is_home) as out_counted,
    array_agg(event_id order by event_date) as counted_events
  from counted group by season, category_id, home_div, driver_id
),
att as (
  select season, category_id, driver_id,
    count(*) as div_events,
    count(*) filter (where is_win) as wins,
    count(*) filter (where is_ru)  as runner_ups
  from dt.pts_event where kind = 'div' group by season, category_id, driver_id
)
select t.*, a.div_events, a.wins, a.runner_ups,
  rank() over (partition by t.season, t.category_id, t.division order by t.total desc) as rank
from tot t join att a using (season, category_id, driver_id)
where t.division is not null;

create unique index pts_division_pk on dt.pts_division (season, category_id, division, driver_id);

-- 6. Public read access
grant select on dt.pts_event, dt.pts_national, dt.pts_division, dt.points_rule, dt.points_event_override, dt.points_manual to anon, authenticated;

-- 7. Refresh with the nightly stats run
create or replace function dt.refresh_stats()
returns void
language sql
security definer
set search_path = dt, public
as $$
  refresh materialized view concurrently dt.stat_category;
  refresh materialized view concurrently dt.stat_driver;
  refresh materialized view concurrently dt.pts_event;
  refresh materialized view concurrently dt.pts_national;
  refresh materialized view concurrently dt.pts_division;
$$;
revoke execute on function dt.refresh_stats() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- 8. Check vs NHRA 2026 Stock: Adkinson 655, Hidalgo Jr 644, Santangelo 633, Brand 623, Oakes 600, Theobald 581, Strickland 567
select n.rank, d.display_name, n.total, n.div_pts, n.nat_pts
from dt.pts_national n
join dt.driver d on d.id = n.driver_id
join dt.category c on c.id = n.category_id
where n.season = 2026 and c.slug = 'stock-eliminator'
order by n.rank limit 10;
