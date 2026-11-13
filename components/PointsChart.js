// Points race, 10.90 style: step lines for the top 5, legend underneath.
const W = 1060, H = 300, L = 44, R = 16, T = 12, B = 30;
export const RACE_COLORS = ['#0b1f38', '#e31837', '#5b7bb2', '#ec7b8c', '#a3abb8'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 864e5;

export default function PointsChart({ dates, lines }) {
  if (!dates.length || !lines.length) return null;
  const max = Math.max(10, ...lines.flatMap((l) => l.values));
  const step = max > 600 ? 200 : 100;
  const top = Math.ceil(max / step) * step;
  const d0 = day(dates[0]), d1 = day(dates.at(-1));
  const x = (iso) => L + (d1 === d0 ? 0 : ((day(iso) - d0) / (d1 - d0)) * (W - L - R));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  // About eight evenly spaced date labels.
  const every = Math.max(1, Math.round(dates.length / 8));
  const dateTicks = dates.filter((_, i) => i % every === 0 || i === dates.length - 1);

  const path = (vals) => {
    let d = `M${x(dates[0])},${y(vals[0])}`;
    for (let i = 1; i < dates.length; i++) d += `H${x(dates[i])}V${y(vals[i])}`;
    return d;
  };

  return (
    <figure style={{ margin: 0 }}>
      <div className="table-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points race: each contender's counted points through the season" style={{ width: '100%', minWidth: 560, display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#efe6d6" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#5a6478">{t}</text>
            </g>
          ))}
          <line x1={L} x2={L} y1={T} y2={H - B} stroke="#cfc7b6" />
          {dateTicks.map((d) => (
            <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="12" fill="#5a6478">{short(d)}</text>
          ))}
          {[...lines].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
            <path key={l.id} d={path(l.values)} fill="none" stroke={RACE_COLORS[i]} strokeWidth="2.5" strokeLinejoin="miter">
              <title>{`${l.name}: ${l.values.at(-1)} points`}</title>
            </path>
          ))}
        </svg>
      </div>
      <figcaption className="legend">
        {lines.map((l, i) => (
          <span key={l.id}><i style={{ background: RACE_COLORS[i] }} />{l.name}</span>
        ))}
      </figcaption>
    </figure>
  );
}
