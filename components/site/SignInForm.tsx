'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RATE_LIMITS } from '@/lib/constants';
import { requestSignInCode, verifySignInCode } from './auth-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
type Step = 'email' | 'code';

export function SignInForm({ initialEmail, initialStep }: { initialEmail: string; initialStep: Step }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
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
    const res = await requestSignInCode(value);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEmail(value);
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
    const res = await verifySignInCode(email.trim(), value);
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      if (res.code === 'invalid_code') setCode('');
      return;
    }
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
