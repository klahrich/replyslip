import type { Metadata } from 'next';
import { Fragment, type CSSProperties } from 'react';
import Link from 'next/link';
import { MarkIcon } from '@/components/site/Mark';
import { SignInLink } from '@/components/site/SignInLink';
import { PhoneChat } from '@/components/site/valetto/PhoneChat';
import { ValettoEffects } from '@/components/site/valetto/ValettoEffects';
import { AGENT_TO_AGENT, EARLY_ACCESS, ValettoFoot } from '@/components/site/valetto/ValettoChrome';
import '@/components/site/landing.css';
import '../landing-width.css';
import '../landing-bg.css';
import '../landing-stripes.css';
import '@/components/site/valetto/valetto.css';
import { GlowBg } from '../GlowBg';
import { VALETTO_DESCRIPTION, VALETTO_TITLE, valettoMeta } from '@/components/site/valetto/seo';

// Served at valetto.tech/ (rewritten from /valetto in next.config.ts).
export const metadata: Metadata = valettoMeta('/', VALETTO_TITLE, VALETTO_DESCRIPTION);

/** Splits a line into words that snap in one after another (the n-th word gets --i: from + n). */
function Words({ text, from = 0 }: { text: string; from?: number }) {
  return text.split(' ').map((word, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="w" style={{ '--i': from + i } as CSSProperties}>
        {word}
      </span>
    </Fragment>
  ));
}

const OUTCOMES: { h: string; p: string }[] = [
  {
    h: 'Save up to 7 hours a week',
    p: 'The replies you type by hand, handled.',
  },
  {
    h: 'Protect your reputation',
    p: 'Reviews and messages get an answer.',
  },
  {
    h: 'Stop losing jobs',
    p: 'Slow replies send the work next door.',
  },
];

const CHANNELS: { k: string; h: string; p: string; them: string; bot: string }[] = [
  {
    k: 'Website',
    h: 'On your site, and off it.',
    p: 'A question on your page. A review on Google. Both get a reply.',
    them: 'Can you fit a new tap this week?',
    bot: 'Thursday morning is open.',
  },
  {
    k: 'Phone',
    h: 'Picks up when you’re on a job.',
    p: 'You’re with a customer. The next person who calls still gets an answer.',
    them: 'The kitchen sink is leaking.',
    bot: 'We can be there today, 2 to 4.',
  },
  {
    k: 'Email',
    h: 'Replies from what your business already knows.',
    p: 'Hours, prices, what’s in the shop. It answers like you would.',
    them: 'Is the oak table still in?',
    bot: 'Yes. Saturday delivery is open.',
  },
];

const STEPS: { h: string; p: string }[] = [
  {
    h: 'Bring your shop in.',
    p: 'Hours, services, prices, and how you like to talk. It learns the business.',
  },
  {
    h: 'Connect your phone, site, and email.',
    p: 'One bot on all three. Nothing for your customers to install.',
  },
  {
    h: 'It answers while you work.',
    p: 'It picks up when you can’t. You see what it said, and you step in when you want.',
  },
];

export default function ValettoPage() {
  return (
    <div className="lp vt">
      <GlowBg />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <a className="mark" href="#top" aria-label="Valetto, back to top">
          <MarkIcon />
          Valetto
        </a>
        <nav aria-label="Main">
          <ul>
            <li>
              <a href="#channels">Channels</a>
            </li>
            <li>
              <a href="#how">How it works</a>
            </li>
            <li>
              <Link href={AGENT_TO_AGENT}>Valetto for agents</Link>
            </li>
            <li className="vt-nav-in">
              <SignInLink>Sign in</SignInLink>
            </li>
            <li>
              <Link className="go" href={EARLY_ACCESS}>
                Early access
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <main id="main">
        <section className="vt-hero" id="top" aria-labelledby="h1">
          <div className="vt-hero-copy">
            <p className="vt-badge">
              <span className="vt-badge-dot" aria-hidden="true" />
              Works with Grok Bot
            </p>
            <h1 id="h1">
              <span className="l">
                <Words text="Answer every customer." />
              </span>{' '}
              <span className="l vt-dim vt-h1-2">
                <Words text="On the web. On the phone. In their inbox." from={3} />
              </span>
            </h1>
            <p className="vt-sub">
              One smart bot for your shop. It picks up when you can’t — so you save up to 7 hours a week, protect your reputation, and stop losing jobs to whoever answers first.
            </p>
            <div className="vt-cta">
              <Link className="btn vt-btn" href={EARLY_ACCESS}>
                Ask for early access
              </Link>
              <a className="link vt-cta-2" href="#how">
                How it works
              </a>
            </div>
          </div>
          <div className="vt-hero-stage">
            <PhoneChat />
          </div>
        </section>

        <section className="vt-key" aria-label="What you get" data-play>
          <ol className="vt-outcomes">
            {OUTCOMES.map((o) => (
              <li key={o.h}>
                <h2>
                  <Words text={o.h} />
                </h2>
                <p>{o.p}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="vt-sec" id="channels" aria-labelledby="channels-h">
          <p className="vt-kicker">Website, phone, email</p>
          <h2 id="channels-h">One bot, wherever they reach you</h2>
          <p className="vt-lede">Same answers, wherever the customer wrote.</p>
          <ul className="vt-channels">
            {CHANNELS.map((c) => (
              <li className="vt-channel" key={c.k}>
                <span className="vt-ch-k">{c.k}</span>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
                <p className="vt-moment">
                  <span className="them">{c.them}</span>
                  <span className="bot">{c.bot}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="vt-sec" id="how" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="vt-steps">
            {STEPS.map((s, n) => (
              <li key={n} data-play>
                <span className="vt-num" aria-hidden="true">
                  {n + 1}
                </span>
                <div>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="close vt-close" aria-label="Get early access">
          <p className="say">Be the shop that answers first.</p>
          <p className="vt-close-sub">Valetto is in early access and runs on Grok&nbsp;Bot. No bot yet? You can still ask.</p>
          <Link className="btn vt-btn" href={EARLY_ACCESS}>
            Ask for early access
          </Link>
        </section>
      </main>

      <ValettoFoot />
      <ValettoEffects />
    </div>
  );
}
