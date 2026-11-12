import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, one, byIds, indexBy } from '@/lib/db';
import { windowFor, isIndexClass, isDialInClass, fmt, KIND_LABEL } from '@/lib/metrics';
import StatTable from '@/components/StatTable';
import WindowTabs from '@/components/WindowTabs';

export const revalidate = 3600;

export async function generateMetadata({ params }) {
  const cat = await one(`category?select=name&slug=eq.${encodeURIComponent(params.slug)}`);
  return cat ? { title: `${cat.name} stats`, description: `${cat.name} reaction times, increments, red-light rate and more.` } : {};
}

// One leaderboard: drivers ranked by a stat, with a minimum number of runs.
async function leaders(catId, win, metric, { order, minRuns, filter = '', valueCol = 'median_val' }) {
  return db(
    `stat_driver?select=driver_id,n,median_val,avg_val&category_id=eq.${catId}&time_window=eq.${win}` +
      `&metric=eq.${metric}&n=gte.${minRuns}${filter}&order=${valueCol}.${order},n.desc&limit=10`,
  );
}

export default async function ClassPage({ params, searchParams }) {
  const cat = await one(`category?select=*&slug=eq.${encodeURIComponent(params.slug)}`);
  if (!cat) notFound();

  const win = windowFor(searchParams?.w);
  const [rows, windowsHave] = await Promise.all([
    db(`stat_category?select=*&category_id=eq.${cat.id}&time_window=eq.${win.key}`),
    db(`stat_category?select=time_window&category_id=eq.${cat.id}&metric=eq.et`),
  ]);
  const available = new Set(windowsHave.map((r) => r.time_window));

  const boards = [
    { title: 'Best on the tree', note: 'Median reaction time', metric: 'rt', order: 'asc' },
    { title: 'Fewest red lights', note: 'Share of starts', metric: 'red_light', order: 'asc', valueCol: 'avg_val' },
  ];
  if (isDialInClass(cat)) {
    boards.push({ title: 'Tightest on the dial', note: 'Median over the dial', metric: 'dial_variance', order: 'asc', filter: '&median_val=gte.0' });
  }
  if (isIndexClass(cat)) {
    boards.push({ title: 'Deepest qualifiers', note: 'Median under the index', metric: 'q_under_index', order: 'desc' });
  } else {
    boards.push({ title: 'Quickest launch', note: "Median 60'", metric: 'ft60', order: 'asc' });
  }

  const boardRows = await Promise.all(
    boards.map((b) => leaders(cat.id, win.key, b.metric, { ...b, minRuns: win.minRuns })),
  );
  const drivers = indexBy(await byIds('driver', 'id', boardRows.flat().map((r) => r.driver_id), 'id,display_name'));

  const facts = [
    KIND_LABEL[cat.kind],
    cat.index_et ? `${Number(cat.index_et).toFixed(2)} index` : null,
    cat.distance_ft === 1000 ? "Races to 1,000'" : "Quarter mile",
    isIndexClass(cat) ? 'Index from each car’s qualifying runs' : null,
  ].filter(Boolean);

  return (
    <div className="stack">
      <header>
        <Link href="/classes" className="small">← All classes</Link>
        <h1 style={{ marginTop: 6 }}>{cat.name}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>{facts.join(' · ')}</p>
      </header>

      <WindowTabs basePath={`/classes/${cat.slug}`} current={win.key} available={available} />

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
          <span className="small muted">Minimum {win.minRuns} runs</span>
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
    </div>
  );
}
