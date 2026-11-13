import Link from 'next/link';
import { WINDOWS, windowHref } from '@/lib/metrics';

// Time-window switcher. Links (not JS state) so every view has its own URL.
export default function WindowTabs({ basePath, current, available }) {
  const shown = WINDOWS.filter((w) => !available || available.has(w.key) || w.key === current);
  return (
    <nav className="tabs" aria-label="Time window">
      {shown.map((w) => (
        <Link
          key={w.key}
          href={windowHref(basePath, w.key)}
          aria-current={w.key === current ? 'page' : undefined}
          scroll={false}
        >
          {w.label}
        </Link>
      ))}
    </nav>
  );
}
