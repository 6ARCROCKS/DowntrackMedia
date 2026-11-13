'use client';

// Shown instead of Netlify's error page if a page fails to load.
export default function Error({ reset }) {
  return (
    <div className="stack">
      <h1>Page didn't load</h1>
      <p className="lead">The results server took too long to answer. It's usually fine on the second try.</p>
      <p>
        <button className="btn" type="button" onClick={() => reset()}>
          Try again
        </button>
      </p>
    </div>
  );
}
