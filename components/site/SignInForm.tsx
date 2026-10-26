'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { RATE_LIMITS } from '@/lib/constants';
import {
  forgetSignInEmail,
  rememberSignInEmail,
  requestSignInCode,
  SOURCE_MAX,
  sourceFromUrl,
  storedSignInEmail,
  verifySignInCode,
} from './auth-client';
import { MARKETING_CONSENT_TEXT } from './marketing-consent';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
type Step = 'email' | 'code';

const noSubscribe = () => () => {};
/** Visitors from /sharing arrive with ?ref=sharing. Their sign-in sends wants_sharing: true, which feeds the wants_sharing count, separate from source. */
const fromSharing = () => new URLSearchParams(window.location.search).get('ref') === 'sharing';

/** `sent` means the landing form already asked for a code; the email itself comes from sessionStorage. */
export function SignInForm({ sent }: { sent: boolean }) {
  const router = useRouter();
  const stored = useSyncExternalStore(noSubscribe, storedSignInEmail, () => null);
  const [stepChoice, setStep] = useState<Step | null>(null);
  const [emailInput, setEmail] = useState<string | null>(null);
  const step: Step = stepChoice ?? (sent && stored ? 'code' : 'email');
  const email = emailInput ?? stored ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [source, setSource] = useState('');
  const wantsSharing = useSyncExternalStore(noSubscribe, fromSharing, () => false);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
    else emailRef.current?.focus();
  }, [step]);

  async function sendCode(ev?: FormEvent) {
    ev?.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError(value ? 'That email looks incomplete. Check it and try again.' : 'Enter your email.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const res = await requestSignInCode(value, source.trim() || sourceFromUrl(), wantsSharing);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEmail(value);
    rememberSignInEmail(value);
    setCode('');
    if (step === 'code') {
      setResent(true);
      setNotice('We sent a new code. Only the newest code works.');
    }
    setStep('code');
  }

  async function verify(ev: FormEvent) {
    ev.preventDefault();
    const value = code.replace(/\D/g, '');
    if (value.length !== 6) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const res = await verifySignInCode(email.trim(), value, marketing);
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      if (res.code === 'invalid_code') setCode('');
      return;
    }
    forgetSignInEmail();
    router.replace('/dashboard');
    router.refresh();
  }

  if (step === 'email') {
    return (
      <>
        <h1>Sign in to ReplySlip</h1>
        <p className="lead">Enter your email and we’ll send you a 6-digit code. New here? The same code creates your workspace.</p>
        <form className="signup" noValidate onSubmit={sendCode}>
          <label htmlFor="si-email">Your email</label>
          <input
            ref={emailRef}
            id="si-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby="si-email-msg"
          />
          <label htmlFor="si-source">How did you hear about ReplySlip? (optional)</label>
          <input
            id="si-source"
            name="source"
            type="text"
            autoComplete="off"
            maxLength={SOURCE_MAX}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <p className={error ? 'form-msg err' : 'form-msg'} id="si-email-msg" role="status" aria-live="polite">
            {error}
          </p>
        </form>
      </>
    );
  }

  const canVerify = code.replace(/\D/g, '').length === 6;
  return (
    <>
      <h1>Check your email</h1>
      <p className="lead">
        If <strong>{email}</strong> can receive mail, a 6-digit code is on its way. It expires in 10 minutes, and you
        have 5 tries.
      </p>
      <form className="signup" noValidate onSubmit={verify}>
        <label htmlFor="si-code">Sign-in code</label>
        <input
          ref={codeRef}
          id="si-code"
          className="code-input"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          required
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            if (error) setError('');
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="si-code-msg"
        />
        <button className="btn" type="submit" disabled={busy || !canVerify}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <div className="si-consent">
          <input
            id="si-marketing"
            name="marketing_opt_in"
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
          />
          <label htmlFor="si-marketing">{MARKETING_CONSENT_TEXT}</label>
        </div>
        <p
          className={error ? 'form-msg err' : notice ? 'form-msg ok' : 'form-msg'}
          id="si-code-msg"
          role="status"
          aria-live="polite"
        >
          {error || notice}
        </p>
      </form>
      <div className="row-links">
        <button type="button" className="textbtn" onClick={() => sendCode()} disabled={busy}>
          {resent ? 'Send another code' : 'Send a new code'}
        </button>
        <button
          type="button"
          className="textbtn"
          onClick={() => {
            setStep('email');
            setEmail(email);
            forgetSignInEmail();
            setCode('');
            setError('');
            setNotice('');
          }}
        >
          Use a different email
        </button>
      </div>
      <p className="row-links">
        No email after a few minutes? Check spam. You can ask for up to {RATE_LIMITS.requestCode.email} codes every{' '}
        {Math.round(RATE_LIMITS.requestCode.windowMs / 60000)} minutes.
      </p>
    </>
  );
}
