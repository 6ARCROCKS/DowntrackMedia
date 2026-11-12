// Thin read-only client for the Supabase REST API (PostgREST), schema "dt".
// Every call is cached by Next.js for an hour; failures return [] so a page
// still renders with an empty state instead of crashing.

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY;
const SCHEMA = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'dt';

const headers = () => ({ apikey: KEY, 'Accept-Profile': SCHEMA });

export async function db(path, { revalidate = 3600 } = {}) {
  if (!BASE || !KEY) return [];
  try {
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
      headers: headers(),
      next: { revalidate },
    });
    if (!res.ok) {
      console.error(`[db] ${res.status} ${path}`, (await res.text()).slice(0, 300));
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error(`[db] ${path}`, err);
    return [];
  }
}

// First row or null.
export async function one(path, opts) {
  const rows = await db(path, opts);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Fetch rows for a long list of ids in chunks, so URLs stay short and no
// single request hits the 1,000-row API cap.
export async function byIds(table, column, ids, select = '*', extra = '', size = 150) {
  const unique = [...new Set(ids.filter((v) => v !== null && v !== undefined))];
  const out = [];
  for (let i = 0; i < unique.length; i += size) {
    const chunk = unique.slice(i, i + size);
    const rows = await db(`${table}?select=${select}&${column}=in.(${chunk.join(',')})${extra}`);
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}

// Page through a query past the 1,000-row cap (stops at maxRows).
export async function all(path, { pageSize = 1000, maxRows = 10000 } = {}) {
  const out = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await db(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// Fast estimated row count (uses Postgres statistics, not a full scan).
export async function estimate(table) {
  if (!BASE || !KEY) return null;
  try {
    const res = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=1`, {
      headers: { ...headers(), Prefer: 'count=estimated' },
      next: { revalidate: 86400 },
    });
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

export const indexBy = (rows, key = 'id') =>
  Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const publicConfig = { base: BASE, key: KEY, schema: SCHEMA };
