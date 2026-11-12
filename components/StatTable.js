import { METRICS, GROUPS, metricLabel, fmt, fmtChange, thousands } from '@/lib/metrics';

// The core stat table. Median is the headline number; average, spread and
// change over the window sit beside it. Pass `compare` (class rows) to add a
// class-median column on driver pages.
export default function StatTable({ rows, category, compare }) {
  const byMetric = Object.fromEntries((rows || []).map((r) => [r.metric, r]));
  const classBy = compare ? Object.fromEntries(compare.map((r) => [r.metric, r])) : null;
  const present = METRICS.filter((m) => byMetric[m.key]);

  if (!present.length) {
    return <div className="empty">No runs in this window yet.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="slip">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Median</th>
            {classBy && <th scope="col">Class median</th>}
            <th scope="col">Average</th>
            <th scope="col" title="Standard deviation: lower means more consistent">Spread</th>
            <th scope="col" title="How much the number moved from the start to the end of this window">Change</th>
            <th scope="col">Runs</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const ms = present.filter((m) => m.group === g);
            if (!ms.length) return null;
            return [
              <tr className="group" key={`g-${g}`}>
                <td colSpan={classBy ? 7 : 6}>{g}</td>
              </tr>,
              ...ms.map((m) => {
                const r = byMetric[m.key];
                const ch = fmtChange(m.key, r.trend_change);
                return (
                  <tr key={m.key}>
                    <td className="label">
                      {metricLabel(m, category)}
                      {m.help && <small>{m.help}</small>}
                    </td>
                    {/* Rates (red lights, heads-up rounds) are a share of runs, so the
                        headline is the average; a median of 0s and 1s says nothing. */}
                    <td className="headline">{fmt(m.key, m.pct ? r.avg_val : r.median_val)}</td>
                    {classBy && (
                      <td>{fmt(m.key, m.pct ? classBy[m.key]?.avg_val : classBy[m.key]?.median_val)}</td>
                    )}
                    <td>{m.pct ? '—' : fmt(m.key, r.avg_val)}</td>
                    <td className="flat">{m.pct ? '—' : fmt(m.key, r.std_val)}</td>
                    <td className={ch.tone}>{ch.text}</td>
                    <td className="flat">{thousands(r.n)}</td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
