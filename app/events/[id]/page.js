import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, one, byIds, indexBy } from '@/lib/db';
import { dateRange, placeName } from '@/lib/format';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

const validId = (v) => /^\d+$/.test(String(v));

export async function generateMetadata({ params }) {
  if (!validId(params.id)) return {};
  const e = await one(`event?select=name,season&id=eq.${params.id}`);
  return e ? { title: `${e.name} results`, description: `Winners, runner-ups and every round from the ${e.name}.` } : {};
}

export default async function EventPage({ params }) {
  if (!validId(params.id)) notFound();
  const ev = await one(`event?select=*&id=eq.${params.id}`);
  if (!ev) notFound();

  const [races, cats, venue, series] = await Promise.all([
    db(`race?select=id,category_id,name,field_size,purse_to_win&event_id=eq.${ev.id}`),
    db('category?select=id,slug,name,kind').then(indexBy),
    ev.venue_id ? one(`venue?select=*&id=eq.${ev.venue_id}`) : null,
    ev.series_id ? one(`series?select=name&id=eq.${ev.series_id}`) : null,
  ]);
  const finals = await byIds('entry', 'race_id', races.map((r) => r.id), 'race_id,driver_id,car_no,class_code,is_winner,is_runner_up', '&or=(is_winner.is.true,is_runner_up.is.true)');
  const drivers = indexBy(await byIds('driver', 'id', finals.map((f) => f.driver_id), 'id,display_name'));

  const order = { pro: 0, sportsman: 1, bracket: 2 };
  races.sort((a, b) => (order[cats[a.category_id]?.kind] ?? 9) - (order[cats[b.category_id]?.kind] ?? 9) || a.category_id - b.category_id);

  const person = (f) =>
    f ? (
      <>
        <Link href={`/drivers/${f.driver_id}`}>{drivers[f.driver_id]?.display_name || 'Unknown'}</Link>
        {f.class_code ? <span className="muted small"> · {f.class_code}</span> : null}
      </>
    ) : (
      <span className="muted">—</span>
    );

  return (
    <div className="stack">
      <header>
        <Link href={`/events?season=${ev.season}`} className="small">← {ev.season} results</Link>
        <h1 style={{ marginTop: 6 }}>{ev.name}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          {[series?.name, placeName(venue), dateRange(ev.start_date, ev.end_date)].filter(Boolean).join(' · ')}
        </p>
      </header>

      <section className="panel">
        {races.length ? (
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr><th scope="col">Class</th><th scope="col">Winner</th><th scope="col">Runner-up</th><th scope="col">Field</th><th scope="col"></th></tr>
              </thead>
              <tbody>
                {races.map((r) => {
                  const w = finals.find((f) => f.race_id === r.id && f.is_winner);
                  const ru = finals.find((f) => f.race_id === r.id && f.is_runner_up);
                  return (
                    <tr key={r.id}>
                      <td><b>{cats[r.category_id]?.name || r.name}</b></td>
                      <td style={{ textAlign: 'left' }}>{person(w)}</td>
                      <td style={{ textAlign: 'left' }}>{person(ru)}</td>
                      <td className="flat">{r.field_size || '—'}</td>
                      <td><Link href={`/races/${r.id}`}>Every round →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Results for this event haven't loaded yet.</div>
        )}
      </section>
    </div>
  );
}
