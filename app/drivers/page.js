import Link from 'next/link';
import { db, byIds, indexBy } from '@/lib/db';

export const revalidate = 3600;
export const metadata = { title: 'Racers' };

export default async function Drivers({ searchParams }) {
  const q = (searchParams?.q || '').trim().slice(0, 60);
  // PostgREST pattern: strip characters that have meaning in the filter syntax.
  const safe = q.replace(/[*,()%"\\]/g, ' ').trim();

  let results = [];
  let active = [];
  if (safe) {
    const words = safe.split(/\s+/).filter(Boolean);
    const filters = words.map((w) => `&display_name=ilike.*${encodeURIComponent(w)}*`).join('');
    results = await db(`driver?select=id,display_name,hometown,state&merged_into=is.null${filters}&order=display_name&limit=50`);
  } else {
    const top = await db('stat_driver?select=driver_id,category_id,n&time_window=eq.season&metric=eq.red_light&order=n.desc&limit=40');
    const names = indexBy(await byIds('driver', 'id', top.map((t) => t.driver_id), 'id,display_name'));
    const cats = indexBy(await db('category?select=id,name'));
    const seen = new Set();
    active = top
      .filter((t) => (seen.has(t.driver_id) ? false : seen.add(t.driver_id)))
      .slice(0, 24)
      .map((t) => ({ ...t, name: names[t.driver_id]?.display_name, cat: cats[t.category_id]?.name }));
  }

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Racer stats</span>
        <h1>Racers</h1>
        <form className="search" role="search" style={{ marginTop: 14 }}>
          <label htmlFor="q" style={{ position: 'absolute', left: -9999 }}>Racer name</label>
          <input id="q" name="q" defaultValue={q} placeholder="Search by name" autoFocus={!q} />
          <button className="btn" type="submit">Search</button>
        </form>
      </header>

      {safe ? (
        <section className="panel">
          <div className="panel-head">
            <h3>Results for “{q}”</h3>
            <span className="small muted">{results.length === 50 ? 'First 50 matches' : `${results.length} found`}</span>
          </div>
          {results.length ? (
            <ul className="list">
              {results.map((d) => (
                <li key={d.id}>
                  <Link href={`/drivers/${d.id}`}>{d.display_name}</Link>
                  <span className="muted small">{[d.hometown, d.state].filter(Boolean).join(', ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">No racer by that name. Try just the last name.</div>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h3>Busiest racers this season</h3>
            <span className="small muted">Most starts</span>
          </div>
          {active.length ? (
            <ul className="list">
              {active.map((d) => (
                <li key={d.driver_id}>
                  <Link href={`/drivers/${d.driver_id}`}>{d.name || 'Unknown racer'}</Link>
                  <span className="muted small num">{d.cat} · {d.n} starts</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">Search for a racer by name above.</div>
          )}
        </section>
      )}
    </div>
  );
}
