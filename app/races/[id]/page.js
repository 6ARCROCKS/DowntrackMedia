import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, one, all, byIds, indexBy } from '@/lib/db';
import { dragNum } from '@/lib/metrics';
import { dateRange } from '@/lib/format';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

const validId = (v) => /^\d+$/.test(String(v));

export async function generateMetadata({ params }) {
  if (!validId(params.id)) return {};
  const r = await one(`race?select=name,event_id,category_id&id=eq.${params.id}`);
  if (!r) return {};
  const [ev, cat] = await Promise.all([
    one(`event?select=name&id=eq.${r.event_id}`),
    one(`category?select=name&id=eq.${r.category_id}`),
  ]);
  return { title: `${cat?.name || r.name} · ${ev?.name || ''}` };
}

const ROUND_NAME = { T: 'Time trial', Q: 'Qualifying', E: 'Round', C: 'Round' };

export default async function RacePage({ params }) {
  if (!validId(params.id)) notFound();
  const race = await one(`race?select=*&id=eq.${params.id}`);
  if (!race) notFound();

  const [ev, cat, pairings, entries] = await Promise.all([
    one(`event?select=id,name,season,start_date,end_date&id=eq.${race.event_id}`),
    one(`category?select=*&id=eq.${race.category_id}`),
    all(`pairing?select=id,round_code,round_type,round_no,pair_no&race_id=eq.${race.id}&order=round_type,round_no,pair_no`),
    all(`entry?select=id,driver_id,car_no,class_code,qual_pos,is_winner,is_runner_up&race_id=eq.${race.id}`),
  ]);
  const runs = await byIds('run', 'pairing_id', pairings.map((p) => p.id), 'pairing_id,entry_id,lane,dial,rt,ft60,ft330,ft660,mph660,ft1000,et,mph,ov_un,is_win,red_light,breakout');
  const entryBy = indexBy(entries);
  const drivers = indexBy(await byIds('driver', 'id', entries.map((e) => e.driver_id), 'id,display_name'));

  const runsByPair = {};
  for (const r of runs) (runsByPair[r.pairing_id] ||= []).push(r);
  for (const k in runsByPair) runsByPair[k].sort((a, b) => (a.lane || '').localeCompare(b.lane || ''));

  // Group pairings into rounds: eliminations first (latest round on top reads like a ladder), then qualifying.
  const rounds = {};
  for (const p of pairings) {
    const key = p.round_code || `${p.round_type}${p.round_no ?? ''}`;
    (rounds[key] ||= { key, type: p.round_type, no: p.round_no, pairs: [] }).pairs.push(p);
  }
  const elim = Object.values(rounds).filter((r) => r.type === 'E').sort((a, b) => (b.no ?? 0) - (a.no ?? 0));
  const other = Object.values(rounds).filter((r) => r.type !== 'E').sort((a, b) => a.key.localeCompare(b.key));
  const lastElim = elim[0]?.no;

  const thousand = cat?.distance_ft === 1000;
  const dial = !!cat?.uses_dial;
  const winner = entries.find((e) => e.is_winner);
  const runnerUp = entries.find((e) => e.is_runner_up);

  const Lane = ({ r }) => {
    const e = entryBy[r.entry_id];
    const d = e && drivers[e.driver_id];
    return (
      <tr className={r.is_win ? 'lane-win' : ''}>
        <td>
          {d ? <Link href={`/drivers/${e.driver_id}`}>{d.display_name}</Link> : <span className="muted">—</span>}
          <span className="muted small"> {[e?.car_no, e?.class_code].filter(Boolean).join(' · ')}</span>
          {r.is_win && <span className="chip win" style={{ marginLeft: 8 }}>W</span>}
        </td>
        {dial && <td>{r.dial != null ? Number(r.dial).toFixed(2) : '—'}</td>}
        <td className={r.red_light ? 'redlight' : ''}>{r.red_light ? `${dragNum(r.rt)} RED` : dragNum(r.rt)}</td>
        <td>{dragNum(r.ft60)}</td>
        <td>{dragNum(r.ft330)}</td>
        <td>{dragNum(r.ft660)}</td>
        <td className="flat">{r.mph660 != null ? Number(r.mph660).toFixed(2) : '—'}</td>
        {!thousand && <td>{dragNum(r.ft1000)}</td>}
        <td className="headline">{r.et != null ? Number(r.et).toFixed(3) : '—'}</td>
        <td>{r.mph != null ? Number(r.mph).toFixed(2) : '—'}</td>
        {dial && <td className={r.breakout ? 'breakout' : 'flat'}>{dragNum(r.ov_un, 3, true)}</td>}
      </tr>
    );
  };

  const Head = () => (
    <thead>
      <tr>
        <th scope="col">Racer</th>
        {dial && <th scope="col">Dial</th>}
        <th scope="col">R/T</th>
        <th scope="col">60'</th>
        <th scope="col">330'</th>
        <th scope="col">660'</th>
        <th scope="col">MPH</th>
        {!thousand && <th scope="col">1000'</th>}
        <th scope="col">ET</th>
        <th scope="col">MPH</th>
        {dial && <th scope="col">+/−</th>}
      </tr>
    </thead>
  );

  const roundTitle = (r) => {
    if (r.type === 'E') return r.no === lastElim ? 'Final' : `Round ${r.no ?? r.key}`;
    return `${ROUND_NAME[r.type] || 'Round'} ${r.key.replace(/^\D+/, '')}`.trim();
  };

  const RoundTable = ({ r }) => (
    <div className="table-wrap">
      <table className="slip">
        <Head />
        {r.pairs.map((p) => (
          <tbody key={p.id} className="pair">
            {(runsByPair[p.id] || []).map((run, i) => <Lane key={`${p.id}-${i}`} r={run} />)}
          </tbody>
        ))}
      </table>
    </div>
  );

  return (
    <div className="stack">
      <header>
        <Link href={`/events/${ev?.id}`} className="small">← {ev?.name}</Link>
        <h1 style={{ marginTop: 6 }}>{cat?.name || race.name}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          {[ev?.name, dateRange(ev?.start_date, ev?.end_date), race.field_size ? `${race.field_size} cars` : null].filter(Boolean).join(' · ')}
        </p>
        {(winner || runnerUp) && (
          <p style={{ margin: '12px 0 0' }}>
            {winner && <><span className="chip win">Winner</span>{' '}<Link href={`/drivers/${winner.driver_id}`}>{drivers[winner.driver_id]?.display_name}</Link></>}
            {runnerUp && <>{'  '}<span className="chip ru" style={{ marginLeft: 12 }}>Runner-up</span>{' '}<Link href={`/drivers/${runnerUp.driver_id}`}>{drivers[runnerUp.driver_id]?.display_name}</Link></>}
          </p>
        )}
      </header>

      {elim.length === 0 && other.length === 0 && (
        <div className="panel"><div className="empty">Round-by-round results for this class haven't loaded yet.</div></div>
      )}

      {elim.map((r) => (
        <section className="panel" key={r.key}>
          <div className="panel-head"><h3>{roundTitle(r)}</h3><span className="small muted">{r.pairs.length} pairs</span></div>
          <RoundTable r={r} />
        </section>
      ))}

      {other.map((r) => (
        <details className="round" key={r.key}>
          <summary>{roundTitle(r)} · {r.pairs.length} pairs</summary>
          <RoundTable r={r} />
        </details>
      ))}
    </div>
  );
}
