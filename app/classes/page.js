import Link from 'next/link';
import { db } from '@/lib/db';
import { KIND_LABEL } from '@/lib/metrics';

export const revalidate = 3600;
export const metadata = { title: 'Classes' };

export default async function Classes() {
  const cats = (await db('category?select=id,slug,name,kind,index_et,distance_ft,in_scope&order=id')).filter(
    (c) => c.in_scope !== false,
  );
  const kinds = ['pro', 'sportsman', 'bracket'].filter((k) => cats.some((c) => c.kind === k));

  return (
    <div className="stack">
      <header>
        <span className="eyebrow">Class stats</span>
        <h1>Classes</h1>
        <p className="lead">
          Pick a class for its reaction times, increments, red-light rate and dial-in or index numbers,
          by season, last 3 races or all-time.
        </p>
      </header>
      {kinds.map((k) => (
        <section key={k}>
          <div className="section-head"><h2>{KIND_LABEL[k]}</h2></div>
          <div className="grid">
            {cats.filter((c) => c.kind === k).map((c) => (
              <Link key={c.id} href={`/classes/${c.slug}`} className="class-link">
                <span>{c.name}</span>
                <small>
                  {c.index_et ? `${Number(c.index_et).toFixed(2)} index` : c.distance_ft === 1000 ? "1,000'" : ''}
                </small>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
