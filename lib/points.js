// Lucas Oil points helpers. The database does the official totals
// (dt.pts_national, dt.pts_division); this file re-runs the same counting
// rules in the browser-free server code so the points-race chart can show
// how each total built up event by event.

export const DIVISIONS = [1, 2, 3, 4, 5, 6, 7];

// Parse the URL path after /points/[slug]:
//   []                      -> national, latest season
//   ['2025']                -> national, 2025
//   ['division-4']          -> Div. 4, latest season
//   ['division-4', '2025']  -> Div. 4, 2025
//   ['records'] / ['division-4', 'records'] -> records view
export function parseScope(parts = []) {
  let division = null;
  let season = null;
  let records = false;
  for (const p of parts) {
    const d = /^division-([1-7])$/.exec(p);
    if (d && division === null) division = Number(d[1]);
    else if (/^20\d\d$/.test(p) && season === null) season = Number(p);
    else if (p === 'records' && !records) records = true;
    else return null;
  }
  if (parts.length > 2 || (records && season)) return null;
  return { division, season, records };
}

export function scopeHref(slug, division, season, latest, records = false) {
  const parts = [`/points/${slug}`];
  if (division) parts.push(`division-${division}`);
  if (records) parts.push('records');
  else if (season && season !== latest) parts.push(String(season));
  return parts.join('/');
}

const byDate = (a, b) => (a.event_date || '').localeCompare(b.event_date || '') || a.event_id - b.event_id;
const byPoints = (a, b) => b.points - a.points || byDate(a, b);

function sumBest(rows, n) {
  return [...rows].sort(byPoints).slice(0, n).reduce((s, r) => s + r.points, 0);
}

// National total from a driver's events (already filtered to class + season).
export function nationalTotal(events, rule) {
  const div = events.filter((e) => e.kind === 'div').sort(byDate).slice(0, rule.div_first);
  const nat = events.filter((e) => e.kind === 'nat').sort(byDate).slice(0, rule.nat_first);
  return sumBest(div, rule.div_best) + sumBest(nat, rule.nat_best);
}

// Divisional total: first N divisional events, best N, at most M out of the home division.
export function divisionTotal(events, rule, homeDiv) {
  const div = events.filter((e) => e.kind === 'div').sort(byDate).slice(0, rule.division_first);
  const home = div.filter((e) => e.division === homeDiv);
  const out = div.filter((e) => e.division !== homeDiv).sort(byPoints).slice(0, rule.division_max_out);
  return sumBest([...home, ...out], rule.division_best);
}

// Cumulative total after each event date, for the chart.
export function pointsRace(eventsByDriver, rule, mode, homeDivBy = {}) {
  const dates = [...new Set(Object.values(eventsByDriver).flat().map((e) => e.event_date))].sort();
  const series = {};
  for (const [driverId, evs] of Object.entries(eventsByDriver)) {
    series[driverId] = dates.map((d) => {
      const sofar = evs.filter((e) => e.event_date <= d);
      return mode === 'division' ? divisionTotal(sofar, rule, homeDivBy[driverId]) : nationalTotal(sofar, rule);
    });
  }
  return { dates, series };
}

// The lowest score a new result has to beat to raise the total,
// or null if the racer still has an open counting slot.
export function mustBeat(events, rule, mode, homeDiv) {
  if (mode === 'division') {
    const div = events.filter((e) => e.kind === 'div').sort(byDate);
    if (div.length >= rule.division_first) return { closed: true };
    const elig = div.slice(0, rule.division_first);
    const home = elig.filter((e) => e.division === homeDiv);
    const out = elig.filter((e) => e.division !== homeDiv).sort(byPoints).slice(0, rule.division_max_out);
    const counted = [...home, ...out].sort(byPoints).slice(0, rule.division_best);
    if (counted.length < rule.division_best) return { open: rule.division_best - counted.length, left: rule.division_first - div.length };
    return { beat: counted.at(-1).points, left: rule.division_first - div.length };
  }
  const div = events.filter((e) => e.kind === 'div').sort(byDate);
  const left = Math.max(0, rule.div_first - div.length);
  if (!left) return { closed: true };
  const counted = div.slice(0, rule.div_first).sort(byPoints).slice(0, rule.div_best);
  if (counted.length < rule.div_best) return { open: rule.div_best - counted.length, left };
  return { beat: counted.at(-1).points, left };
}
