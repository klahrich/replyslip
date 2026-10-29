'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Link2Off, Loader2, Mail } from 'lucide-react';
import { acceptLink, getLink, requestCode, verifyCode } from '../_lib/api';
import { brandStyle } from '../_lib/brand';
import { ApiError, type LinkResponse } from '../_lib/types';
import { Button } from '../_ui/button';
import { Input } from '../_ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../_ui/input-otp';
import { Label } from '../_ui/label';
import { LogoTile, PlainFrame, ValettoFooter } from '../_components/Frame';
import { Notice } from '../_components/Notice';
import { Loading } from './common';

type Step = 'email' | 'code';

const linkErrors: Record<string, { title: string; body: string }> = {
  invite_not_found: { title: "This link doesn't work anymore", body: 'Ask the business that sent it for a new one.' },
  invite_expired: { title: 'This link has expired', body: 'Ask the business that sent it for a new one.' },
  invite_used_up: { title: 'This link has already been used', body: 'Ask the business that sent it for a new one.' },
  rate_limited: { title: 'Too many tries', body: 'Wait a few minutes, then open the link again.' },
};

const mistake = (name: string) => `If you think this is a mistake, contact ${name} directly.`;

export function LinkView({ token }: { token: string }) {
  const router = useRouter();
  const [link, setLink] = useState<LinkResponse | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; body?: string } | null>(null);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLink(token).then(
      (l) => {
        if (l.next === 'open_bot' || l.next === 'wait') router.replace(`/c/${l.bot.agent_id}`);
        else if (l.next === 'blocked') setBlocked({ title: `${l.bot.branding.display_name} didn't approve this request.`, body: mistake(l.bot.branding.display_name) });
        setLink(l);
      },
      (e) => setDead(e instanceof ApiError ? e.code : 'invite_not_found'),
    );
  }, [token, router]);

  if (dead) {
    const c = linkErrors[dead] ?? linkErrors.invite_not_found;
    return (
      <PlainFrame>
        <Notice icon={<Link2Off />} title={c.title}>
          <p>{c.body}</p>
        </Notice>
      </PlainFrame>
    );
  }
  if (!link) return <Loading />;

  const name = link.bot.branding.display_name;
  const asks = link.access_mode === 'approve_each';

  async function accept() {
    try {
      const r = await acceptLink(token);
      router.push(`/c/${r.bot.agent_id}`);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'share_revoked') setBlocked({ title: `${name} didn't approve this request.`, body: mistake(name) });
      // Section 17.6: show the server's wording; it deliberately doesn't say why.
      else if (code === 'pending_queue_full') setBlocked({ title: (e instanceof Error && e.message) || "This business isn't accepting new customers right now. Try again later." });
      else if (code === 'plan_limit') setBlocked({ title: (e instanceof Error && e.message) || "This business can't add new customers right now." });
      else if (code === 'invite_email_mismatch') setBlocked({ title: 'This invite was sent to a different email. Sign in with that email, or ask for a new invite.' });
      else setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  async function sendCode(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await requestCode(email.trim());
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(value: string) {
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), value);
      if (link?.next === 'sign_in' || link?.next === 'accept') await accept();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col" style={brandStyle(link.bot.branding)}>
      <div aria-hidden className="h-1 w-full bg-primary" />
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-4 pt-12 pb-6 sm:pt-20">
        <div className="flex flex-col items-center text-center">
          <LogoTile branding={link.bot.branding} size={72} />
          <p className="mt-4 text-[15px] font-medium text-muted-foreground">{name}</p>
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {blocked ? (
            <>
              <h1 className="text-[22px] leading-snug font-semibold tracking-tight">{blocked.title}</h1>
              {blocked.body && <p className="mt-2 text-[15px] text-muted-foreground">{blocked.body}</p>}
            </>
          ) : step === 'email' ? (
            <form onSubmit={sendCode} noValidate>
              <h1 className="text-[22px] leading-snug font-semibold tracking-tight">
                {asks ? `Sign in to ask ${name} for access` : `Sign in to send a request to ${name}`}
              </h1>
              <p className="mt-2 text-[15px] text-muted-foreground">We&apos;ll email you a 6-digit code. No password needed.</p>
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
                  aria-describedby={error ? 'vt-email-error' : 'vt-email-note'}
                  className="h-12 rounded-xl px-3.5 text-base md:text-base"
                />
                {error ? (
                  <p id="vt-email-error" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : (
                  <p id="vt-email-note" className="text-sm text-muted-foreground">
                    {name} will see your email.
                  </p>
                )}
              </div>
              <Button type="submit" disabled={busy} className="mt-6 h-12 w-full rounded-xl text-base font-semibold">
                {busy ? <Loader2 className="animate-spin" /> : <Mail />} Email me a code
              </Button>
              {asks && <p className="mt-4 text-center text-sm text-muted-foreground">{name} approves each new customer.</p>}
            </form>
          ) : (
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
              <h1 className="text-[22px] leading-snug font-semibold tracking-tight">Check your email</h1>
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
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="mt-6 h-12 w-full rounded-xl bg-card text-base"
                onClick={() => {
                  setError(null);
                  void requestCode(email.trim());
                }}
              >
                Send a new code
              </Button>
            </div>
          )}
        </section>
      </main>
      <ValettoFooter />
    </div>
  );
}
