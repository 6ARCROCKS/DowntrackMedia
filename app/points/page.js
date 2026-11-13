import Link from 'next/link';
import { db, indexBy } from '@/lib/db';
import { DIVISIONS } from '@/lib/points';

export const revalidate = 3600;
export const metadata = {
  title: 'Points standings',
  description: 'Lucas Oil national and divisional points standings for every sportsman class, with every counted race.',
};

export default async function PointsIndex() {
  const [rules, cats] = await Promise.all([
    db('points_rule?select=category_slug,has_national,has_division'),
    db('category?select=id,slug,name&order=id').then((r) => indexBy(r, 'slug')),
  ]);
  const order = Object.keys(cats);
  const list = rules
    .filter((r) => cats[r.category_slug])
    .sort((a, b) => order.indexOf(a.category_slug) - order.indexOf(b.category_slug));

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Lucas Oil Drag Racing Series</span>
        <h1>Points battles</h1>
        <p className="lead">
          National and divisional standings for every class, scored with NHRA's Lucas Oil points rules. Every racer's
          counted races are shown, so you can see what's carrying them and what they still need.
        </p>
      </header>

      {list.length ? (
        <section className="panel">
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr><th scope="col">Class</th><th scope="col">National</th><th scope="col" style={{ textAlign: 'left' }}>Divisional</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.category_slug}>
                    <td><b>{cats[r.category_slug].name}</b></td>
                    <td>{r.has_national ? <Link href={`/points/${r.category_slug}`}>National →</Link> : <span className="flat">—</span>}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                      {r.has_division ? (
                        <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
                          {DIVISIONS.map((d) => (
                            <Link key={d} href={`/points/${r.category_slug}/division-${d}`}>Div. {d}</Link>
                          ))}
                        </span>
                      ) : (
                        <span className="flat">Regional standings coming</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="panel"><div className="empty">Points standings are loading. Check back shortly.</div></div>
      )}

      <p className="small muted" style={{ maxWidth: '70ch' }}>
        Scoring follows{' '}
        <a href="https://www.nhra.com/how-points-are-earned/lucas-oil-national-championship-points">NHRA's Lucas Oil points rules</a>.
        Home division is the division of a racer's first divisional event of the season. Points waivers aren't in the
        public results, so a racer who waived an event may show slightly different totals than NHRA's official standings.
      </p>
    </div>
  );
}
