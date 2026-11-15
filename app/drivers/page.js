import Link from 'next/link';
import { db, byIds, indexBy } from '@/lib/db';

export const revalidate = 3600;
export const metadata = { title: 'Racers' };

const GROUPS = [
  { org: 'nhra', label: 'NHRA', cat: 'lt' },
  { org: 'pdra', label: 'PDRA', cat: 'gte' },
];

export default async function Drivers({ searchParams }) {
  const q = (searchParams?.q || '').trim().slice(0, 60);
  // PostgREST pattern: strip characters that have meaning in the filter syntax.
  const safe = q.replace(/[*,()%"\\]/g, ' ').trim();
  const cats = indexBy(await db('category?select=id,name'));

  // One search, both series, side by side. NHRA and PDRA racers are separate records.
  const cols = await Promise.all(GROUPS.map(async (g) => {
    if (safe) {
      const filters = safe.split(/\s+/).filter(Boolean).map((w) => `&display_name=ilike.*${encodeURIComponent(w)}*`).join('');
      const rows = await db(`driver?select=id,display_name,hometown,state&merged_into=is.null&org=eq.${g.org}${filters}&order=display_name&limit=50`);
      return { ...g, rows: rows.map((d) => ({ id: d.id, name: d.display_name, note: [d.hometown, d.state].filter(Boolean).join(', ') })) };
    }
    const top = await db(`stat_driver?select=driver_id,category_id,n&time_window=eq.season&metric=eq.red_light&category_id=${g.cat}.101&order=n.desc&limit=40`);
    const names = indexBy(await byIds('driver', 'id', top.map((t) => t.driver_id), 'id,display_name'));
    const seen = new Set();
    const rows = top
      .filter((t) => (seen.has(t.driver_id) ? false : seen.add(t.driver_id)))
      .slice(0, 15)
      .map((t) => ({ id: t.driver_id, name: names[t.driver_id]?.display_name || 'Unknown racer', note: `${cats[t.category_id]?.name || ''} · ${t.n} starts` }));
    return { ...g, rows };
  }));

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Racer stats</span>
        <h1>Racers</h1>
        <form className="search" role="search" style={{ marginTop: 14 }}>
          <label htmlFor="q" style={{ position: 'absolute', left: -9999 }}>Racer name</label>
          <input id="q" name="q" defaultValue={q} placeholder="Search NHRA and PDRA racers by name" autoFocus={!q} />
          <button className="btn" type="submit">Search</button>
        </form>
      </header>

      <div className="series-cols">
        {cols.map((c) => (
          <section className="panel" key={c.org}>
            <div className="panel-head">
              <h3>{c.label}{safe ? ` · “${q}”` : ' · busiest this season'}</h3>
              <span className="small muted">
                {safe ? (c.rows.length === 50 ? 'First 50 matches' : `${c.rows.length} found`) : 'Most starts'}
              </span>
            </div>
            {c.rows.length ? (
              <ul className="list">
                {c.rows.map((d) => (
                  <li key={d.id}>
                    <Link href={`/drivers/${d.id}`}>{d.name}</Link>
                    <span className="muted small num">{d.note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">{safe ? `No ${c.label} racer by that name. Try just the last name.` : 'Search for a racer by name above.'}</div>
            )}
          </section>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        A racer who runs both series has an NHRA page and a PDRA page; the numbers are kept apart because the tracks are different lengths.
      </p>
    </div>
  );
}
