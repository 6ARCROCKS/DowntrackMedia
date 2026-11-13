// What each stat is, how to print it, and which direction is "better".
// better: 'low' (smaller is better), 'high', or null (no right answer, e.g. dial choice).

export const WINDOWS = [
  { key: 'season', label: 'This season', minRuns: 10 },
  { key: 'last3', label: 'Last 3 races', minRuns: 3 },
  { key: '3yr', label: 'Last 3 seasons', minRuns: 20 },
  { key: 'all', label: 'All-time', minRuns: 25 },
  { key: 'today', label: 'Today', minRuns: 1 },
];

export const windowFor = (key) => WINDOWS.find((w) => w.key === key) || WINDOWS[0];
// Window from the URL path: none = this season; unknown = null (404).
export const windowFromPath = (seg) => (!seg || !seg.length ? WINDOWS[0] : seg.length === 1 ? WINDOWS.find((w) => w.key === seg[0]) || null : null);
export const windowHref = (base, key) => (key === 'season' ? base : `${base}/${key}`);

export const INDEX_CLASSES = ['stock-eliminator', 'super-stock', 'competition-eliminator'];
export const isIndexClass = (cat) => INDEX_CLASSES.includes(cat?.slug);
export const isDialInClass = (cat) => cat?.uses_dial && !isIndexClass(cat);

export const METRICS = [
  { key: 'rt', label: 'Reaction time', group: 'Starting line', dec: 3, better: 'low',
    help: 'Red lights left out' },
  { key: 'rt_plus_60', label: "R/T + 60'", group: 'Starting line', dec: 3, better: 'low',
    help: 'Reaction time plus 60-foot time' },
  { key: 'red_light', label: 'Red-light rate', group: 'Starting line', pct: true, better: 'low',
    help: 'Share of starts that were red lights' },
  { key: 'package', label: 'Package', group: 'Starting line', dec: 3, better: 'low',
    help: 'Reaction time plus over/under the dial' },
  { key: 'dial_variance', label: 'Variance from dial', group: 'On the dial', dec: 3, signed: true, better: null,
    help: 'ET minus dial-in. + is over, − is a breakout' },
  { key: 'q_under_index', label: 'Under the index, qualifying', group: 'On the index', dec: 3, better: 'high',
    help: 'How far under the class index they qualify' },
  { key: 'dial_under_index', label: 'Dial under the index', group: 'On the index', dec: 3, better: null,
    help: 'How far under the index they dial in eliminations' },
  { key: 'headsup_under_index', label: 'Under the index, heads-up', group: 'On the index', dec: 3, better: 'high',
    help: 'How far under the index they run when racing on the index' },
  { key: 'headsup_rate', label: 'Rounds run heads-up', group: 'On the index', pct: true, better: null,
    help: 'Share of elimination rounds run on the index instead of a dial' },
  { key: 'ft60', label: "60'", group: 'Increments', dec: 3, better: 'low' },
  { key: 'ft330', label: "330'", group: 'Increments', dec: 3, better: 'low' },
  { key: 'ft660', label: "660'", group: 'Increments', dec: 3, better: 'low' },
  { key: 'mph660', label: "660' MPH", group: 'Increments', dec: 2, better: 'high' },
  { key: 'ft1000', label: "1000'", group: 'Increments', dec: 3, better: 'low' },
  { key: 'et', label: 'ET', group: 'Increments', dec: 3, better: 'low' },
  { key: 'mph', label: 'MPH', group: 'Increments', dec: 2, better: 'high' },
  { key: 's60_330', label: "60'–330'", group: 'Splits', dec: 3, better: 'low' },
  { key: 's330_660', label: "330'–660'", group: 'Splits', dec: 3, better: 'low' },
  { key: 's660_1000', label: "660'–1000'", group: 'Splits', dec: 3, better: 'low' },
  { key: 's1000_1320', label: "1000'–1320'", group: 'Splits', dec: 3, better: 'low' },
  { key: 'mph_660_1320', label: "MPH gain, 660' to finish", group: 'Splits', dec: 2, better: 'high' },
];

export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));
export const GROUPS = [...new Set(METRICS.map((m) => m.group))];

// Labels that depend on the class: nitro classes race to 1,000 feet.
export function metricLabel(m, cat) {
  if (m.key === 'et') return cat?.distance_ft === 1000 ? "ET (1000')" : "ET (1320')";
  return m.label;
}

// Drag-racing style: .020 instead of 0.020.
export function dragNum(v, dec = 3, signed = false) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  let s = Math.abs(n).toFixed(dec);
  if (Math.abs(n) < 1 && dec >= 3) s = s.replace(/^0/, '');
  if (n < 0) return `−${s}`;
  return signed && n > 0 ? `+${s}` : s;
}

export function fmt(metricKey, v) {
  const m = METRIC[metricKey];
  if (v === null || v === undefined) return '—';
  if (!m) return String(v);
  if (m.pct) return `${(Number(v) * 100).toFixed(1)}%`;
  return dragNum(v, m.dec, m.signed);
}

export function fmtChange(metricKey, v) {
  const m = METRIC[metricKey];
  if (v === null || v === undefined || !m) return { text: '—', tone: 'flat' };
  const n = Number(v);
  const text = m.pct ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(1)} pts` : dragNum(n, m.dec, true);
  let tone = 'flat';
  if (m.better && Math.abs(n) > 0) {
    const improving = m.better === 'low' ? n < 0 : n > 0;
    tone = improving ? 'good' : 'bad';
  }
  return { text, tone };
}

export const thousands = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));

export const KIND_LABEL = { pro: 'Pro', sportsman: 'Sportsman', bracket: 'Bracket' };
