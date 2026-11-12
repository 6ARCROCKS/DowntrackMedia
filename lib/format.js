const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-10-22' -> 'Oct 22, 2026' without timezone drift.
export function date(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function dateRange(start, end) {
  if (!start) return '';
  if (!end || end === start) return date(start);
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  if (y1 === y2 && m1 === m2) return `${MONTHS[m1 - 1]} ${d1}–${d2}, ${y1}`;
  if (y1 === y2) return `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y1}`;
  return `${date(start)} – ${date(end)}`;
}

export function placeName(venue) {
  if (!venue) return '';
  const where = [venue.city, venue.state].filter(Boolean).join(', ');
  return where ? `${venue.name} · ${where}` : venue.name;
}

export function resultLabel(entry) {
  if (!entry) return '';
  if (entry.is_winner) return 'Winner';
  if (entry.is_runner_up) return 'Runner-up';
  return entry.finish_round ? `Out ${entry.finish_round}` : '—';
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
