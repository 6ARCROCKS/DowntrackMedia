import Link from 'next/link';
import { db, all, byIds, indexBy } from '@/lib/db';
import { date, dateRange, todayIso } from '@/lib/format';
import { PDRA_SERIES_ID } from '@/lib/metrics';
import SeriesTabs, { seriesFrom } from '@/components/SeriesTabs';

export const revalidate = 3600;
export const metadata = { title: 'Results' };

export default async function Events({ searchParams }) {
  const sk = seriesFrom(searchParams);
  const pdra = sk === 'pdra';
  const only = `series_id=${pdra ? 'eq' : 'neq'}.${PDRA_SERIES_ID}`;
  const seasonsRaw = await all(`event?select=season&${only}&order=season.desc`, { maxRows: 5000 });
  const seasons = [...new Set(seasonsRaw.map((r) => r.season))].filter(Boolean);
  const season = seasons.includes(Number(searchParams?.season)) ? Number(searchParams.season) : seasons[0];

  const evs = season
    ? await db(`event?select=id,name,start_date,end_date,venue_id,series_id,dates_raw&season=eq.${season}&${only}&start_date=lte.${todayIso()}&order=start_date.desc`)
    : [];
  const races = await byIds('race', 'event_id', evs.map((e) => e.id), 'event_id');
  const nClasses = {};
  for (const r of races) nClasses[r.event_id] = (nClasses[r.event_id] || 0) + 1;
  const list = evs.filter((e) => nClasses[e.id]);

  const [venues, series] = await Promise.all([
    byIds('venue', 'id', list.map((e) => e.venue_id), 'id,name,city,state').then(indexBy),
    db('series?select=id,code,name').then(indexBy),
  ]);
  const anyStar = pdra && list.some((e) => e.dates_raw);

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Results</span>
        <h1>{season || ''} Results</h1>
        <p className="lead">
          {pdra
            ? 'Every PDRA race, class by class and round by round, with reaction time, ET and speed.'
            : 'NHRA national events and Lucas Oil divisionals. Pick an event for every class and every round.'}
        </p>
      </header>

      <SeriesTabs base="/events" current={sk} />

      {seasons.length > 1 && (
        <nav className="tabs" aria-label="Season">
          {seasons.map((s) => (
            <Link key={s} href={`/events?${pdra ? 'series=pdra&' : ''}season=${s}`} aria-current={s === season ? 'page' : undefined} scroll={false}>{s}</Link>
          ))}
        </nav>
      )}

      <section className="panel">
        {list.length ? (
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  {!pdra && <th scope="col">Series</th>}
                  <th scope="col">Track</th>
                  <th scope="col">{pdra ? 'Eliminations' : 'Dates'}</th>
                  <th scope="col">Classes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'normal' }}><Link href={`/events/${e.id}`}>{e.name}</Link></td>
                    {!pdra && <td className="flat">{series[e.series_id]?.name || ''}</td>}
                    <td className="flat" style={{ whiteSpace: 'normal' }}>{venues[e.venue_id]?.name || ''}</td>
                    <td className="flat">{pdra ? `${date(e.start_date)}${e.dates_raw ? ' *' : ''}` : dateRange(e.start_date, e.end_date)}</td>
                    <td className="flat">{nClasses[e.id]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No results loaded for this season yet.</div>
        )}
      </section>
      {pdra && (
        <p className="small muted" style={{ margin: 0 }}>
          Read from the elimination sheets PDRA publishes. A class shows once its ladder checks out round to round, so some
          classes and early seasons are still being added.{anyStar ? ' * Date the results were posted; the sheet date could not be read.' : ''}
        </p>
      )}
    </div>
  );
}
