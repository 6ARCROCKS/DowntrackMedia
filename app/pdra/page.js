import { redirect } from 'next/navigation';

// PDRA sits beside NHRA on every page now; old links land on PDRA results.
export default function Pdra({ searchParams }) {
  const s = /^\d{4}$/.test(String(searchParams?.season || '')) ? `&season=${searchParams.season}` : '';
  redirect(`/events?series=pdra${s}`);
}
