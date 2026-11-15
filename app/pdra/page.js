import Link from 'next/link';
import { db, all, byIds, indexBy } from '@/lib/db';
import { KIND_LABEL, PDRA_SERIES_ID, isPdra, thousands } from '@/lib/metrics';
import { date } from '@/lib/format';

export const revalidate = 3600;
export const metadata = {
  title: 'PDRA',
  description: 'PDRA eighth-mile results and stats: every class, every round, reaction times, ETs and speeds, 2019 to today.',
};

export default async function Pdra({ searchParams }) {
  const [catsAll, evs] = await Promise.all([
    db('category?select=id,slug,name,kind,uses_dial,index_et,in_scope&order=id'),
    all(`event?select=id,name,season,start_date,venue_id,dates_raw&series_id=eq.${PDRA_SERIES_ID}&order=start_date.desc`, { maxRows: 2000 }),
  ]);
  const cats = catsAll.filter((c) => isPdra(c) && c.in_scope !== false);
  const seasons = [...new Set(evs.map((e) => e.season))].sort((a, b) => b - a);
  const season = seasons.includes(Number(searchParams?.season)) ? Number(searchParams.season) : seasons[0];
  const list = evs.filter((e) => e.season === season);

  const [races, venues] = await Promise.all([
    byIds('race', 'event_id', list.map((e) => e.id), 'id,event_id,status'),
    byIds('venue', 'id', list.map((e) => e.venue_id), 'id,name,city,state').then(indexBy),
  ]);
  const nClasses = {};
  for (const r of races) nClasses[r.event_id] = (nClasses[r.event_id] || 0) + 1;
  const kinds = ['pro', 'sportsman', 'bracket'].filter((k) => cats.some((c) => c.kind === k));

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Professional Drag Racers Association</span>
        <h1>PDRA</h1>
        <p className="lead">
          Eighth-mile doorslammer racing, kept on its own page: PDRA classes, PDRA events and PDRA racers, separate from the
          NHRA numbers. Every elimination round with reaction time, ET and speed, {seasons.length ? `${seasons[seasons.length - 1]} to ${seasons[0]}` : '2019 to today'}.
        </p>
        <form className="search" action="/drivers" role="search" style={{ marginTop: 14 }}>
          <input type="hidden" name="org" value="pdra" />
          <label htmlFor="pdra-q" style={{ position: 'absolute', left: -9999 }}>Find a PDRA racer</label>
          <input id="pdra-q" name="q" placeholder="Find a PDRA racer" />
          <button className="btn" type="submit">Search</button>
        </form>
      </header>

      {cats.length === 0 && <div className="panel"><div className="empty">PDRA results are loading. Check back shortly.</div></div>}

      {kinds.map((k) => (
        <section key={k}>
          <div className="section-head"><h2>{KIND_LABEL[k]} classes</h2></div>
          <div className="grid">
            {cats.filter((c) => c.kind === k).map((c) => (
              <Link key={c.id} href={`/classes/${c.slug}`} className="class-link">
                <span>{c.name}</span>
                <small>{c.index_et ? `${Number(c.index_et).toFixed(2)} index` : c.uses_dial ? 'Dial-in' : 'Heads-up'}</small>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {seasons.length > 0 && (
        <section>
          <div className="section-head"><h2>{season} results</h2></div>
          {seasons.length > 1 && (
            <nav className="tabs" aria-label="Season" style={{ marginBottom: 12 }}>
              {seasons.map((s) => (
                <Link key={s} href={`/pdra?season=${s}`} aria-current={s === season ? 'page' : undefined} scroll={false}>{s}</Link>
              ))}
            </nav>
          )}
          <div className="panel">
            <div className="table-wrap">
              <table className="slip">
                <thead>
                  <tr><th scope="col">Event</th><th scope="col">Track</th><th scope="col">Eliminations</th><th scope="col">Classes loaded</th></tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'normal' }}><Link href={`/events/${e.id}`}>{e.name}</Link></td>
                      <td className="flat" style={{ whiteSpace: 'normal' }}>{venues[e.venue_id]?.name || ''}</td>
                      <td className="flat">{date(e.start_date)}{e.dates_raw ? ' *' : ''}</td>
                      <td className="flat">{thousands(nClasses[e.id] || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            Read from the elimination sheets PDRA publishes. A class is shown only when its full ladder checks out round to
            round, so some classes and some early-season races are still missing. * Date is when the results were posted;
            the sheet's own date could not be read.
          </p>
        </section>
      )}
    </div>
  );
}
