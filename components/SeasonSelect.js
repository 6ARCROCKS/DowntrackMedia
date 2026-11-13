'use client';

import { useRouter } from 'next/navigation';

// Season dropdown; each option carries its own URL.
export default function SeasonSelect({ options, current }) {
  const router = useRouter();
  return (
    <>
      <label htmlFor="season-select" className="sr">Season</label>
      <select
        id="season-select"
        className="season-select"
        value={String(current)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.season) === e.target.value);
          if (opt) router.push(opt.href);
        }}
      >
        {options.map((o) => (
          <option key={o.season} value={String(o.season)}>{o.label}</option>
        ))}
      </select>
    </>
  );
}
