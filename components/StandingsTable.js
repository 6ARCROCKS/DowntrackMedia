'use client';

import { useState, Fragment } from 'react';
import Link from 'next/link';

// Standings with a name filter; tap a racer to see the events that counted.
// rows: [{ id, rank, name, total, div, nat, events: [{ id, label, date, points, counted, result }] }]
export default function StandingsTable({ rows, mode }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  const cols = mode === 'national' ? 5 : 4;

  return (
    <>
      <label htmlFor="standings-filter" className="sr">Filter drivers</label>
      <input
        id="standings-filter"
        className="filter"
        placeholder="Filter drivers"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="table-wrap">
        <table className="slip standings">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" style={{ textAlign: 'left' }}>Driver</th>
              <th scope="col">Total</th>
              {mode === 'national' ? (
                <>
                  <th scope="col">Div</th>
                  <th scope="col">Nat</th>
                </>
              ) : (
                <th scope="col" title="Events counted">Events</th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className={`${r.rank === 1 ? 'leader' : ''} ${open === r.id ? 'is-open' : ''}`}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpen(open === r.id ? null : r.id);
                    }
                  }}
                  aria-expanded={open === r.id}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="rank-cell">{r.rank}</td>
                  <td style={{ textAlign: 'left' }}>{r.name}</td>
                  <td className="total-cell">{r.total}</td>
                  {mode === 'national' ? (
                    <>
                      <td>{r.div ?? 0}</td>
                      <td>{r.nat ?? 0}</td>
                    </>
                  ) : (
                    <td>{r.counted}</td>
                  )}
                </tr>
                {open === r.id && (
                  <tr className="detail">
                    <td colSpan={cols}>
                      <div className="counted-list">
                        {r.events.map((e) => (
                          <div key={e.id} className={e.counted ? 'ev counted' : 'ev dropped'}>
                            <span className="ev-name">{e.label}</span>
                            <span className="ev-date">{e.date}</span>
                            <span className="ev-res">{e.result}</span>
                            <span className="ev-pts">{e.points}</span>
                          </div>
                        ))}
                      </div>
                      <p className="small" style={{ margin: '8px 0 0' }}>
                        <span className="muted">Bold counted, grey dropped or not eligible. </span>
                        <Link href={`/drivers/${r.id}`}>Full racer page →</Link>
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!shown.length && (
              <tr><td colSpan={cols} className="empty">No driver by that name.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
