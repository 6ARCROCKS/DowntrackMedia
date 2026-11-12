import Link from 'next/link';
import { db, byIds, estimate, indexBy } from '@/lib/db';
import { KIND_LABEL, thousands } from '@/lib/metrics';
import { dateRange, todayIso } from '@/lib/format';

export const revalidate = 3600;

export default async function Home() {
  const [runs, drivers, events, cats, recent, episodes] = await Promise.all([
    estimate('run'),
    estimate('driver'),
    estimate('event'),
    db('category?select=id,slug,name,kind,in_scope&order=id'),
    db(`event?select=id,name,start_date,end_date,season,venue_id&start_date=lte.${todayIso()}&order=start_date.desc&limit=24`),
    db('episode?select=id,show,air_date,title,youtube_id&order=air_date.desc&limit=3'),
  ]);

  // Only show events that actually have results loaded.
  const withRaces = new Set(
    (await byIds('race', 'event_id', recent.map((e) => e.id), 'event_id')).map((r) => r.event_id),
  );
  const latest = recent.filter((e) => withRaces.has(e.id)).slice(0, 8);
  const venues = indexBy(await byIds('venue', 'id', latest.map((e) => e.venue_id), 'id,name,city,state'));

  const classes = cats.filter((c) => c.in_scope !== false);
  const kinds = ['pro', 'sportsman', 'bracket'].filter((k) => classes.some((c) => c.kind === k));

  return (
    <div className="stack">
      <section className="hero">
        <span className="eyebrow">The drag racing report</span>
        <h1>
          Every run. Every split. <em>Every racer.</em>
        </h1>
        <p className="lead">
          NHRA pro, sportsman and bracket results with reaction-time, increment and dial-in stats for
          every class and every racer, back to 2022.
        </p>
        <form className="search" action="/drivers" role="search">
          <label htmlFor="home-q" style={{ position: 'absolute', left: -9999 }}>
            Find a racer
          </label>
          <input id="home-q" name="q" placeholder="Find a racer, like Brad Plourd" />
          <button className="btn" type="submit">Search</button>
        </form>
        <div className="tally" aria-label="What's in the database">
          <div><b>{thousands(runs)}</b><span>Runs</span></div>
          <div><b>{thousands(drivers)}</b><span>Racers</span></div>
          <div><b>{thousands(events)}</b><span>Events</span></div>
        </div>
      </section>

      {episodes.length > 0 && (
        <section>
          <div className="section-head"><h2>Latest shows</h2></div>
          <div className="grid">
            {episodes.map((ep) => (
              <a key={ep.id} className="class-link" href={ep.youtube_id ? `https://www.youtube.com/watch?v=${ep.youtube_id}` : '#'}>
                <span>{ep.title}</span>
                <small>{ep.show}</small>
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Latest results</h2>
          <Link href="/events" className="small">All events →</Link>
        </div>
        <div className="panel">
          {latest.length ? (
            <ul className="list">
              {latest.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`}>{e.name}</Link>
                  <span className="muted small num">
                    {venues[e.venue_id]?.name ? `${venues[e.venue_id].name} · ` : ''}
                    {dateRange(e.start_date, e.end_date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">Results will show here as soon as the first event loads.</div>
          )}
        </div>
      </section>

      <section>
        <div className="section-head"><h2>Classes</h2></div>
        <div className="stack" style={{ gap: 18 }}>
          {kinds.map((k) => (
            <div key={k}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>{KIND_LABEL[k]}</div>
              <div className="grid">
                {classes.filter((c) => c.kind === k).map((c) => (
                  <Link key={c.id} href={`/classes/${c.slug}`} className="class-link">
                    <span>{c.name}</span>
                    <small>Stats →</small>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
