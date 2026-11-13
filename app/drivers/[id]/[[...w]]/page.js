import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db, one, byIds, indexBy } from '@/lib/db';
import { windowFromPath, windowHref } from '@/lib/metrics';
import { dateRange, resultLabel } from '@/lib/format';
import StatTable from '@/components/StatTable';
import WindowTabs from '@/components/WindowTabs';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

const validId = (v) => /^\d+$/.test(String(v));

export async function generateMetadata({ params }) {
  if (!validId(params.id)) return {};
  const d = await one(`driver?select=display_name&id=eq.${params.id}`);
  return d ? { title: d.display_name, description: `${d.display_name}: results, reaction times, increments and dial-in stats.` } : {};
}

export default async function DriverPage({ params }) {
  if (!validId(params.id)) notFound();
  const driver = await one(`driver?select=*&id=eq.${params.id}`);
  if (!driver) notFound();
  if (driver.merged_into) redirect(`/drivers/${driver.merged_into}`);

  const win = windowFromPath(params.w);
  if (!win) notFound();

  const [entries, statRows, cats] = await Promise.all([
    db(`entry?select=id,race_id,car_no,class_code,finish_round,is_winner,is_runner_up&driver_id=eq.${driver.id}&limit=1000`),
    db(`stat_driver?select=*&driver_id=eq.${driver.id}&time_window=eq.${win.key}`),
    db('category?select=id,slug,name,kind,uses_dial,distance_ft,index_et'),
  ]);
  const catBy = indexBy(cats);

  const races = indexBy(await byIds('race', 'id', entries.map((e) => e.race_id), 'id,event_id,category_id,name'));
  const events = indexBy(
    await byIds('event', 'id', Object.values(races).map((r) => r.event_id), 'id,name,season,start_date,end_date'),
  );

  // Career line, by season and class.
  const rows = entries
    .map((e) => {
      const r = races[e.race_id];
      const ev = r && events[r.event_id];
      return r && ev ? { ...e, race: r, event: ev, cat: catBy[r.category_id] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.event.start_date || '').localeCompare(a.event.start_date || ''));

  const career = { races: rows.length, wins: rows.filter((r) => r.is_winner).length, ru: rows.filter((r) => r.is_runner_up).length };
  const bySeason = {};
  for (const r of rows) {
    const k = `${r.event.season}|${r.cat?.id}`;
    bySeason[k] ||= { season: r.event.season, cat: r.cat, races: 0, wins: 0, ru: 0 };
    bySeason[k].races++;
    if (r.is_winner) bySeason[k].wins++;
    if (r.is_runner_up) bySeason[k].ru++;
  }
  const seasonRows = Object.values(bySeason).sort((a, b) => b.season - a.season || (a.cat?.name || '').localeCompare(b.cat?.name || ''));

  // Stats per class this racer has runs in, with the class median beside each.
  const statCats = [...new Set(statRows.map((r) => r.category_id))];
  const classRows = statCats.length
    ? await db(`stat_category?select=*&category_id=in.(${statCats.join(',')})&time_window=eq.${win.key}`)
    : [];
  const runCount = (cid) => statRows.find((r) => r.category_id === cid && r.metric === 'red_light')?.n || 0;
  statCats.sort((a, b) => runCount(b) - runCount(a));

  const classesRun = [...new Set(rows.map((r) => r.cat?.name).filter(Boolean))];

  // Points: this racer's national and divisional standing in the latest season with points.
  const [natPts, divPts] = await Promise.all([
    db(`pts_national?select=season,category_id,total,rank,wins&driver_id=eq.${driver.id}&order=season.desc&limit=20`),
    db(`pts_division?select=season,category_id,division,total,rank&driver_id=eq.${driver.id}&order=season.desc&limit=20`),
  ]);
  const ptsSeason = Math.max(0, ...natPts.map((r) => r.season), ...divPts.map((r) => r.season)) || null;
  const ptsCats = [...new Set([...natPts, ...divPts].filter((r) => r.season === ptsSeason).map((r) => r.category_id))];

  return (
    <div className="stack">
      <header>
        <Link href="/drivers" className="small">← Racers</Link>
        <h1 style={{ marginTop: 6 }}>{driver.display_name}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          {[[driver.hometown, driver.state].filter(Boolean).join(', '), classesRun.join(' · ')].filter(Boolean).join(' — ')}
        </p>
        <div className="tally" style={{ marginTop: 16 }}>
          <div><b>{career.races}</b><span>Races</span></div>
          <div><b>{career.wins}</b><span>Wins</span></div>
          <div><b>{career.ru}</b><span>Runner-ups</span></div>
          {driver.downtrack_no && <div><b>#{driver.downtrack_no}</b><span>Downtrack no.</span></div>}
        </div>
      </header>

      {ptsSeason && ptsCats.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>{ptsSeason} points</h3><Link href="/points" className="small">All standings →</Link></div>
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr><th scope="col">Class</th><th scope="col">National</th><th scope="col">Divisional</th></tr>
              </thead>
              <tbody>
                {ptsCats.map((cid) => {
                  const n = natPts.find((r) => r.season === ptsSeason && r.category_id === cid);
                  const d = divPts.find((r) => r.season === ptsSeason && r.category_id === cid);
                  const slug = catBy[cid]?.slug;
                  return (
                    <tr key={cid}>
                      <td>{catBy[cid]?.name}</td>
                      <td>{n ? <Link href={`/points/${slug}`}><b>#{n.rank}</b> · {n.total} pts</Link> : <span className="flat">—</span>}</td>
                      <td>{d ? <Link href={`/points/${slug}/division-${d.division}`}><b>#{d.rank}</b> in Div. {d.division} · {d.total} pts</Link> : <span className="flat">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <WindowTabs basePath={`/drivers/${driver.id}`} current={win.key} />

      {statCats.length ? (
        statCats.map((cid) => (
          <section className="panel" key={cid}>
            <div className="panel-head">
              <h3>{catBy[cid]?.name} · {win.label}</h3>
              <Link href={windowHref(`/classes/${catBy[cid]?.slug}`, win.key)} className="small">Class stats →</Link>
            </div>
            <StatTable
              rows={statRows.filter((r) => r.category_id === cid)}
              category={catBy[cid]}
              compare={classRows.filter((r) => r.category_id === cid)}
            />
          </section>
        ))
      ) : (
        <div className="panel"><div className="empty">No runs for {driver.display_name} in this window. Try All-time.</div></div>
      )}

      {seasonRows.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>Season by season</h3></div>
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr><th scope="col">Season</th><th scope="col">Class</th><th scope="col">Races</th><th scope="col">Wins</th><th scope="col">Runner-ups</th></tr>
              </thead>
              <tbody>
                {seasonRows.map((s) => (
                  <tr key={`${s.season}-${s.cat?.id}`}>
                    <td>{s.season}</td>
                    <td style={{ textAlign: 'left' }}>{s.cat?.name}</td>
                    <td>{s.races}</td>
                    <td className={s.wins ? 'headline' : ''}>{s.wins}</td>
                    <td>{s.ru}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Recent races</h3>
            <span className="small muted">Last {Math.min(rows.length, 25)}</span>
          </div>
          <div className="table-wrap">
            <table className="slip">
              <thead>
                <tr><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Class</th><th scope="col">Car</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/races/${r.race.id}`}>{r.event.name}</Link></td>
                    <td className="flat">{dateRange(r.event.start_date, r.event.end_date)}</td>
                    <td>{r.class_code || r.cat?.name}</td>
                    <td>{r.car_no || '—'}</td>
                    <td>
                      {r.is_winner ? <span className="chip win">Winner</span> : r.is_runner_up ? <span className="chip ru">Runner-up</span> : <span className="flat">{resultLabel(r)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
