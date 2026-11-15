import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, one, byIds, indexBy } from '@/lib/db';
import { windowFromPath, isIndexClass, isDialInClass, fmt, dragNum, hasHeadsUp, QUALIFIED_ET_CLASSES, KIND_LABEL, isPdra } from '@/lib/metrics';
import StatTable from '@/components/StatTable';
import WindowTabs from '@/components/WindowTabs';

export const revalidate = 3600;
export const dynamicParams = true;

// Prebuild every class's default view at deploy time; other windows build on first visit and stay cached.
export async function generateStaticParams() {
  const cats = await db('category?select=slug,in_scope');
  return cats.filter((c) => c.in_scope !== false && !isPdra(c)).map((c) => ({ slug: c.slug, w: [] }));
}

export async function generateMetadata({ params }) {
  const cat = await one(`category?select=name&slug=eq.${encodeURIComponent(params.slug)}`);
  return cat ? { title: `${cat.name} stats`, description: `${cat.name} reaction times, increments, red-light rate and more.` } : {};
}

// One leaderboard: drivers ranked by a stat, with a minimum number of runs.
async function leaders(catId, win, metric, { order, minRuns, filter = '', valueCol = 'median_val', limit = 10 }) {
  return db(
    `stat_driver?select=driver_id,n,median_val,avg_val&category_id=eq.${catId}&time_window=eq.${win}` +
      `&metric=eq.${metric}&n=gte.${minRuns}${filter}&order=${valueCol}.${order},n.desc&limit=${limit}`,
  );
}

export default async function ClassPage({ params }) {
  const cat = await one(`category?select=*&slug=eq.${encodeURIComponent(params.slug)}`);
  if (!cat) notFound();

  // /classes/<slug>[/<window>]  or  /classes/<slug>/heads-up[/<window>]
  const seg = params.w || [];
  const headsUp = seg[0] === 'heads-up';
  if (headsUp && !hasHeadsUp(cat)) notFound();
  const win = windowFromPath(headsUp ? seg.slice(1) : seg);
  if (!win) notFound();
  const [rows, windowsHave] = await Promise.all([
    db(`stat_category?select=*&category_id=eq.${cat.id}&time_window=eq.${win.key}`),
    db(`stat_category?select=time_window&category_id=eq.${cat.id}&metric=eq.et`),
  ]);
  const available = new Set(windowsHave.map((r) => r.time_window));

  const boards = [
    { title: 'Median reaction time, ranked', note: 'Top 25 · red lights left out', metric: 'rt', order: 'asc', limit: 25 },
    { title: 'Fewest red lights', note: 'Share of starts, most starts first on ties', metric: 'red_light', order: 'asc', valueCol: 'avg_val', minMult: 2 },
  ];
  if (isDialInClass(cat)) {
    boards.push({ title: 'Tightest on the dial', note: 'Median over the dial', metric: 'dial_variance', order: 'asc', filter: '&median_val=gte.0' });
  }
  if (isIndexClass(cat)) {
    boards.push({ title: 'Furthest under the index', note: 'Average under the index in qualifying', metric: 'q_under_index', order: 'desc', valueCol: 'avg_val' });
  } else if (isPdra(cat)) {
    if (!cat.uses_dial) boards.push({ title: 'Quickest average ET', note: 'Average eighth-mile ET, clean runs', metric: 'et', order: 'asc', valueCol: 'avg_val' });
    boards.push({ title: 'Fastest average MPH', note: 'Average eighth-mile speed, clean runs', metric: 'mph', order: 'desc', valueCol: 'avg_val' });
  } else if (QUALIFIED_ET_CLASSES.includes(cat.slug)) {
    boards.push({ title: 'Quickest average ET', note: 'Average ET, clean runs', metric: 'et', order: 'asc', valueCol: 'avg_val' });
  } else {
    boards.push({ title: 'Quickest launch', note: "Median 60'", metric: 'ft60', order: 'asc' });
  }

  const boardRows = await Promise.all(
    (headsUp ? [] : boards).map((b) => leaders(cat.id, win.key, b.metric, { ...b, minRuns: win.minRuns * (b.minMult || 1) })),
  );
  const drivers = indexBy(await byIds('driver', 'id', boardRows.flat().map((r) => r.driver_id), 'id,display_name'));

  // Heads-up tab (Stock, Super Stock): what each racer runs on the index vs what they qualify at.
  let hu = [];
  if (headsUp) {
    const minHu = win.key === 'all' || win.key === '3yr' ? 3 : 2;
    const huRows = await db(
      `stat_driver?select=driver_id,n,median_val,avg_val,std_val&category_id=eq.${cat.id}&time_window=eq.${win.key}` +
        `&metric=eq.headsup_under_index&n=gte.${minHu}&order=median_val.desc,n.desc&limit=200`,
    );
    const ids = huRows.map((r) => r.driver_id);
    const [qRows, huNames] = await Promise.all([
      byIds('stat_driver', 'driver_id', ids, 'driver_id,n,median_val', `&category_id=eq.${cat.id}&time_window=eq.${win.key}&metric=eq.q_under_index`),
      byIds('driver', 'id', ids, 'id,display_name'),
    ]);
    const q = indexBy(qRows, 'driver_id');
    const nm = indexBy(huNames);
    hu = huRows.map((r) => ({
      ...r,
      name: nm[r.driver_id]?.display_name || 'Unknown racer',
      q: q[r.driver_id]?.median_val ?? null,
      gap: q[r.driver_id] ? Number(r.median_val) - Number(q[r.driver_id].median_val) : null,
    }));
  }
  const cls = Object.fromEntries(rows.map((r) => [r.metric, r]));
  const base = `/classes/${cat.slug}`;

  const facts = [
    KIND_LABEL[cat.kind],
    cat.index_et ? `${Number(cat.index_et).toFixed(2)} index` : null,
    isPdra(cat) ? 'PDRA' : null,
    cat.distance_ft === 1000 ? "Races to 1,000'" : cat.distance_ft === 660 ? 'Eighth mile' : 'Quarter mile',
    isPdra(cat) ? 'Elimination rounds only' : null,
    isIndexClass(cat) ? 'Index from each car’s qualifying runs' : null,
  ].filter(Boolean);

  return (
    <div className="stack">
      <header>
        {isPdra(cat)
          ? <Link href="/pdra" className="small">← PDRA</Link>
          : <Link href="/classes" className="small">← All classes</Link>}
        <h1 style={{ marginTop: 6 }}>{cat.name}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>{facts.join(' · ')}</p>
      </header>

      {hasHeadsUp(cat) && (
        <nav className="tabs view-tabs" aria-label="View">
          <Link href={win.key === 'season' ? base : `${base}/${win.key}`} aria-current={!headsUp ? 'page' : undefined} scroll={false}>Class stats</Link>
          <Link href={win.key === 'season' ? `${base}/heads-up` : `${base}/heads-up/${win.key}`} aria-current={headsUp ? 'page' : undefined} scroll={false}>Heads-up data</Link>
        </nav>
      )}

      <WindowTabs basePath={headsUp ? `${base}/heads-up` : base} current={win.key} available={available} />

      {headsUp ? (
        <section className="panel">
          <div className="panel-head">
            <h3>Heads-up runs · {win.label}</h3>
            <span className="small muted">
              Elimination rounds run on the index (no dial under). Under the index = index minus ET.
            </span>
          </div>
          <div className="hu-facts">
            <div><b>{cls.headsup_under_index ? dragNum(cls.headsup_under_index.median_val) : '—'}</b><span>Class median under, heads-up</span></div>
            <div><b>{cls.q_under_index ? dragNum(cls.q_under_index.median_val) : '—'}</b><span>Class median under, qualifying</span></div>
            <div><b>{cls.headsup_rate ? `${(Number(cls.headsup_rate.avg_val) * 100).toFixed(1)}%` : '—'}</b><span>Rounds run heads-up</span></div>
            <div><b>{cls.headsup_under_index ? Number(cls.headsup_under_index.n).toLocaleString('en-US') : '—'}</b><span>Heads-up runs</span></div>
          </div>
          {hu.length ? (
            <div className="table-wrap">
              <table className="slip">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Racer</th>
                    <th scope="col" title="Median of index minus ET in heads-up rounds">Heads-up, under index</th>
                    <th scope="col">Average</th>
                    <th scope="col" title="Standard deviation: lower means more consistent">Spread</th>
                    <th scope="col" title="Median of index minus ET in qualifying">Qualifying, under index</th>
                    <th scope="col" title="Heads-up minus qualifying. + means quicker when it counts">Heads-up vs qualifying</th>
                    <th scope="col">Heads-up runs</th>
                  </tr>
                </thead>
                <tbody>
                  {hu.map((r, i) => (
                    <tr key={r.driver_id}>
                      <td className="flat">{i + 1}</td>
                      <td className="label"><Link href={`/drivers/${r.driver_id}`}>{r.name}</Link></td>
                      <td className="headline">{dragNum(r.median_val, 3, true)}</td>
                      <td>{dragNum(r.avg_val, 3, true)}</td>
                      <td className="flat">{dragNum(r.std_val)}</td>
                      <td>{r.q === null ? '—' : dragNum(r.q, 3, true)}</td>
                      <td className={r.gap === null ? 'flat' : r.gap > 0 ? 'good' : r.gap < 0 ? 'bad' : 'flat'}>{r.gap === null ? '—' : dragNum(r.gap, 3, true)}</td>
                      <td className="flat">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No racer has enough heads-up runs in this window yet. Try Last 3 seasons or All-time.</div>
          )}
        </section>
      ) : (
      <>
      <section className="panel">
        <div className="panel-head">
          <h3>Class numbers · {win.label}</h3>
          <span className="small muted">Median is the headline. Junk runs (lifts, broke runs, byes) are left out.</span>
        </div>
        <StatTable rows={rows} category={cat} />
      </section>

      <section>
        <div className="section-head">
          <h2>Leaders · {win.label}</h2>
          <span className="small muted">Minimum {win.minRuns} runs ({win.minRuns * 2} for red lights)</span>
        </div>
        <div className="grid-2">
          {boards.map((b, i) => (
            <div className="panel" key={b.metric}>
              <div className="panel-head">
                <h3>{b.title}</h3>
                <span className="small muted">{b.note}</span>
              </div>
              {boardRows[i].length ? (
                <ol className="list">
                  {boardRows[i].map((r, j) => (
                    <li key={r.driver_id}>
                      <span>
                        <span className="rank">{j + 1}</span>{' '}
                        <Link href={`/drivers/${r.driver_id}`}>{drivers[r.driver_id]?.display_name || 'Unknown racer'}</Link>
                      </span>
                      <span className="num">
                        <b>{fmt(b.metric, b.valueCol === 'avg_val' ? r.avg_val : r.median_val)}</b>{' '}
                        <span className="muted small">{r.n} runs</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="empty">Not enough runs in this window yet.</div>
              )}
            </div>
          ))}
        </div>
      </section>
      </>
      )}
    </div>
  );
}
