import Link from 'next/link';

// NHRA | PDRA switch. Same weight for both; each keeps its own classes, events and racers.
export const SERIES = [
  { key: 'nhra', label: 'NHRA', sub: 'Quarter mile' },
  { key: 'pdra', label: 'PDRA', sub: 'Eighth mile' },
];
export const seriesFrom = (searchParams) => (searchParams?.series === 'pdra' ? 'pdra' : 'nhra');

export default function SeriesTabs({ base, current, params = {} }) {
  const href = (key) => {
    const q = new URLSearchParams({ ...params, ...(key === 'pdra' ? { series: 'pdra' } : {}) }).toString();
    return q ? `${base}?${q}` : base;
  };
  return (
    <nav className="series-tabs" aria-label="Series">
      {SERIES.map((s) => (
        <Link key={s.key} href={href(s.key)} aria-current={s.key === current ? 'page' : undefined} scroll={false}>
          <b>{s.label}</b>
          <small>{s.sub}</small>
        </Link>
      ))}
    </nav>
  );
}
