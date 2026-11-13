import Link from 'next/link';
import { notFound } from 'next/navigation';
import { one, all, byIds, indexBy } from '@/lib/db';
import { DIVISIONS, parseScope, scopeHref, pointsRace } from '@/lib/points';
import PointsChart from '@/components/PointsChart';
import SeasonSelect from '@/components/SeasonSelect';
import StandingsTable from '@/components/StandingsTable';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }) {
  const cat = await one(`category?select=name&slug=eq.${encodeURIComponent(params.slug)}`);
  const scope = parseScope(params.p);
  if (!cat || !scope) return {};
  const where = scope.division ? `Division ${scope.division}` : 'National';
  const what = scope.records ? 'records' : 'points';
  return { title: `${cat.name} ${where} ${what}`, description: `${cat.name} ${where.toLowerCase()} Lucas Oil ${what}.` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const monDay = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : '');
const resultOf = (e) => (e.is_win ? 'Win' : e.is_ru ? 'Runner-up' : '');

export default async function PointsPage({ params }) {
  const scope = parseScope(params.p);
  if (!scope) notFound();
  const [cat, rule] = await Promise.all([
    one(`category?select=id,slug,name&slug=eq.${encodeURIComponent(params.slug)}`),
    one(`points_rule?select=*&category_slug=eq.${encodeURIComponent(params.slug)}&order=season_from.desc`),
  ]);
  if (!cat || !rule) notFound();

  const mode = scope.division ? 'division' : 'national';
  if (mode === 'division' && !rule.has_division) notFound();
  if (mode === 'national' && !rule.has_national) {
    return (
      <div className="stack">
        <h1>{cat.name}</h1>
        <div className="card">{cat.name} has divisional standings only. Pick a division:</div>
        <nav className="tabs">{DIVISIONS.map((d) => <Link key={d} href={`/points/${cat.slug}/division-${d}`}>Div. {d}</Link>)}</nav>
      </div>
    );
  }

  const table = mode === 'division' ? 'pts_division' : 'pts_national';
  const divFilter = mode === 'division' ? `&division=eq.${scope.division}` : '';
  const seasonRows = await all(`${table}?select=season&category_id=eq.${cat.id}${divFilter}&rank=eq.1`, { maxRows: 200 });
  const seasons = [...new Set(seasonRows.map((r) => r.season))].sort((a, b) => b - a);
  const latest = seasons[0];
  const thisYear = new Date().getFullYear();

  const tabs = (
    <nav className="tabs" aria-label="Standings">
      {rule.has_national && (
        <Link href={scopeHref(cat.slug, null, null, latest, scope.records)} aria-current={mode === 'national' ? 'page' : undefined}>National</Link>
      )}
      {rule.has_division && DIVISIONS.map((d) => (
        <Link key={d} href={scopeHref(cat.slug, d, null, latest, scope.records)} aria-current={scope.division === d ? 'page' : undefined}>Div. {d}</Link>
      ))}
      <span style={{ width: 12 }} />
      <Link href={scopeHref(cat.slug, scope.division, null, latest)} aria-current={!scope.records ? 'page' : undefined}>Season</Link>
      <Link href={scopeHref(cat.slug, scope.division, null, latest, true)} aria-current={scope.records ? 'page' : undefined}>Records</Link>
    </nav>
  );
  const where = mode === 'division' ? `Division ${scope.division}` : 'National';

  if (scope.records) {
    return <Records cat={cat} mode={mode} scope={scope} table={table} divFilter={divFilter} latest={latest} thisYear={thisYear} tabs={tabs} where={where} />;
  }

  const season = scope.season || latest;
  if (scope.season && !seasons.includes(scope.season)) notFound();
  const live = season === thisYear;

  const standings = season
    ? await all(`${table}?select=*&season=eq.${season}&category_id=eq.${cat.id}${divFilter}&order=rank,driver_id`, { maxRows: 5000 })
    : [];
  const names = indexBy(await byIds('driver', 'id', standings.map((s) => s.driver_id), 'id,display_name'));
  const name = (id) => names[id]?.display_name || 'Unknown racer';

  // Every result this season in this class (for the tap-to-expand lists, the chart and the events panel).
  const evRows = season
    ? await all(`pts_event?select=driver_id,event_id,event_name,event_date,kind,division,points,is_win,is_ru,field_n&season=eq.${season}&category_id=eq.${cat.id}&order=event_date,event_id`, { maxRows: 30000 })
    : [];
  const meta = indexBy(await byIds('event', 'id', [...new Set(evRows.map((e) => e.event_id))], 'id,venue_id'));
  const venues = indexBy(await byIds('venue', 'id', Object.values(meta).map((m) => m.venue_id), 'id,name,city'));
  const place = (eid) => venues[meta[eid]?.venue_id];
  const label = (e) =>
    e.kind === 'nat'
      ? place(e.event_id)?.city || e.event_name
      : `Div ${e.division}${place(e.event_id)?.name ? ` · ${place(e.event_id).name}` : ''}`;

  const inScope = (e) => (mode === 'national' ? true : e.kind === 'div');
  const evBy = {};
  for (const e of evRows) if (inScope(e)) (evBy[e.driver_id] ||= []).push(e);

  const rows = standings.map((s) => {
    const counted = new Set(s.counted_events || []);
    return {
      id: s.driver_id,
      rank: s.rank,
      name: name(s.driver_id),
      total: s.total,
      div: s.div_pts,
      nat: s.nat_pts,
      counted: s.events_counted,
      events: (evBy[s.driver_id] || []).map((e) => ({
        id: e.event_id,
        label: label(e),
        date: monDay(e.event_date),
        points: e.points,
        counted: counted.has(e.event_id),
        result: resultOf(e),
      })),
    };
  });

  const top5 = standings.slice(0, 5);
  const race = pointsRace(Object.fromEntries(top5.map((t) => [t.driver_id, evBy[t.driver_id] || []])), rule, mode,
    Object.fromEntries(top5.map((t) => [t.driver_id, scope.division])));
  const lines = top5.map((t) => ({ id: t.driver_id, name: name(t.driver_id), values: race.series[t.driver_id] || [] }));

  // Events panel: nationals (national view) or that division's events (division view).
  const panelEvents = {};
  for (const e of evRows) {
    if (mode === 'national' ? e.kind !== 'nat' : e.kind !== 'div' || e.division !== scope.division) continue;
    const p = (panelEvents[e.event_id] ||= { id: e.event_id, date: e.event_date, label: label(e), field: e.field_n, win: null, ru: null });
    if (e.is_win) p.win = e.driver_id;
    if (e.is_ru) p.ru = e.driver_id;
  }
  const panel = Object.values(panelEvents).sort((a, b) => a.date.localeCompare(b.date));
  const panelNames = indexBy(await byIds('driver', 'id', panel.flatMap((p) => [p.win, p.ru]), 'id,display_name'));

  const lead = standings[0];
  const second = standings[1];
  const seasonOptions = seasons.map((s) => ({
    season: s,
    label: s === thisYear ? `${s} (live)` : String(s),
    href: scopeHref(cat.slug, scope.division, s, latest),
  }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="season-bar">
        <div className="left">
          <h1 className="ptitle" style={{ fontSize: 24 }}>{season} {cat.name} · {where}</h1>
          <span className={live ? 'badge' : 'badge final'}>{live ? 'Season in progress' : 'Final'}</span>
        </div>
        {seasons.length > 0 && <SeasonSelect options={seasonOptions} current={season} />}
      </div>
      {tabs}

      {!lead ? (
        <div className="card">No points yet for {cat.name} {where.toLowerCase()}{season ? ` in ${season}` : ''}.</div>
      ) : (
        <>
          <div className="hero-row">
            <section className="leader-card">
              <span className="badge">{season} {mode === 'division' ? `Div. ${scope.division} ` : ''}points leader</span>
              <h2 className="who"><Link href={`/drivers/${lead.driver_id}`}>{name(lead.driver_id)}</Link></h2>
              <div className="line">
                {mode === 'national'
                  ? `${lead.total} points · ${lead.div_pts ?? 0} divisional + ${lead.nat_pts ?? 0} national · ${lead.wins} ${lead.wins === 1 ? 'win' : 'wins'}`
                  : `${lead.total} points · ${lead.events_counted} events counted · ${lead.wins} ${lead.wins === 1 ? 'win' : 'wins'}`}
              </div>
            </section>
            <div className="stat-cards">
              <div className="stat-card">
                <span className="k">Runner-up</span>
                {second ? (
                  <>
                    <Link href={`/drivers/${second.driver_id}`} className="name" style={{ textDecoration: 'none' }}>{name(second.driver_id)}</Link>
                    <span className="sub">{second.total} pts</span>
                  </>
                ) : <span className="sub">—</span>}
              </div>
              <div className="stat-card">
                <span className="k">Margin</span>
                <span className="v red">{second ? lead.total - second.total : '—'}</span>
              </div>
              <div className="stat-card">
                <span className="k">{mode === 'national' ? 'Nationals' : 'Div. events'}</span>
                <span className="v">{panel.length}</span>
              </div>
              <div className="stat-card">
                <span className="k">Drivers ranked</span>
                <span className="v">{standings.length}</span>
              </div>
            </div>
          </div>

          <section className="card">
            <h2 className="ptitle">Points race</h2>
            <p className="psub">Each contender's score as the season went on, using the same rules as the final total.</p>
            <div style={{ marginTop: 12 }}><PointsChart dates={race.dates} lines={lines} /></div>
          </section>

          <div className="two-col">
            <section className="card">
              <h2 className="ptitle">Standings</h2>
              <p className="psub">Tap a driver for the events that counted.</p>
              <StandingsTable rows={rows} mode={mode} />
            </section>
            <section className="card">
              <h2 className="ptitle">{mode === 'national' ? 'National events' : `Division ${scope.division} events`}</h2>
              <p className="psub">Open an event for its full results and every round.</p>
              {panel.length ? (
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table className="slip events-table">
                    <thead>
                      <tr><th scope="col">Event</th><th scope="col">Field</th><th scope="col" style={{ textAlign: 'left' }}>Winner</th></tr>
                    </thead>
                    <tbody>
                      {panel.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/events/${p.id}`} className="ev-title">{p.label}</Link>
                            <div className="def">{monYear(p.date)}</div>
                          </td>
                          <td>{p.field || '—'}</td>
                          <td style={{ textAlign: 'left' }}>
                            {p.win ? <Link href={`/drivers/${p.win}`} className="win">{panelNames[p.win]?.display_name}</Link> : <span className="flat">—</span>}
                            {p.ru && <div className="def">def. {panelNames[p.ru]?.display_name}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="psub" style={{ marginTop: 14 }}>No events loaded yet.</p>
              )}
            </section>
          </div>
        </>
      )}

      <p className="small muted" style={{ maxWidth: '72ch' }}>
        Scored with{' '}
        <a href="https://www.nhra.com/how-points-are-earned/lucas-oil-national-championship-points">NHRA's Lucas Oil points rules</a>
        {mode === 'division' ? '. Home division is the division of a racer’s first divisional event of the season' : ''}.
        Points waivers aren't in public results, so totals can differ slightly from NHRA's official standings.
      </p>
    </div>
  );
}

// ---------- Records ----------
function top10(map, sortFn) {
  return Object.entries(map).sort(sortFn).slice(0, 10);
}

async function Records({ cat, mode, scope, table, divFilter, latest, thisYear, tabs, where }) {
  const st = await all(`${table}?select=season,driver_id,total,rank&category_id=eq.${cat.id}${divFilter}&rank=lte.5&order=season,rank`, { maxRows: 5000 });
  const winsRows = await all(
    `pts_event?select=driver_id,season,event_id,event_name,field_n,division&category_id=eq.${cat.id}&is_win=is.true&kind=eq.${mode === 'national' ? 'nat' : 'div'}${mode === 'division' ? `&division=eq.${scope.division}` : ''}`,
    { maxRows: 5000 },
  );
  const meta = indexBy(await byIds('event', 'id', winsRows.map((w) => w.event_id), 'id,venue_id'));
  const venues = indexBy(await byIds('venue', 'id', Object.values(meta).map((m) => m.venue_id), 'id,name,city'));
  const names = indexBy(await byIds('driver', 'id', [...st.map((r) => r.driver_id), ...winsRows.map((w) => w.driver_id)], 'id,display_name'));
  const nm = (id) => names[id]?.display_name || 'Unknown';
  const link = (id) => <Link href={`/drivers/${id}`}>{nm(id)}</Link>;

  const bySeason = {};
  for (const r of st) (bySeason[r.season] ||= []).push(r);
  const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
  const champs = seasons.map((s) => ({ season: s, c: bySeason[s].find((r) => r.rank === 1), ru: bySeason[s].find((r) => r.rank === 2) })).filter((x) => x.c);
  const done = champs.filter((x) => x.season !== thisYear && x.ru);

  const titles = {};
  for (const x of champs) (titles[x.c.driver_id] ||= []).push(x.season);
  const top5 = {};
  for (const r of st) top5[r.driver_id] = (top5[r.driver_id] || 0) + 1;
  const natWins = {};
  for (const w of winsRows) natWins[w.driver_id] = (natWins[w.driver_id] || 0) + 1;
  const b2b = [];
  for (let i = 1; i < champs.length; i++) {
    if (champs[i].season === champs[i - 1].season + 1 && champs[i].c.driver_id === champs[i - 1].c.driver_id) {
      b2b.push({ id: champs[i].c.driver_id, from: champs[i - 1].season, to: champs[i].season });
    }
  }
  const fields = [...winsRows].sort((a, b) => (b.field_n || 0) - (a.field_n || 0)).slice(0, 10);
  const winLabel = mode === 'national' ? 'national' : 'divisional';
  const first = seasons[0];

  const cards = [
    {
      title: 'Most titles',
      items: top10(titles, (a, b) => b[1].length - a[1].length || a[1][0] - b[1][0]).map(([id, yrs]) => (
        <>{link(id)} <b className="red">{yrs.length}</b> <span className="yr">({yrs.join(', ')})</span></>
      )),
    },
    { title: 'Most top-5 seasons', items: top10(top5, (a, b) => b[1] - a[1]).map(([id, n]) => <>{link(id)} <b>{n}</b></>) },
    { title: `Most ${winLabel} wins`, items: top10(natWins, (a, b) => b[1] - a[1]).map(([id, n]) => <>{link(id)} <b>{n}</b></>) },
    {
      title: 'Highest winning totals',
      items: [...champs].sort((a, b) => b.c.total - a.c.total).slice(0, 10).map((x) => <>{link(x.c.driver_id)} <b>{x.c.total}</b> <span className="yr">{x.season}</span></>),
    },
    {
      title: 'Biggest winning margins',
      items: [...done].sort((a, b) => (b.c.total - b.ru.total) - (a.c.total - a.ru.total)).slice(0, 5)
        .map((x) => <><span className="yr">{x.season}</span> {link(x.c.driver_id)} <b className="red">+{x.c.total - x.ru.total}</b></>),
    },
    {
      title: 'Closest title races',
      items: [...done].sort((a, b) => (a.c.total - a.ru.total) - (b.c.total - b.ru.total)).slice(0, 5)
        .map((x) => <><span className="yr">{x.season}</span> {link(x.c.driver_id)} <b className="red">+{x.c.total - x.ru.total}</b> <span className="yr">over {nm(x.ru.driver_id)}</span></>),
    },
    {
      title: `Biggest ${winLabel} fields`,
      items: fields.map((w) => {
        const v = venues[meta[w.event_id]?.venue_id];
        const where = mode === 'national' ? v?.city || w.event_name : v?.name || `Div ${w.division}`;
        return <><span className="yr">{w.season}</span> {where} <b>{w.field_n}</b> <span className="yr">won by</span> {link(w.driver_id)}</>;
      }),
    },
    {
      title: 'Back-to-back champions',
      items: b2b.length ? b2b.map((x) => <><span className="yr">{x.from}–{x.to}</span> {link(x.id)}</>) : [<span className="yr">None yet</span>],
    },
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="season-bar">
        <h1 className="ptitle" style={{ fontSize: 24 }}>{cat.name} · {where} records</h1>
      </div>
      {tabs}
      <section className="card">
        <h2 className="ptitle">Records</h2>
        <p className="psub">{first ? `${first} to today.` : ''} Seasons still in progress are left out of margin records.</p>
        <div className="records-grid" style={{ marginTop: 16 }}>
          {cards.map((c) => (
            <div className="record-card" key={c.title}>
              <h3>{c.title}</h3>
              {c.items.length ? <ol>{c.items.map((it, i) => <li key={i}>{it}</li>)}</ol> : <p className="psub">Not enough seasons yet.</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
