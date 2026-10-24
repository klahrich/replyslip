'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { requestSignInCode } from './auth-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Landing-page email form. Asks the relay to email a sign-in code, then moves
 * to the code step on /sign-in.
 */
export function EmailStart({ id, label = 'Your email' }: { id: string; label?: string }) {
  const router = useRouter();
  const inputId = `email-${id}`;
  const msgId = `msg-${id}-${useId()}`;
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError(value ? 'That email looks incomplete. Check it and try again.' : 'Enter your email to get started.');
      document.getElementById(inputId)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    const res = await requestSignInCode(value);
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      return;
    }
    router.push(`/sign-in?email=${encodeURIComponent(value)}&sent=1`);
  }

  return (
    <form className="signup" id={`signup-${id}`} noValidate onSubmit={onSubmit}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        placeholder="you@example.com"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error && EMAIL_RE.test(e.target.value.trim())) setError('');
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={msgId}
      />
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Get started'}
      </button>
      <p className={error ? 'form-msg err' : 'form-msg'} id={msgId} role="status" aria-live="polite">
        {error}
      </p>
    </form>
  );
}
