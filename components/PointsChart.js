// Points race: cumulative counted points across the season for the top racers.
// Leader in red, runner-up in navy, everyone else quiet grey with a label at the line end.
const W = 760, H = 340, L = 48, R = 150, T = 20, B = 36;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export default function PointsChart({ dates, lines }) {
  if (!dates.length || !lines.length) return null;
  const max = Math.max(10, ...lines.flatMap((l) => l.values));
  const step = max > 600 ? 200 : max > 300 ? 100 : 50;
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (dates.length === 1 ? 0 : (i / (dates.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const monthTicks = dates
    .map((d, i) => ({ d, i }))
    .filter(({ d }, k, arr) => k === 0 || d.slice(5, 7) !== arr[k - 1].d.slice(5, 7));

  // Spread end labels so they don't overlap.
  const ends = lines
    .map((l, i) => ({ i, name: l.name, v: l.values.at(-1), yv: y(l.values.at(-1)) }))
    .sort((a, b) => a.yv - b.yv);
  for (let k = 1; k < ends.length; k++) {
    if (ends[k].yv - ends[k - 1].yv < 14) ends[k].yv = ends[k - 1].yv + 14;
  }
  const labelY = Object.fromEntries(ends.map((e) => [e.i, e.yv]));

  const color = (i) => (i === 0 ? 'var(--red)' : i === 1 ? 'var(--navy)' : '#9aa3b2');

  return (
    <div className="table-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points race: cumulative counted points through the season" style={{ width: '100%', minWidth: 560, display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e4ded1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#5a6478">{t}</text>
          </g>
        ))}
        {monthTicks.map(({ d, i }) => (
          <text key={d} x={x(i)} y={H - 12} textAnchor="middle" fontSize="12" fill="#5a6478">{short(d)}</text>
        ))}
        {[...lines].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
          <g key={l.id}>
            <polyline
              fill="none"
              stroke={color(i)}
              strokeWidth={i < 2 ? 3 : 1.5}
              strokeLinejoin="round"
              points={l.values.map((v, k) => `${x(k)},${y(v)}`).join(' ')}
            >
              <title>{`${l.name}: ${l.values.at(-1)} points`}</title>
            </polyline>
            <circle cx={x(l.values.length - 1)} cy={y(l.values.at(-1))} r={i < 2 ? 4 : 3} fill={color(i)} />
            <text x={W - R + 8} y={labelY[i] + 4} fontSize="12" fontWeight={i < 2 ? 700 : 500} fill={i < 2 ? color(i) : '#5a6478'}>
              {l.name} {l.values.at(-1)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
