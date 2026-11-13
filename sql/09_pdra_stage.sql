-- Downtrack Media: PDRA ingest slot (staging only, nothing touches live tables).
-- The browser reads PDRA's scanned CompuLink sheets and posts the text here with a one-time token.
-- Remove when PDRA loading is finished:  drop function dt.stage_pdra(text, jsonb); delete from dt.ingest_token;

create table if not exists dt.stage_pdra_sheet (
  id         bigserial primary key,
  season     smallint,
  page       text not null,          -- racepdra.com results page path
  image      text not null,          -- full-size image URL
  sheet      text,                   -- 'qualifying' | 'eliminations' | null (unknown)
  ocr_text   text not null,
  parsed     jsonb,                  -- rows parsed in the browser
  created_at timestamptz default now(),
  unique (page, image)
);

create table if not exists dt.ingest_token (token text primary key, purpose text, created_at timestamptz default now());
delete from dt.ingest_token where purpose = 'pdra';
insert into dt.ingest_token values ('<token set at run time>', 'pdra');
revoke all on dt.ingest_token from anon, authenticated;

create or replace function dt.stage_pdra(p_token text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = dt, public
as $$
declare n int;
begin
  if not exists (select 1 from dt.ingest_token where token = p_token and purpose = 'pdra') then
    raise exception 'bad token';
  end if;
  insert into dt.stage_pdra_sheet (season, page, image, sheet, ocr_text, parsed)
  select (r->>'season')::smallint, r->>'page', r->>'image', r->>'sheet', r->>'ocr_text', r->'parsed'
  from jsonb_array_elements(p_rows) r
  on conflict (page, image) do update
    set sheet = excluded.sheet, ocr_text = excluded.ocr_text, parsed = excluded.parsed, created_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function dt.stage_pdra(text, jsonb) from public;
grant execute on function dt.stage_pdra(text, jsonb) to anon;
grant select on dt.stage_pdra_sheet to anon;

notify pgrst, 'reload schema';
select 'PDRA ingest slot ready' as status;
