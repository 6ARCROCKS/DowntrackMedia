import Link from 'next/link';
import { db, all, byIds, indexBy } from '@/lib/db';
import { dateRange, todayIso } from '@/lib/format';

export const revalidate = 3600;
export const metadata = { title: 'Results' };

export default async function Events({ searchParams }) {
  const seasonsRaw = await all('event?select=season&order=season.desc', { maxRows: 5000 });
  const seasons = [...new Set(seasonsRaw.map((r) => r.season))].filter(Boolean);
  const season = seasons.includes(Number(searchParams?.season)) ? Number(searchParams.season) : seasons[0];

  const evs = season
    ? await db(`event?select=id,name,start_date,end_date,venue_id,series_id&season=eq.${season}&start_date=lte.${todayIso()}&order=start_date.desc`)
    : [];
  const loaded = new Set((await byIds('race', 'event_id', evs.map((e) => e.id), 'event_id')).map((r) => r.event_id));
  const list = evs.filter((e) => loaded.has(e.id));

  const [venues, series] = await Promise.all([
    byIds('venue', 'id', list.map((e) => e.venue_id), 'id,name,city,state').then(indexBy),
    db('series?select=id,code,name').then(indexBy),
  ]);

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Results</span>
        <h1>{season || ''} Results</h1>
        <p className="lead">NHRA national events and Lucas Oil divisionals. Pick an event for every class and every round.</p>
      </header>

      {seasons.length > 1 && (
        <nav className="tabs" aria-label="Season">
          {seasons.map((s) => (
            <Link key={s} href={`/events?season=${s}`} aria-current={s === season ? 'page' : undefined}>{s}</Link>
          ))}
        </nav>
      )}

      <section className="panel">
        {list.length ? (
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr><th scope="col">Event</th><th scope="col">Series</th><th scope="col">Track</th><th scope="col">Dates</th></tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'normal' }}><Link href={`/events/${e.id}`}>{e.name}</Link></td>
                    <td className="flat">{series[e.series_id]?.name || ''}</td>
                    <td className="flat" style={{ whiteSpace: 'normal' }}>{venues[e.venue_id]?.name || ''}</td>
                    <td className="flat">{dateRange(e.start_date, e.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No results loaded for this season yet.</div>
        )}
      </section>
    </div>
  );
}
