import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="stack">
      <h1>Off the track</h1>
      <p className="lead">That page doesn't exist. It may have moved, or the link has a typo.</p>
      <p><Link className="btn" href="/">Back to the home page</Link></p>
    </div>
  );
}
