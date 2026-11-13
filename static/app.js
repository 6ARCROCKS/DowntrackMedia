/* Downtrack Media — static site. Pages render in the browser from Supabase. */
(function () {
  'use strict';
  const C = window.DT_CONFIG;
  const app = document.getElementById('app');

  // ---------- data ----------
  const H = { apikey: C.key, 'Accept-Profile': C.schema };
  async function db(path) {
    try {
      const r = await fetch(`${C.url}/rest/v1/${path}`, { headers: H });
      if (!r.ok) { console.error('[db]', r.status, path); return []; }
      return await r.json();
    } catch (e) { console.error('[db]', path, e); return []; }
  }
  const one = async (p) => { const r = await db(p); return r[0] || null; };
  async function byIds(table, col, ids, select = '*', extra = '', size = 150) {
    const u = [...new Set(ids.filter((v) => v != null))];
    const out = [];
    for (let i = 0; i < u.length; i += size) {
      out.push(...(await db(`${table}?select=${select}&${col}=in.(${u.slice(i, i + size).join(',')})${extra}`)));
    }
    return out;
  }
  async function all(path, max = 10000) {
    const out = [];
    for (let off = 0; off < max; off += 1000) {
      const rows = await db(`${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${off}`);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }
  async function estimate(table) {
    try {
      const r = await fetch(`${C.url}/rest/v1/${table}?select=*&limit=1`, { headers: { ...H, Prefer: 'count=estimated' } });
      const n = Number((r.headers.get('content-range') || '').split('/')[1]);
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  }
  const indexBy = (rows, k = 'id') => Object.fromEntries((rows || []).map((r) => [r[k], r]));

  // ---------- formatting ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function date(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; }
  function dateRange(a, b) {
    if (!a) return ''; if (!b || a === b) return date(a);
    const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
    if (y1 === y2 && m1 === m2) return `${MONTHS[m1 - 1]} ${d1}–${d2}, ${y1}`;
    if (y1 === y2) return `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y1}`;
    return `${date(a)} – ${date(b)}`;
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const thousands = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  function dragNum(v, dec = 3, signed = false) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v); let s = Math.abs(n).toFixed(dec);
    if (Math.abs(n) < 1 && dec >= 3) s = s.replace(/^0/, '');
    if (n < 0) return `−${s}`;
    return signed && n > 0 ? `+${s}` : s;
  }

  // ---------- stat definitions ----------
  const WINDOWS = [
    { key: 'season', label: 'This season', min: 10 },
    { key: 'last3', label: 'Last 3 races', min: 3 },
    { key: '3yr', label: 'Last 3 seasons', min: 20 },
    { key: 'all', label: 'All-time', min: 25 },
    { key: 'today', label: 'Today', min: 1 },
  ];
  const winFor = (k) => WINDOWS.find((w) => w.key === k) || WINDOWS[0];
  const INDEX = ['stock-eliminator', 'super-stock', 'competition-eliminator'];
  const isIndex = (c) => INDEX.includes(c?.slug);
  const isDialIn = (c) => c?.uses_dial && !isIndex(c);
  const KIND = { pro: 'Pro', sportsman: 'Sportsman', bracket: 'Bracket' };
  const METRICS = [
    { key: 'rt', label: 'Reaction time', g: 'Starting line', dec: 3, better: 'low', help: 'Red lights left out' },
    { key: 'rt_plus_60', label: "R/T + 60'", g: 'Starting line', dec: 3, better: 'low', help: 'Reaction time plus 60-foot time' },
    { key: 'red_light', label: 'Red-light rate', g: 'Starting line', pct: true, better: 'low', help: 'Share of starts that were red lights' },
    { key: 'package', label: 'Package', g: 'Starting line', dec: 3, better: 'low', help: 'Reaction time plus over/under the dial' },
    { key: 'dial_variance', label: 'Variance from dial', g: 'On the dial', dec: 3, signed: true, better: null, help: 'ET minus dial-in. + is over, − is a breakout' },
    { key: 'q_under_index', label: 'Under the index, qualifying', g: 'On the index', dec: 3, better: 'high', help: 'How far under the class index they qualify' },
    { key: 'dial_under_index', label: 'Dial under the index', g: 'On the index', dec: 3, better: null, help: 'How far under the index they dial in eliminations' },
    { key: 'headsup_under_index', label: 'Under the index, heads-up', g: 'On the index', dec: 3, better: 'high', help: 'How far under the index they run when racing on the index' },
    { key: 'headsup_rate', label: 'Rounds run heads-up', g: 'On the index', pct: true, better: null, help: 'Share of elimination rounds run on the index' },
    { key: 'ft60', label: "60'", g: 'Increments', dec: 3, better: 'low' },
    { key: 'ft330', label: "330'", g: 'Increments', dec: 3, better: 'low' },
    { key: 'ft660', label: "660'", g: 'Increments', dec: 3, better: 'low' },
    { key: 'mph660', label: "660' MPH", g: 'Increments', dec: 2, better: 'high' },
    { key: 'ft1000', label: "1000'", g: 'Increments', dec: 3, better: 'low' },
    { key: 'et', label: 'ET', g: 'Increments', dec: 3, better: 'low' },
    { key: 'mph', label: 'MPH', g: 'Increments', dec: 2, better: 'high' },
    { key: 's60_330', label: "60'–330'", g: 'Splits', dec: 3, better: 'low' },
    { key: 's330_660', label: "330'–660'", g: 'Splits', dec: 3, better: 'low' },
    { key: 's660_1000', label: "660'–1000'", g: 'Splits', dec: 3, better: 'low' },
    { key: 's1000_1320', label: "1000'–1320'", g: 'Splits', dec: 3, better: 'low' },
    { key: 'mph_660_1320', label: "MPH gain, 660' to finish", g: 'Splits', dec: 2, better: 'high' },
  ];
  const M = Object.fromEntries(METRICS.map((m) => [m.key, m]));
  const GROUPS = [...new Set(METRICS.map((m) => m.g))];
  const mLabel = (m, cat) => (m.key === 'et' ? (cat?.distance_ft === 1000 ? "ET (1000')" : "ET (1320')") : m.label);
  function fmt(k, v) {
    const m = M[k]; if (v == null) return '—'; if (!m) return String(v);
    return m.pct ? `${(Number(v) * 100).toFixed(1)}%` : dragNum(v, m.dec, m.signed);
  }
  function fmtChange(k, v) {
    const m = M[k]; if (v == null || !m) return { t: '—', c: 'flat' };
    const n = Number(v);
    const t = m.pct ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(1)} pts` : dragNum(n, m.dec, true);
    let c = 'flat';
    if (m.better && n !== 0) c = (m.better === 'low' ? n < 0 : n > 0) ? 'good' : 'bad';
    return { t, c };
  }

  // ---------- shared views ----------
  const link = (href, text) => `<a href="${href}">${esc(text)}</a>`;
  const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;

  function tabs(base, current, available) {
    const shown = WINDOWS.filter((w) => !available || available.has(w.key) || w.key === current);
    return `<nav class="tabs" aria-label="Time window">${shown.map((w) =>
      `<a href="${base}?w=${w.key}"${w.key === current ? ' aria-current="page"' : ''}>${w.label}</a>`).join('')}</nav>`;
  }

  function statTable(rows, cat, compare) {
    const by = indexBy(rows, 'metric');
    const cls = compare ? indexBy(compare, 'metric') : null;
    const present = METRICS.filter((m) => by[m.key]);
    if (!present.length) return empty('No runs in this window yet.');
    const cols = cls ? 7 : 6;
    let body = '';
    for (const g of GROUPS) {
      const ms = present.filter((m) => m.g === g);
      if (!ms.length) continue;
      body += `<tr class="group"><td colspan="${cols}">${g}</td></tr>`;
      for (const m of ms) {
        const r = by[m.key]; const ch = fmtChange(m.key, r.trend_change);
        const head = m.pct ? r.avg_val : r.median_val;
        const clsVal = cls ? (m.pct ? cls[m.key]?.avg_val : cls[m.key]?.median_val) : null;
        body += `<tr>
          <td class="label">${esc(mLabel(m, cat))}${m.help ? `<small>${esc(m.help)}</small>` : ''}</td>
          <td class="headline">${fmt(m.key, head)}</td>
          ${cls ? `<td>${fmt(m.key, clsVal)}</td>` : ''}
          <td>${m.pct ? '—' : fmt(m.key, r.avg_val)}</td>
          <td class="flat">${m.pct ? '—' : fmt(m.key, r.std_val)}</td>
          <td class="${ch.c}">${ch.t}</td>
          <td class="flat">${thousands(r.n)}</td></tr>`;
      }
    }
    return `<div class="table-wrap"><table class="slip"><thead><tr>
      <th scope="col">Stat</th><th scope="col">Median</th>${cls ? '<th scope="col">Class median</th>' : ''}
      <th scope="col">Average</th><th scope="col" title="Lower means more consistent">Spread</th>
      <th scope="col" title="How much it moved over this window">Change</th><th scope="col">Runs</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ---------- pages ----------
  async function home() {
    const [runs, drivers, events, cats, recent] = await Promise.all([
      estimate('run'), estimate('driver'), estimate('event'),
      db('category?select=id,slug,name,kind,in_scope&order=id'),
      db(`event?select=id,name,start_date,end_date,venue_id&start_date=lte.${today()}&order=start_date.desc&limit=24`),
    ]);
    const loaded = new Set((await byIds('race', 'event_id', recent.map((e) => e.id), 'event_id')).map((r) => r.event_id));
    const latest = recent.filter((e) => loaded.has(e.id)).slice(0, 8);
    const venues = indexBy(await byIds('venue', 'id', latest.map((e) => e.venue_id), 'id,name'));
    const classes = cats.filter((c) => c.in_scope !== false);
    const kinds = ['pro', 'sportsman', 'bracket'].filter((k) => classes.some((c) => c.kind === k));
    return `<div class="stack">
      <section class="hero">
        <span class="eyebrow">The drag racing report</span>
        <h1>Every run. Every split. <em>Every racer.</em></h1>
        <p class="lead">NHRA pro, sportsman and bracket results with reaction-time, increment and dial-in stats for every class and every racer, back to 2022.</p>
        <form class="search" action="/drivers" role="search">
          <label for="home-q" class="sr">Find a racer</label>
          <input id="home-q" name="q" placeholder="Find a racer, like Brad Plourd">
          <button class="btn" type="submit">Search</button>
        </form>
        <div class="tally">
          <div><b>${thousands(runs)}</b><span>Runs</span></div>
          <div><b>${thousands(drivers)}</b><span>Racers</span></div>
          <div><b>${thousands(events)}</b><span>Events</span></div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2>Latest results</h2><a href="/events" class="small">All events →</a></div>
        <div class="panel">${latest.length ? `<ul class="list">${latest.map((e) => `<li>${link(`/event/${e.id}`, e.name)}<span class="muted small num">${venues[e.venue_id] ? esc(venues[e.venue_id].name) + ' · ' : ''}${dateRange(e.start_date, e.end_date)}</span></li>`).join('')}</ul>` : empty('Results will show here as soon as the first event loads.')}</div>
      </section>
      <section>
        <div class="section-head"><h2>Classes</h2></div>
        <div class="stack" style="gap:18px">${kinds.map((k) => `<div>
          <div class="eyebrow" style="margin-bottom:8px">${KIND[k]}</div>
          <div class="grid">${classes.filter((c) => c.kind === k).map((c) => `<a href="/class/${c.slug}" class="class-link"><span>${esc(c.name)}</span><small>Stats →</small></a>`).join('')}</div>
        </div>`).join('')}</div>
      </section></div>`;
  }

  async function classes() {
    document.title = 'Classes · Downtrack Media';
    const cats = (await db('category?select=id,slug,name,kind,index_et,distance_ft,in_scope&order=id')).filter((c) => c.in_scope !== false);
    const kinds = ['pro', 'sportsman', 'bracket'].filter((k) => cats.some((c) => c.kind === k));
    return `<div class="stack"><header><span class="eyebrow">Class stats</span><h1>Classes</h1>
      <p class="lead">Pick a class for its reaction times, increments, red-light rate and dial-in or index numbers, by season, last 3 races or all-time.</p></header>
      ${kinds.map((k) => `<section><div class="section-head"><h2>${KIND[k]}</h2></div><div class="grid">${cats.filter((c) => c.kind === k).map((c) =>
        `<a href="/class/${c.slug}" class="class-link"><span>${esc(c.name)}</span><small>${c.index_et ? Number(c.index_et).toFixed(2) + ' index' : c.distance_ft === 1000 ? "1,000'" : ''}</small></a>`).join('')}</div></section>`).join('')}</div>`;
  }

  async function classPage(slug, q) {
    const cat = await one(`category?select=*&slug=eq.${encodeURIComponent(slug)}`);
    if (!cat) return notFound();
    document.title = `${cat.name} stats · Downtrack Media`;
    const win = winFor(q.get('w'));
    const [rows, have] = await Promise.all([
      db(`stat_category?select=*&category_id=eq.${cat.id}&time_window=eq.${win.key}`),
      db(`stat_category?select=time_window&category_id=eq.${cat.id}&metric=eq.et`),
    ]);
    const boards = [
      { title: 'Best on the tree', note: 'Median reaction time', metric: 'rt', order: 'asc' },
      { title: 'Fewest red lights', note: 'Share of starts', metric: 'red_light', order: 'asc', col: 'avg_val' },
    ];
    if (isDialIn(cat)) boards.push({ title: 'Tightest on the dial', note: 'Median over the dial', metric: 'dial_variance', order: 'asc', filter: '&median_val=gte.0' });
    if (isIndex(cat)) boards.push({ title: 'Deepest qualifiers', note: 'Median under the index', metric: 'q_under_index', order: 'desc' });
    else boards.push({ title: 'Quickest launch', note: "Median 60'", metric: 'ft60', order: 'asc' });
    const bRows = await Promise.all(boards.map((b) => {
      const col = b.col || 'median_val';
      return db(`stat_driver?select=driver_id,n,median_val,avg_val&category_id=eq.${cat.id}&time_window=eq.${win.key}&metric=eq.${b.metric}&n=gte.${win.min}${b.filter || ''}&order=${col}.${b.order},n.desc&limit=10`);
    }));
    const names = indexBy(await byIds('driver', 'id', bRows.flat().map((r) => r.driver_id), 'id,display_name'));
    const facts = [KIND[cat.kind], cat.index_et ? `${Number(cat.index_et).toFixed(2)} index` : null,
      cat.distance_ft === 1000 ? "Races to 1,000'" : 'Quarter mile', isIndex(cat) ? "Index from each car's qualifying runs" : null].filter(Boolean);
    return `<div class="stack">
      <header><a href="/classes" class="small">← All classes</a><h1 style="margin-top:6px">${esc(cat.name)}</h1>
      <p class="muted" style="margin:8px 0 0">${facts.join(' · ')}</p></header>
      ${tabs(`/class/${cat.slug}`, win.key, new Set(have.map((r) => r.time_window)))}
      <section class="panel"><div class="panel-head"><h3>Class numbers · ${win.label}</h3>
        <span class="small muted">Median is the headline. Junk runs (lifts, broke runs, byes) are left out.</span></div>
        ${statTable(rows, cat)}</section>
      <section><div class="section-head"><h2>Leaders · ${win.label}</h2><span class="small muted">Minimum ${win.min} runs</span></div>
      <div class="grid-2">${boards.map((b, i) => `<div class="panel"><div class="panel-head"><h3>${b.title}</h3><span class="small muted">${b.note}</span></div>
        ${bRows[i].length ? `<ol class="list">${bRows[i].map((r, j) => `<li><span><span class="rank">${j + 1}</span> ${link(`/driver/${r.driver_id}`, names[r.driver_id]?.display_name || 'Unknown racer')}</span>
          <span class="num"><b>${fmt(b.metric, b.col === 'avg_val' ? r.avg_val : r.median_val)}</b> <span class="muted small">${r.n} runs</span></span></li>`).join('')}</ol>` : empty('Not enough runs in this window yet.')}
      </div>`).join('')}</div></section></div>`;
  }

  async function drivers(q) {
    document.title = 'Racers · Downtrack Media';
    const term = (q.get('q') || '').trim().slice(0, 60);
    const safe = term.replace(/[*,()%"\\.:]/g, ' ').trim();
    let body;
    if (safe) {
      const f = safe.split(/\s+/).map((w) => `&display_name=ilike.*${encodeURIComponent(w)}*`).join('');
      const res = await db(`driver?select=id,display_name,hometown,state&merged_into=is.null${f}&order=display_name&limit=50`);
      body = `<section class="panel"><div class="panel-head"><h3>Results for “${esc(term)}”</h3><span class="small muted">${res.length === 50 ? 'First 50 matches' : res.length + ' found'}</span></div>
        ${res.length ? `<ul class="list">${res.map((d) => `<li>${link(`/driver/${d.id}`, d.display_name)}<span class="muted small">${esc([d.hometown, d.state].filter(Boolean).join(', '))}</span></li>`).join('')}</ul>` : empty('No racer by that name. Try just the last name.')}</section>`;
    } else {
      const top = await db('stat_driver?select=driver_id,category_id,n&time_window=eq.season&metric=eq.red_light&order=n.desc&limit=40');
      const [names, cats] = await Promise.all([byIds('driver', 'id', top.map((t) => t.driver_id), 'id,display_name').then(indexBy), db('category?select=id,name').then(indexBy)]);
      const seen = new Set();
      const list = top.filter((t) => !seen.has(t.driver_id) && seen.add(t.driver_id)).slice(0, 24);
      body = `<section class="panel"><div class="panel-head"><h3>Busiest racers this season</h3><span class="small muted">Most starts</span></div>
        ${list.length ? `<ul class="list">${list.map((d) => `<li>${link(`/driver/${d.driver_id}`, names[d.driver_id]?.display_name || 'Unknown racer')}<span class="muted small num">${esc(cats[d.category_id]?.name || '')} · ${d.n} starts</span></li>`).join('')}</ul>` : empty('Search for a racer by name above.')}</section>`;
    }
    return `<div class="stack"><header><span class="eyebrow">Racer stats</span><h1>Racers</h1>
      <form class="search" role="search" action="/drivers" style="margin-top:14px"><label for="q" class="sr">Racer name</label>
      <input id="q" name="q" value="${esc(term)}" placeholder="Search by name"><button class="btn" type="submit">Search</button></form></header>${body}</div>`;
  }

  async function driverPage(id, q) {
    if (!/^\d+$/.test(id)) return notFound();
    const d = await one(`driver?select=*&id=eq.${id}`);
    if (!d) return notFound();
    if (d.merged_into) { go(`/driver/${d.merged_into}`, true); return null; }
    document.title = `${d.display_name} · Downtrack Media`;
    const win = winFor(q.get('w'));
    const [entries, stats, cats] = await Promise.all([
      db(`entry?select=id,race_id,car_no,class_code,finish_round,is_winner,is_runner_up&driver_id=eq.${id}&limit=1000`),
      db(`stat_driver?select=*&driver_id=eq.${id}&time_window=eq.${win.key}`),
      db('category?select=id,slug,name,kind,uses_dial,distance_ft,index_et'),
    ]);
    const catBy = indexBy(cats);
    const races = indexBy(await byIds('race', 'id', entries.map((e) => e.race_id), 'id,event_id,category_id'));
    const events = indexBy(await byIds('event', 'id', Object.values(races).map((r) => r.event_id), 'id,name,season,start_date,end_date'));
    const rows = entries.map((e) => { const r = races[e.race_id], ev = r && events[r.event_id]; return r && ev ? { ...e, race: r, ev, cat: catBy[r.category_id] } : null; })
      .filter(Boolean).sort((a, b) => (b.ev.start_date || '').localeCompare(a.ev.start_date || ''));
    const wins = rows.filter((r) => r.is_winner).length, ru = rows.filter((r) => r.is_runner_up).length;
    const bs = {};
    for (const r of rows) { const k = `${r.ev.season}|${r.cat?.id}`; bs[k] ||= { s: r.ev.season, cat: r.cat, n: 0, w: 0, ru: 0 }; bs[k].n++; if (r.is_winner) bs[k].w++; if (r.is_runner_up) bs[k].ru++; }
    const seasons = Object.values(bs).sort((a, b) => b.s - a.s || (a.cat?.name || '').localeCompare(b.cat?.name || ''));
    const sc = [...new Set(stats.map((r) => r.category_id))];
    const clsRows = sc.length ? await db(`stat_category?select=*&category_id=in.(${sc.join(',')})&time_window=eq.${win.key}`) : [];
    const runs = (c) => stats.find((r) => r.category_id === c && r.metric === 'red_light')?.n || 0;
    sc.sort((a, b) => runs(b) - runs(a));
    const classesRun = [...new Set(rows.map((r) => r.cat?.name).filter(Boolean))];
    const sub = [[d.hometown, d.state].filter(Boolean).join(', '), classesRun.join(' · ')].filter(Boolean).join(' — ');
    return `<div class="stack">
      <header><a href="/drivers" class="small">← Racers</a><h1 style="margin-top:6px">${esc(d.display_name)}</h1>
        <p class="muted" style="margin:8px 0 0">${esc(sub)}</p>
        <div class="tally" style="margin-top:16px"><div><b>${rows.length}</b><span>Races</span></div><div><b>${wins}</b><span>Wins</span></div><div><b>${ru}</b><span>Runner-ups</span></div>
        ${d.downtrack_no ? `<div><b>#${esc(d.downtrack_no)}</b><span>Downtrack no.</span></div>` : ''}</div></header>
      ${tabs(`/driver/${id}`, win.key)}
      ${sc.length ? sc.map((c) => `<section class="panel"><div class="panel-head"><h3>${esc(catBy[c]?.name)} · ${win.label}</h3><a href="/class/${catBy[c]?.slug}?w=${win.key}" class="small">Class stats →</a></div>
        ${statTable(stats.filter((r) => r.category_id === c), catBy[c], clsRows.filter((r) => r.category_id === c))}</section>`).join('')
        : `<div class="panel">${empty(`No runs for ${d.display_name} in this window. Try All-time.`)}</div>`}
      ${seasons.length ? `<section class="panel"><div class="panel-head"><h3>Season by season</h3></div><div class="table-wrap"><table class="slip">
        <thead><tr><th scope="col">Season</th><th scope="col">Class</th><th scope="col">Races</th><th scope="col">Wins</th><th scope="col">Runner-ups</th></tr></thead><tbody>
        ${seasons.map((s) => `<tr><td>${s.s}</td><td style="text-align:left">${esc(s.cat?.name || '')}</td><td>${s.n}</td><td class="${s.w ? 'headline' : ''}">${s.w}</td><td>${s.ru}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}
      ${rows.length ? `<section class="panel"><div class="panel-head"><h3>Recent races</h3><span class="small muted">Last ${Math.min(rows.length, 25)}</span></div><div class="table-wrap"><table class="slip">
        <thead><tr><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Class</th><th scope="col">Car</th><th scope="col">Result</th></tr></thead><tbody>
        ${rows.slice(0, 25).map((r) => `<tr><td>${link(`/race/${r.race.id}`, r.ev.name)}</td><td class="flat">${dateRange(r.ev.start_date, r.ev.end_date)}</td>
          <td>${esc(r.class_code || r.cat?.name || '')}</td><td>${esc(r.car_no || '—')}</td>
          <td>${r.is_winner ? '<span class="chip win">Winner</span>' : r.is_runner_up ? '<span class="chip ru">Runner-up</span>' : `<span class="flat">${r.finish_round ? 'Out ' + esc(r.finish_round) : '—'}</span>`}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}</div>`;
  }

  async function eventsPage(q) {
    document.title = 'Results · Downtrack Media';
    const seasons = [...new Set((await all('event?select=season&order=season.desc', 5000)).map((r) => r.season))].filter(Boolean);
    const season = seasons.includes(Number(q.get('season'))) ? Number(q.get('season')) : seasons[0];
    const evs = season ? await db(`event?select=id,name,start_date,end_date,venue_id,series_id&season=eq.${season}&start_date=lte.${today()}&order=start_date.desc`) : [];
    const loaded = new Set((await byIds('race', 'event_id', evs.map((e) => e.id), 'event_id')).map((r) => r.event_id));
    const list = evs.filter((e) => loaded.has(e.id));
    const [venues, series] = await Promise.all([byIds('venue', 'id', list.map((e) => e.venue_id), 'id,name').then(indexBy), db('series?select=id,name').then(indexBy)]);
    return `<div class="stack"><header><span class="eyebrow">Results</span><h1>${season || ''} Results</h1>
      <p class="lead">NHRA national events and Lucas Oil divisionals. Pick an event for every class and every round.</p></header>
      ${seasons.length > 1 ? `<nav class="tabs" aria-label="Season">${seasons.map((s) => `<a href="/events?season=${s}"${s === season ? ' aria-current="page"' : ''}>${s}</a>`).join('')}</nav>` : ''}
      <section class="panel">${list.length ? `<div class="table-wrap"><table class="slip"><thead><tr><th scope="col">Event</th><th scope="col">Series</th><th scope="col">Track</th><th scope="col">Dates</th></tr></thead><tbody>
        ${list.map((e) => `<tr><td style="white-space:normal">${link(`/event/${e.id}`, e.name)}</td><td class="flat">${esc(series[e.series_id]?.name || '')}</td>
          <td class="flat" style="white-space:normal">${esc(venues[e.venue_id]?.name || '')}</td><td class="flat">${dateRange(e.start_date, e.end_date)}</td></tr>`).join('')}
        </tbody></table></div>` : empty('No results loaded for this season yet.')}</section></div>`;
  }

  async function eventPage(id) {
    if (!/^\d+$/.test(id)) return notFound();
    const ev = await one(`event?select=*&id=eq.${id}`);
    if (!ev) return notFound();
    document.title = `${ev.name} results · Downtrack Media`;
    const [races, cats, venue, series] = await Promise.all([
      db(`race?select=id,category_id,name,field_size&event_id=eq.${id}`), db('category?select=id,name,kind').then(indexBy),
      ev.venue_id ? one(`venue?select=*&id=eq.${ev.venue_id}`) : null, ev.series_id ? one(`series?select=name&id=eq.${ev.series_id}`) : null,
    ]);
    const finals = await byIds('entry', 'race_id', races.map((r) => r.id), 'race_id,driver_id,class_code,is_winner,is_runner_up', '&or=(is_winner.is.true,is_runner_up.is.true)');
    const names = indexBy(await byIds('driver', 'id', finals.map((f) => f.driver_id), 'id,display_name'));
    const ord = { pro: 0, sportsman: 1, bracket: 2 };
    races.sort((a, b) => (ord[cats[a.category_id]?.kind] ?? 9) - (ord[cats[b.category_id]?.kind] ?? 9) || a.category_id - b.category_id);
    const who = (f) => (f ? `${link(`/driver/${f.driver_id}`, names[f.driver_id]?.display_name || 'Unknown')}${f.class_code ? ` <span class="muted small">· ${esc(f.class_code)}</span>` : ''}` : '<span class="muted">—</span>');
    const place = venue ? [venue.name, [venue.city, venue.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : '';
    return `<div class="stack"><header><a href="/events?season=${ev.season}" class="small">← ${ev.season} results</a><h1 style="margin-top:6px">${esc(ev.name)}</h1>
      <p class="muted" style="margin:8px 0 0">${esc([series?.name, place, dateRange(ev.start_date, ev.end_date)].filter(Boolean).join(' · '))}</p></header>
      <section class="panel">${races.length ? `<div class="table-wrap"><table class="slip"><thead><tr><th scope="col">Class</th><th scope="col">Winner</th><th scope="col">Runner-up</th><th scope="col">Field</th><th scope="col"></th></tr></thead><tbody>
        ${races.map((r) => `<tr><td><b>${esc(cats[r.category_id]?.name || r.name)}</b></td>
          <td style="text-align:left">${who(finals.find((f) => f.race_id === r.id && f.is_winner))}</td>
          <td style="text-align:left">${who(finals.find((f) => f.race_id === r.id && f.is_runner_up))}</td>
          <td class="flat">${r.field_size || '—'}</td><td><a href="/race/${r.id}">Every round →</a></td></tr>`).join('')}
        </tbody></table></div>` : empty("Results for this event haven't loaded yet.")}</section></div>`;
  }

  async function racePage(id) {
    if (!/^\d+$/.test(id)) return notFound();
    const race = await one(`race?select=*&id=eq.${id}`);
    if (!race) return notFound();
    const [ev, cat, pairings, entries] = await Promise.all([
      one(`event?select=id,name,season,start_date,end_date&id=eq.${race.event_id}`), one(`category?select=*&id=eq.${race.category_id}`),
      all(`pairing?select=id,round_code,round_type,round_no,pair_no&race_id=eq.${id}&order=round_type,round_no,pair_no`),
      all(`entry?select=id,driver_id,car_no,class_code,is_winner,is_runner_up&race_id=eq.${id}`),
    ]);
    document.title = `${cat?.name || race.name} · ${ev?.name || ''} · Downtrack Media`;
    const runs = await byIds('run', 'pairing_id', pairings.map((p) => p.id), 'pairing_id,entry_id,lane,dial,rt,ft60,ft330,ft660,mph660,ft1000,et,mph,ov_un,is_win,red_light,breakout');
    const eBy = indexBy(entries);
    const names = indexBy(await byIds('driver', 'id', entries.map((e) => e.driver_id), 'id,display_name'));
    const byPair = {};
    for (const r of runs) (byPair[r.pairing_id] ||= []).push(r);
    Object.values(byPair).forEach((a) => a.sort((x, y) => (x.lane || '').localeCompare(y.lane || '')));
    const rounds = {};
    for (const p of pairings) { const k = p.round_code || `${p.round_type}${p.round_no ?? ''}`; (rounds[k] ||= { k, t: p.round_type, no: p.round_no, pairs: [] }).pairs.push(p); }
    const elim = Object.values(rounds).filter((r) => r.t === 'E').sort((a, b) => (b.no ?? 0) - (a.no ?? 0));
    const other = Object.values(rounds).filter((r) => r.t !== 'E').sort((a, b) => a.k.localeCompare(b.k));
    const last = elim[0]?.no, k1000 = cat?.distance_ft === 1000, dial = !!cat?.uses_dial;
    const head = `<thead><tr><th scope="col">Racer</th>${dial ? '<th scope="col">Dial</th>' : ''}<th scope="col">R/T</th><th scope="col">60'</th><th scope="col">330'</th><th scope="col">660'</th><th scope="col">MPH</th>${k1000 ? '' : "<th scope=\"col\">1000'</th>"}<th scope="col">ET</th><th scope="col">MPH</th>${dial ? '<th scope="col">+/−</th>' : ''}</tr></thead>`;
    const n2 = (v) => (v != null ? Number(v).toFixed(2) : '—'), n3 = (v) => (v != null ? Number(v).toFixed(3) : '—');
    const lane = (r) => { const e = eBy[r.entry_id], d = e && names[e.driver_id];
      return `<tr class="${r.is_win ? 'lane-win' : ''}"><td>${d ? link(`/driver/${e.driver_id}`, d.display_name) : '<span class="muted">—</span>'}<span class="muted small"> ${esc([e?.car_no, e?.class_code].filter(Boolean).join(' · '))}</span>${r.is_win ? ' <span class="chip win">W</span>' : ''}</td>
        ${dial ? `<td>${n2(r.dial)}</td>` : ''}<td class="${r.red_light ? 'redlight' : ''}">${dragNum(r.rt)}${r.red_light ? ' RED' : ''}</td>
        <td>${dragNum(r.ft60)}</td><td>${dragNum(r.ft330)}</td><td>${dragNum(r.ft660)}</td><td class="flat">${n2(r.mph660)}</td>
        ${k1000 ? '' : `<td>${dragNum(r.ft1000)}</td>`}<td class="headline">${n3(r.et)}</td><td>${n2(r.mph)}</td>
        ${dial ? `<td class="${r.breakout ? 'breakout' : 'flat'}">${dragNum(r.ov_un, 3, true)}</td>` : ''}</tr>`; };
    const table = (r) => `<div class="table-wrap"><table class="slip">${head}${r.pairs.map((p) => `<tbody class="pair">${(byPair[p.id] || []).map(lane).join('')}</tbody>`).join('')}</table></div>`;
    const title = (r) => (r.t === 'E' ? (r.no === last ? 'Final' : `Round ${r.no ?? r.k}`) : `${{ T: 'Time trial', Q: 'Qualifying' }[r.t] || 'Round'} ${r.k.replace(/^\D+/, '')}`.trim());
    const w = entries.find((e) => e.is_winner), ru = entries.find((e) => e.is_runner_up);
    return `<div class="stack"><header><a href="/event/${ev?.id}" class="small">← ${esc(ev?.name || '')}</a><h1 style="margin-top:6px">${esc(cat?.name || race.name)}</h1>
      <p class="muted" style="margin:8px 0 0">${esc([ev?.name, dateRange(ev?.start_date, ev?.end_date), race.field_size ? race.field_size + ' cars' : null].filter(Boolean).join(' · '))}</p>
      ${w || ru ? `<p style="margin:12px 0 0">${w ? `<span class="chip win">Winner</span> ${link(`/driver/${w.driver_id}`, names[w.driver_id]?.display_name || '')}` : ''}
        ${ru ? `<span class="chip ru" style="margin-left:12px">Runner-up</span> ${link(`/driver/${ru.driver_id}`, names[ru.driver_id]?.display_name || '')}` : ''}</p>` : ''}</header>
      ${!elim.length && !other.length ? `<div class="panel">${empty("Round-by-round results for this class haven't loaded yet.")}</div>` : ''}
      ${elim.map((r) => `<section class="panel"><div class="panel-head"><h3>${title(r)}</h3><span class="small muted">${r.pairs.length} pairs</span></div>${table(r)}</section>`).join('')}
      ${other.map((r) => `<details class="round"><summary>${title(r)} · ${r.pairs.length} pairs</summary>${table(r)}</details>`).join('')}</div>`;
  }

  function notFound() {
    document.title = 'Not found · Downtrack Media';
    return `<div class="stack"><h1>Off the track</h1><p class="lead">That page doesn't exist. It may have moved, or the link has a typo.</p><p><a class="btn" href="/">Back to the home page</a></p></div>`;
  }

  // ---------- router ----------
  async function route() {
    const { pathname } = location;
    const q = new URLSearchParams(location.search);
    const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    app.innerHTML = '<div class="loading">Loading</div>';
    document.title = 'Downtrack Media';
    let html;
    try {
      if (!parts.length) html = await home();
      else if (parts[0] === 'classes') html = await classes();
      else if (parts[0] === 'class' && parts[1]) html = await classPage(decodeURIComponent(parts[1]), q);
      else if (parts[0] === 'drivers') html = await drivers(q);
      else if (parts[0] === 'driver' && parts[1]) html = await driverPage(parts[1], q);
      else if (parts[0] === 'events') html = await eventsPage(q);
      else if (parts[0] === 'event' && parts[1]) html = await eventPage(parts[1]);
      else if (parts[0] === 'race' && parts[1]) html = await racePage(parts[1]);
      else html = notFound();
    } catch (e) {
      console.error(e);
      html = `<div class="stack"><h1>Something broke</h1><p class="lead">This page didn't load. Refresh to try again.</p></div>`;
    }
    if (html !== null) { app.innerHTML = html; window.scrollTo(0, 0); }
  }
  function go(href, replace) {
    history[replace ? 'replaceState' : 'pushState']({}, '', href);
    route();
  }
  // Same-site links and search forms load without a full page reload.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    go(url.pathname + url.search);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'signup' || f.getAttribute('action') == null && f.getAttribute('role') !== 'search') return;
    e.preventDefault();
    const params = new URLSearchParams(new FormData(f));
    go(`${f.getAttribute('action') || location.pathname}?${params}`);
  });
  window.addEventListener('popstate', route);

  // ---------- newsletter ----------
  const form = document.getElementById('signup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input'), msg = form.querySelector('.signup-msg'), btn = form.querySelector('button');
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Enter a full email address, like name@example.com.'; return; }
    btn.disabled = true; btn.textContent = 'Signing up…';
    try {
      const r = await fetch(`${C.url}/rest/v1/newsletter_signup`, {
        method: 'POST',
        headers: { apikey: C.key, 'Content-Type': 'application/json', 'Content-Profile': C.schema, Prefer: 'return=minimal' },
        body: JSON.stringify({ email, source: 'site-footer' }),
      });
      if (!r.ok && r.status !== 409) throw new Error(r.status);
      input.value = ''; msg.textContent = "You're on the list. First report lands Monday.";
    } catch { msg.textContent = "That didn't go through. Try again in a minute."; }
    btn.disabled = false; btn.textContent = 'Sign up';
  });
  form.querySelector('input').addEventListener('input', () => { form.querySelector('.signup-msg').textContent = ''; });
  document.getElementById('yr').textContent = new Date().getFullYear();

  route();
})();
