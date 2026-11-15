import Link from 'next/link';
import { db, byIds, estimate, indexBy } from '@/lib/db';
import { KIND_LABEL, thousands, isPdra, PDRA_SERIES_ID } from '@/lib/metrics';
import { dateRange, todayIso } from '@/lib/format';

export const revalidate = 3600;

// Short labels for the points board, in NHRA's usual order.
const SHORT = {
  'top-alcohol-dragster': 'TAD',
  'top-alcohol-funny-car': 'TAFC',
  'competition-eliminator': 'Comp',
  'super-stock': 'Super Stock',
  'stock-eliminator': 'Stock',
  'super-comp': 'Super Comp',
  'super-gas': 'Super Gas',
  'top-dragster': 'Top Dragster',
  'top-sportsman': 'Top Sportsman',
};
const ORDER = Object.keys(SHORT);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lastName = (n = '') => n.trim().split(/\s+/).slice(-1)[0];

export default async function Home() {
  const [runs, drivers, events, cats, recent, recentPdra, episodes, seasonRow] = await Promise.all([
    estimate('run'),
    estimate('driver'),
    estimate('event'),
    db('category?select=id,slug,name,kind,in_scope&order=id'),
    db(`event?select=id,name,start_date,end_date,season,venue_id&series_id=neq.${PDRA_SERIES_ID}&start_date=lte.${todayIso()}&order=start_date.desc&limit=24`),
    db(`event?select=id,name,start_date,end_date,season,venue_id&series_id=eq.${PDRA_SERIES_ID}&start_date=lte.${todayIso()}&order=start_date.desc&limit=12`),
    db('episode?select=id,show,air_date,title,youtube_id&order=air_date.desc&limit=3'),
    db('pts_national?select=season&rank=eq.1&order=season.desc&limit=1'),
  ]);
  const season = seasonRow?.[0]?.season;
  const catById = indexBy(cats);

  // National points: top 2 in every class, plus the latest national event's winners.
  const [top2, winners] = season
    ? await Promise.all([
        db(`pts_national?select=category_id,driver_id,total,wins,rank&season=eq.${season}&rank=lte.2&order=category_id,rank,driver_id`),
        db(`pts_event?select=event_id,event_name,event_date,category_id,driver_id&season=eq.${season}&kind=eq.nat&is_win=is.true&order=event_date.desc,category_id&limit=30`),
      ])
    : [[], []];

  const board = [];
  for (const slug of ORDER) {
    const cat = cats.find((c) => c.slug === slug);
    if (!cat) continue;
    const rows = top2.filter((r) => r.category_id === cat.id);
    if (!rows.length) continue;
    const [lead, second] = rows;
    board.push({ cat, lead, second, margin: second ? lead.total - second.total : null });
  }
  const latestEventId = winners[0]?.event_id;
  const lastWins = winners.filter((w) => w.event_id === latestEventId)
    .sort((a, b) => ORDER.indexOf(catById[a.category_id]?.slug) - ORDER.indexOf(catById[b.category_id]?.slug));
  const names = indexBy(await byIds('driver', 'id', [
    ...board.flatMap((b) => [b.lead.driver_id, b.second?.driver_id]),
    ...lastWins.map((w) => w.driver_id),
  ], 'id,display_name'));
  const nm = (id) => names[id]?.display_name || 'Unknown racer';
  const closest = board.filter((b) => b.margin !== null).sort((a, b) => a.margin - b.margin)[0];

  // Latest results, one list per series. Only events that actually have results loaded.
  const withRaces = new Set(
    (await byIds('race', 'event_id', [...recent, ...recentPdra].map((e) => e.id), 'event_id')).map((r) => r.event_id),
  );
  const latest = recent.filter((e) => withRaces.has(e.id)).slice(0, 6);
  const latestPdra = recentPdra.filter((e) => withRaces.has(e.id)).slice(0, 6);
  const venues = indexBy(await byIds('venue', 'id', [...latest, ...latestPdra].map((e) => e.venue_id), 'id,name,city,state'));

  // Winners at the latest PDRA race.
  const pdraEvent = latestPdra[0];
  const pdraRaces = pdraEvent ? await db(`race?select=id,category_id&event_id=eq.${pdraEvent.id}&order=category_id`) : [];
  const pdraWins = pdraRaces.length
    ? await db(`entry?select=race_id,driver_id&race_id=in.(${pdraRaces.map((r) => r.id).join(',')})&is_winner=is.true&driver_id=not.is.null`)
    : [];
  const pdraNames = indexBy(await byIds('driver', 'id', pdraWins.map((w) => w.driver_id), 'id,display_name'));
  const pdraWinners = pdraRaces
    .map((r) => ({ cat: catById[r.category_id], w: pdraWins.find((x) => x.race_id === r.id) }))
    .filter((x) => x.w && x.cat);

  const inScope = cats.filter((c) => c.in_scope !== false);
  const SERIES_BLOCKS = [
    { key: 'nhra', label: 'NHRA', href: '/classes', events: latest, eventsHref: '/events', classes: inScope.filter((c) => !isPdra(c)) },
    { key: 'pdra', label: 'PDRA', href: '/classes?series=pdra', events: latestPdra, eventsHref: '/events?series=pdra', classes: inScope.filter((c) => isPdra(c)) },
  ];
  const kindsOf = (list) => ['pro', 'sportsman', 'bracket'].filter((k) => list.some((c) => c.kind === k));
  const maxMargin = Math.max(1, ...board.map((b) => b.margin || 0));
  const eventDay = lastWins[0]?.event_date;
  const md = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : '');

  return (
    <div className="stack">
      <div className="home-top">
        <section className="hero">
          <span className="eyebrow">The drag racing report</span>
          <h1>
            Every run. Every split. <em>Every racer.</em>
          </h1>
          <p className="lead">
            Who's leaving first, who's running dead on, and who's chasing a championship. NHRA and PDRA
            results for every class and every racer, round by round.
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

        {board.length > 0 && (
          <section className="points-board" aria-labelledby="pb-title">
            <div className="pb-head">
              <h2 id="pb-title">{season} NHRA national points</h2>
              <span className="badge">Leaders</span>
            </div>
            <ol>
              {board.map((b) => (
                <li key={b.cat.id}>
                  <Link href={`/points/${b.cat.slug}`}>
                    <span className="pb-class">{SHORT[b.cat.slug]}</span>
                    <span className="pb-name">{nm(b.lead.driver_id)}</span>
                    <span className="pb-pts">{b.lead.total}</span>
                    <span className="pb-gap" title={b.second ? `${b.margin} ahead of ${nm(b.second.driver_id)}` : ''}>
                      {b.margin !== null ? `+${b.margin}` : ''}
                    </span>
                    <span className="pb-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(6, Math.round(((b.margin || 0) / maxMargin) * 100))}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            <Link href="/points" className="pb-all">All standings, every division →</Link>
          </section>
        )}
      </div>

      {(closest || lastWins.length > 0) && (
        <div className="home-strip">
          {closest && (
            <Link href={`/points/${closest.cat.slug}`} className="title-fight">
              <span className="eyebrow">Tightest title fight</span>
              <span className="tf-margin">{closest.margin}<small>pts</small></span>
              <span className="tf-names">
                {lastName(nm(closest.lead.driver_id))} <em>vs</em> {lastName(nm(closest.second.driver_id))}
              </span>
              <span className="tf-class">{closest.cat.name} · National</span>
            </Link>
          )}
          {lastWins.length > 0 && (
            <section className="winners">
              <div className="section-head" style={{ marginBottom: 10 }}>
                <h2>Latest NHRA winners</h2>
                <Link href={`/events/${latestEventId}`} className="small">
                  {lastWins[0].event_name}
                  {eventDay ? ` · ${MONTHS[Number(eventDay.slice(5, 7)) - 1]} ${Number(eventDay.slice(8, 10))}` : ''} →
                </Link>
              </div>
              <div className="winner-grid">
                {lastWins.map((w) => (
                  <Link key={w.category_id} href={`/drivers/${w.driver_id}`} className="winner">
                    <small>{SHORT[catById[w.category_id]?.slug] || catById[w.category_id]?.name}</small>
                    <span>{nm(w.driver_id)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {pdraWinners.length > 0 && (
        <section className="winners">
          <div className="section-head" style={{ marginBottom: 10 }}>
            <h2>Latest PDRA winners</h2>
            <Link href={`/events/${pdraEvent.id}`} className="small">{pdraEvent.name} · {md(pdraEvent.start_date)} →</Link>
          </div>
          <div className="winner-grid">
            {pdraWinners.map((x) => (
              <Link key={x.cat.id} href={`/drivers/${x.w.driver_id}`} className="winner">
                <small>{x.cat.name}</small>
                <span>{pdraNames[x.w.driver_id]?.display_name || 'Unknown racer'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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

      <div className="series-cols">
        {SERIES_BLOCKS.map((sb) => (
          <section key={sb.key} className="stack" style={{ gap: 16 }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <h2 className="series-title">{sb.label}</h2>
              <Link href={sb.eventsHref} className="small">All {sb.label} results →</Link>
            </div>
            <div className="panel">
              <div className="panel-head"><h3>Latest results</h3></div>
              {sb.events.length ? (
                <ul className="list">
                  {sb.events.map((e) => (
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
            {kindsOf(sb.classes).map((k) => (
              <div key={k}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{sb.label} {KIND_LABEL[k]}</div>
                <div className="grid">
                  {sb.classes.filter((c) => c.kind === k).map((c) => (
                    <Link key={c.id} href={`/classes/${c.slug}`} className="class-link">
                      <span>{c.name}</span>
                      <small>Stats →</small>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
