'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { requestCode, verifyCode } from '../_lib/api';
import { ApiError } from '../_lib/types';
import { Button } from '../_ui/button';
import { Input } from '../_ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../_ui/input-otp';
import { Label } from '../_ui/label';

const heading = 'text-[22px] leading-snug font-semibold tracking-tight';

export function retryText(e: unknown): string {
  const s = e instanceof ApiError ? Number(e.details?.retry_after_seconds) : NaN;
  const mins = Number.isFinite(s) && s > 0 ? Math.ceil(s / 60) : 0;
  return mins ? `Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'}, then try again.` : 'Too many tries. Wait a few minutes, then try again.';
}

const message = (e: unknown) =>
  e instanceof ApiError && e.code === 'rate_limited' ? retryText(e) : e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.';

/**
 * Email-code sign-in (POST /api/v1/auth/request-code, then /verify-code): an email step, then a 6-digit code.
 * Used by the link page, the signed-out gate on /c pages, and the "link already used" screen. Render it inside a
 * card; `onSignedIn` runs once the session cookie is set.
 */
export function EmailSignIn({
  title,
  intro,
  emailNote,
  footer,
  onSignedIn,
}: {
  title: string;
  intro: ReactNode;
  /** Shown under the email field when there's no error. */
  emailNote?: ReactNode;
  /** Shown under the email step's button. */
  footer?: ReactNode;
  onSignedIn: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await requestCode(email.trim());
      setStep('code');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(value: string) {
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), value);
    } catch (e) {
      setError(message(e));
      setCode('');
      setBusy(false);
      return;
    }
    await onSignedIn();
  }

  async function resend() {
    setError(null);
    try {
      await requestCode(email.trim());
    } catch (e) {
      setError(message(e));
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={sendCode} noValidate>
        <h1 className={heading}>{title}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{intro}</p>
        <div className="mt-6 grid gap-2">
          <Label htmlFor="vt-email" className="text-[15px]">
            Email
          </Label>
          <Input
            id="vt-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'vt-email-error' : emailNote ? 'vt-email-note' : undefined}
            className="h-12 rounded-xl px-3.5 text-base md:text-base"
          />
          {error ? (
            <p id="vt-email-error" className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : (
            emailNote && (
              <p id="vt-email-note" className="text-sm text-muted-foreground">
                {emailNote}
              </p>
            )
          )}
        </div>
        <Button type="submit" disabled={busy} className="mt-6 h-12 w-full rounded-xl text-base font-semibold">
          {busy ? <Loader2 className="animate-spin" /> : <Mail />} Email me a code
        </Button>
        {footer && <p className="mt-4 text-center text-sm text-muted-foreground">{footer}</p>}
      </form>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setStep('email');
          setCode('');
          setError(null);
        }}
        className="-ml-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Change email
      </button>
      <h1 className={heading}>Check your email</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        Enter the 6-digit code we sent to <span className="font-medium break-words text-foreground">{email.trim()}</span>.
      </p>
      <div className="mt-6">
        <Label htmlFor="vt-code" className="sr-only">
          Sign-in code
        </Label>
        <InputOTP
          id="vt-code"
          maxLength={6}
          value={code}
          onChange={(v) => {
            setCode(v.replace(/\D/g, ''));
            if (v.length === 6) void checkCode(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={busy}
          autoFocus
          containerClassName="justify-center"
          aria-invalid={Boolean(error)}
        >
          <InputOTPGroup className="gap-1.5 sm:gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} className="h-12 w-11 rounded-xl! border text-xl font-medium sm:size-14" />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <p className={error ? 'mt-3 text-center text-sm text-destructive' : 'mt-3 text-center text-sm text-muted-foreground'} role={error ? 'alert' : undefined}>
          {error ?? (busy ? 'Checking…' : 'The code expires in 10 minutes.')}
        </p>
      </div>
      <Button type="button" variant="outline" disabled={busy} className="mt-6 h-12 w-full rounded-xl bg-card text-base" onClick={() => void resend()}>
        Send a new code
      </Button>
    </div>
  );
}

/** The card the sign-in form sits in on plain (unbranded) pages. */
export function SignInCard({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</section>;
}
