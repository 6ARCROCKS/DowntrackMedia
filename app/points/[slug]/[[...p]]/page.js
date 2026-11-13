import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, one, all, byIds, indexBy } from '@/lib/db';
import { DIVISIONS, parseScope, scopeHref, pointsRace, mustBeat } from '@/lib/points';
import { date } from '@/lib/format';
import PointsChart from '@/components/PointsChart';

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
  return { title: `${cat.name} ${where} points`, description: `${cat.name} ${where.toLowerCase()} Lucas Oil points standings and every counted race.` };
}

const gap = (n) => (n > 0 ? `−${n}` : '—');

export default async function PointsPage({ params }) {
  const scope = parseScope(params.p);
  if (!scope) notFound();
  const [cat, rule] = await Promise.all([
    one(`category?select=id,slug,name&slug=eq.${encodeURIComponent(params.slug)}`),
    one(`points_rule?select=*&category_slug=eq.${encodeURIComponent(params.slug)}&order=season_from.desc`),
  ]);
  if (!cat || !rule) notFound();

  const mode = scope.division ? 'division' : 'national';
  if (mode === 'national' && !rule.has_national) {
    return (
      <div className="stack">
        <header><Link href="/points" className="small">← Points</Link><h1 style={{ marginTop: 6 }}>{cat.name}</h1></header>
        <div className="panel"><div className="empty">{cat.name} has divisional standings only. Pick a division below.</div></div>
        <nav className="tabs">{DIVISIONS.map((d) => <Link key={d} href={`/points/${cat.slug}/division-${d}`}>Div. {d}</Link>)}</nav>
      </div>
    );
  }
  if (mode === 'division' && !rule.has_division) notFound();

  const table = mode === 'division' ? 'pts_division' : 'pts_national';
  const seasonsRaw = await db(`${table}?select=season&category_id=eq.${cat.id}&order=season.desc&limit=1000`);
  const seasons = [...new Set(seasonsRaw.map((r) => r.season))];
  const latest = seasons[0];
  const season = scope.season || latest;
  if (scope.season && !seasons.includes(scope.season)) notFound();

  const divFilter = mode === 'division' ? `&division=eq.${scope.division}` : '';
  const standings = season
    ? await all(`${table}?select=*&season=eq.${season}&category_id=eq.${cat.id}${divFilter}&order=rank,driver_id`, { maxRows: 3000 })
    : [];
  const names = indexBy(await byIds('driver', 'id', standings.map((s) => s.driver_id), 'id,display_name'));

  // Events for the top 10, for the chart and "what's left".
  const top = standings.slice(0, 10);
  const evRows = top.length
    ? await db(`pts_event?select=driver_id,event_id,event_name,event_date,kind,division,points,is_win,is_ru&season=eq.${season}&category_id=eq.${cat.id}&driver_id=in.(${top.map((t) => t.driver_id).join(',')})&order=event_date&limit=2000`)
    : [];
  const evBy = {};
  for (const e of evRows) (evBy[e.driver_id] ||= []).push(e);
  const homeBy = Object.fromEntries(top.map((t) => [t.driver_id, scope.division]));
  const race = pointsRace(
    Object.fromEntries(top.slice(0, 8).map((t) => [t.driver_id, evBy[t.driver_id] || []])),
    rule,
    mode,
    homeBy,
  );
  const lines = top.slice(0, 8).map((t) => ({
    id: t.driver_id,
    name: names[t.driver_id]?.display_name?.split(' ').slice(-1)[0] || '?',
    values: race.series[t.driver_id] || [],
  }));

  const leader = standings[0]?.total || 0;
  const title = mode === 'division' ? `Division ${scope.division}` : 'National';
  const counting =
    mode === 'division'
      ? `Best ${rule.division_best} of the first ${rule.division_first} divisional events, up to ${rule.division_max_out} from outside the home division.`
      : rule.category_slug.startsWith('top-alcohol')
        ? `Best ${rule.div_best} of the first ${rule.div_first} regional events plus best ${rule.nat_best} of the first ${rule.nat_first} national events.`
        : `Best ${rule.div_best} of the first ${rule.div_first} divisional events plus best ${rule.nat_best} of the first ${rule.nat_first} national events.`;

  return (
    <div className="stack">
      <header>
        <Link href="/points" className="small">← Points</Link>
        <h1 style={{ marginTop: 6 }}>{cat.name} · {title}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>{season} Lucas Oil points. {counting}</p>
      </header>

      <nav className="tabs" aria-label="Standings">
        {rule.has_national && (
          <Link href={scopeHref(cat.slug, null, season, latest)} aria-current={mode === 'national' ? 'page' : undefined}>National</Link>
        )}
        {rule.has_division && DIVISIONS.map((d) => (
          <Link key={d} href={scopeHref(cat.slug, d, season, latest)} aria-current={scope.division === d ? 'page' : undefined}>Div. {d}</Link>
        ))}
      </nav>
      {seasons.length > 1 && (
        <nav className="tabs" aria-label="Season">
          {seasons.map((s) => (
            <Link key={s} href={scopeHref(cat.slug, scope.division, s, latest)} aria-current={s === season ? 'page' : undefined}>{s}</Link>
          ))}
        </nav>
      )}

      {!standings.length ? (
        <div className="panel"><div className="empty">No points yet for {cat.name} {title.toLowerCase()} in {season || 'this season'}.</div></div>
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <h3>Points race · top {lines.length}</h3>
              <span className="small muted">Counted points after each race</span>
            </div>
            <div className="panel-body"><PointsChart dates={race.dates} lines={lines} /></div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Standings</h3>
              <span className="small muted">{standings.length} racers</span>
            </div>
            <div className="table-wrap">
              <table className="slip">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col" style={{ textAlign: 'left' }}>Racer</th>
                    <th scope="col">Points</th>
                    <th scope="col" title="Behind the leader">Gap</th>
                    <th scope="col" title="Behind the racer one spot ahead">To next</th>
                    {mode === 'national' ? (
                      <>
                        <th scope="col">Div.</th>
                        <th scope="col">Nat.</th>
                        <th scope="col" title="National events / divisional events entered">N/D</th>
                      </>
                    ) : (
                      <>
                        <th scope="col" title="Events counted">Counted</th>
                        <th scope="col" title="Counted events from outside the home division">Out</th>
                      </>
                    )}
                    <th scope="col">Wins</th>
                    <th scope="col" title="The score a new result has to beat to raise this total">Must beat</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => {
                    const next = i > 0 ? standings[i - 1].total - s.total : 0;
                    const mb = evBy[s.driver_id] ? mustBeat(evBy[s.driver_id], rule, mode, scope.division) : null;
                    return (
                      <tr key={s.driver_id}>
                        <td className="flat">{s.rank}</td>
                        <td style={{ textAlign: 'left' }}>
                          <Link href={`/drivers/${s.driver_id}`}>{names[s.driver_id]?.display_name || 'Unknown racer'}</Link>
                        </td>
                        <td className="headline">{s.total}</td>
                        <td className="flat">{gap(leader - s.total)}</td>
                        <td className="flat">{i ? gap(next) : '—'}</td>
                        {mode === 'national' ? (
                          <>
                            <td>{s.div_pts ?? 0}</td>
                            <td>{s.nat_pts ?? 0}</td>
                            <td className="flat">{s.nat_events}/{s.div_events}</td>
                          </>
                        ) : (
                          <>
                            <td>{s.events_counted}</td>
                            <td className="flat">{s.out_counted || '—'}</td>
                          </>
                        )}
                        <td>{s.wins || '—'}</td>
                        <td className="flat">
                          {!mb ? '' : mb.closed ? 'Done' : mb.open ? `${mb.open} open` : `${mb.beat}+`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>How the leaders got there</h3>
              <span className="small muted">Bold = counted · grey = dropped or not eligible</span>
            </div>
            <div className="table-wrap">
              <table className="slip">
                <thead>
                  <tr><th scope="col" style={{ textAlign: 'left' }}>Racer</th><th scope="col" style={{ textAlign: 'left' }}>Races (points)</th></tr>
                </thead>
                <tbody>
                  {top.map((t) => {
                    const counted = new Set(t.counted_events || []);
                    return (
                      <tr key={t.driver_id}>
                        <td><Link href={`/drivers/${t.driver_id}`}>{names[t.driver_id]?.display_name}</Link></td>
                        <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                          {(evBy[t.driver_id] || [])
                            .filter((e) => mode === 'national' || e.kind === 'div')
                            .map((e, k) => (
                              <span key={e.event_id} title={`${e.event_name} · ${date(e.event_date)}`} style={{ marginRight: 12, display: 'inline-block', color: counted.has(e.event_id) ? 'var(--ink)' : '#9aa3b2', fontWeight: counted.has(e.event_id) ? 700 : 400 }}>
                                <Link href={`/events/${e.event_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                                  {e.kind === 'nat' ? 'Nat' : `D${e.division}`} {date(e.event_date).replace(/, \d{4}$/, '')}
                                </Link>{' '}
                                {e.points}{e.is_win ? ' W' : e.is_ru ? ' RU' : ''}
                              </span>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="small muted" style={{ maxWidth: '70ch' }}>
        Scored with{' '}
        <a href="https://www.nhra.com/how-points-are-earned/lucas-oil-national-championship-points">NHRA's Lucas Oil points rules</a>.
        Points waivers aren't in public results, so totals can differ slightly from NHRA's official standings.
      </p>
    </div>
  );
}
