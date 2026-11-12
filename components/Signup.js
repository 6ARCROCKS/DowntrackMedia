'use client';

import { useState } from 'react';

// Newsletter signup. The database lets the public insert into
// dt.newsletter_signup and nothing else.
export default function Signup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ status: 'idle', msg: '' });

  async function submit(e) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setState({ status: 'error', msg: 'Enter a full email address, like name@example.com.' });
      return;
    }
    setState({ status: 'sending', msg: '' });
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/newsletter_signup`, {
        method: 'POST',
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Content-Profile': process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'dt',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ email: value, source: 'site-footer' }),
      });
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      setEmail('');
      setState({ status: 'done', msg: "You're on the list. First report lands Monday." });
    } catch {
      setState({ status: 'error', msg: "That didn't go through. Try again in a minute." });
    }
  }

  return (
    <form className="signup" onSubmit={submit} noValidate>
      <label htmlFor="signup-email" className="small" style={{ position: 'absolute', left: -9999 }}>
        Email address
      </label>
      <input
        id="signup-email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state.status === 'error') setState({ status: 'idle', msg: '' });
        }}
        autoComplete="email"
      />
      <button className="btn" type="submit" disabled={state.status === 'sending'}>
        {state.status === 'sending' ? 'Signing up…' : 'Sign up'}
      </button>
      <div className="signup-msg" role="status" style={{ flexBasis: '100%' }}>
        {state.msg}
      </div>
    </form>
  );
}
