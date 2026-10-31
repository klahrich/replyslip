'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link2Off, Loader2, Mail } from 'lucide-react';
import { acceptLink, getLink } from '../_lib/api';
import { ApiError, type Branding, type LinkResponse } from '../_lib/types';
import { Button } from '../_ui/button';
import { EmailSignIn, SignInCard, retryText } from '../_components/EmailSignIn';
import { CenteredFrame } from '../_components/Frame';
import { Notice } from '../_components/Notice';
import { Loading, homeAfterSignIn, useEmail } from './common';

const linkErrors: Record<string, { title: string; body: string }> = {
  invite_not_found: { title: "This link doesn't work anymore", body: 'Ask the business that sent it for a new one.' },
  invite_expired: { title: 'This link has expired', body: 'Ask the business that sent it for a new one.' },
  invite_used_up: { title: 'This link has already been used', body: 'Ask the business that sent it for a new one.' },
  rate_limited: { title: 'Too many tries', body: 'Wait a few minutes, then open the link again.' },
  network_error: { title: "We couldn't load this link", body: 'Check your connection, then open the link again.' },
  internal_error: { title: "We couldn't load this link", body: 'Something went wrong on our side. Try again in a minute.' },
};

const onHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const hashToken = () => {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return ''; // a malformed % escape: shown as a dead link
  }
};

/** Reads the token from the URL fragment (/c/link#rsl_…), which browsers never send to the server. */
export function LinkFromHash() {
  const token = useSyncExternalStore(onHash, hashToken, () => null);
  if (token === null) return <Loading />;
  if (!token.startsWith('rsl_')) return <DeadLink code="invite_not_found" />;
  // Keyed so a second link pasted into the same tab starts fresh.
  return <LinkView key={token} token={token} />;
}

/** `branding` is known when the link loaded and only failed on accept; a link that fails to load (R1 404/410) has none. */
function DeadLink({ code, branding = null }: { code: string; branding?: Branding | null }) {
  const c = linkErrors[code] ?? linkErrors.invite_not_found;
  if (code === 'invite_used_up') return <UsedUpLink title={c.title} branding={branding} />;
  return (
    <CenteredFrame branding={branding}>
      <Notice icon={<Link2Off />} title={c.title}>
        <p>{c.body}</p>
      </Notice>
    </CenteredFrame>
  );
}

/**
 * Personal links work once. Someone who already joined with one gets back in with an email code and lands on
 * their businesses list (/c); someone still signed in just gets a way there.
 */
function UsedUpLink({ title, branding }: { title: string; branding: Branding | null }) {
  const business = branding?.display_name ?? 'this business';
  const router = useRouter();
  const email = useEmail();
  const [signingIn, setSigningIn] = useState(false);
  if (signingIn) {
    return (
      <CenteredFrame branding={branding}>
        <SignInCard>
          <EmailSignIn
            title="Sign in with your email"
            intro={`Enter the email you used with ${business}. We'll send you a 6-digit code.`}
            onSignedIn={async () => router.push(await homeAfterSignIn())}
          />
        </SignInCard>
      </CenteredFrame>
    );
  }
  return (
    <CenteredFrame branding={branding}>
      <Notice
        icon={<Link2Off />}
        title={title}
        action={
          email ? (
            <Button asChild className="h-12 w-full rounded-xl text-base font-semibold">
              <Link href="/c">Go to your businesses</Link>
            </Button>
          ) : (
            <Button type="button" onClick={() => setSigningIn(true)} className="h-12 w-full rounded-xl text-base font-semibold">
              <Mail /> Sign in with your email
            </Button>
          )
        }
      >
        <p>{email
            ? `You're signed in as ${email}. Your businesses and requests are on your list.`
            : `If you've already joined, sign in with your email to get back to your requests. Otherwise, ask ${branding ? business : 'the business'} for a new link.`}</p>
      </Notice>
    </CenteredFrame>
  );
}

const turnedOff = (name: string) => ({ title: `${name} has turned off your access.`, body: mistake(name) });

const mistake = (name: string) => `If you think this is a mistake, contact ${name} directly.`;

export function LinkView({ token }: { token: string }) {
  const router = useRouter();
  const [link, setLink] = useState<LinkResponse | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; body?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLink(token).then(
      (l) => {
        if (l.next === 'open_bot' || l.next === 'wait') router.replace(`/c/${l.bot.agent_id}`);
        else if (l.next === 'blocked') setBlocked(turnedOff(l.bot.branding.display_name));
        setLink(l);
      },
      (e) => setDead(e instanceof ApiError ? e.code : 'invite_not_found'),
    );
  }, [token, router]);

  if (dead) return <DeadLink code={dead} branding={link?.bot.branding} />;
  if (!link) return <Loading />;

  const name = link.bot.branding.display_name;
  const asks = link.access_mode === 'approve_each';

  async function accept() {
    try {
      const r = await acceptLink(token);
      router.push(`/c/${r.bot.agent_id}`);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'invite_expired' || code === 'invite_used_up' || code === 'invite_not_found') setDead(code);
      else if (code === 'share_revoked') setBlocked(turnedOff(name));
      // Section 17.6: show the server's wording; it deliberately doesn't say why.
      else if (code === 'pending_queue_full') setBlocked({ title: (e instanceof Error && e.message) || "This business isn't accepting new customers right now. Try again later." });
      else if (code === 'plan_limit') setBlocked({ title: (e instanceof Error && e.message) || "This business can't add new customers right now." });
      else if (code === 'invite_email_mismatch') setBlocked({ title: 'This invite was sent to a different email. Sign in with that email, or ask for a new invite.' });
      else if (code === 'workspace_required') setError('Your account needs a moment to finish setting up. Reload the page and try again.');
      else if (code === 'rate_limited') setError(retryText(e));
      else setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  async function signedIn() {
    // Signed in now. Show the one-tap step, so if the join below fails its error sits next to a working
    // Continue / Ask for access button instead of a code that's already used.
    setLink((l) => (l ? { ...l, next: 'accept', viewer: { ...l.viewer, signed_in: true } } : l));
    setBusy(true);
    await accept();
  }

  return (
    <CenteredFrame branding={link.bot.branding}>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {blocked ? (
          <>
            <h1 className="text-[22px] leading-snug font-semibold tracking-tight">{blocked.title}</h1>
            {blocked.body && <p className="mt-2 text-[15px] text-muted-foreground">{blocked.body}</p>}
          </>
        ) : link.next === 'accept' ? (
          // Already signed in (R1 next: "accept"): one tap, no code.
          <SignedInAccept
            name={name}
            asks={asks}
            busy={busy}
            error={error}
            onAccept={() => {
              setError(null);
              setBusy(true);
              void accept();
            }}
          />
        ) : (
          <EmailSignIn
            title={asks ? `Sign in to ask ${name} for access` : `Sign in to send a request to ${name}`}
            intro="We'll email you a 6-digit code. No password needed."
            emailNote={`${name} will see your email.`}
            footer={asks ? `${name} approves each new customer.` : undefined}
            onSignedIn={signedIn}
          />
        )}
      </section>
    </CenteredFrame>
  );
}

function SignedInAccept({ name, asks, busy, error, onAccept }: { name: string; asks: boolean; busy: boolean; error: string | null; onAccept: () => void }) {
  const email = useEmail();
  return (
    <div>
      <h1 className="text-[22px] leading-snug font-semibold tracking-tight">{asks ? `Ask ${name} for access` : `Start sending requests to ${name}`}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        {email ? (
          <>
            You&apos;re signed in as <span className="font-medium break-words text-foreground">{email}</span>. {name} will see your email.
          </>
        ) : (
          `${name} will see your email.`
        )}
      </p>
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="button" disabled={busy} onClick={onAccept} className="mt-6 h-12 w-full rounded-xl text-base font-semibold">
        {busy && <Loader2 className="animate-spin" />} {asks ? 'Ask for access' : 'Continue'}
      </Button>
      {asks && <p className="mt-4 text-center text-sm text-muted-foreground">{name} approves each new customer.</p>}
    </div>
  );
}
