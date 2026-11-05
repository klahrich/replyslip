import type { Metadata } from 'next';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
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

const CONTROL: { h: string; p: string; frag: ReactNode; wide?: boolean }[] = [
  {
    wide: true,
    h: 'Requests come in with the details you need',
    p: 'Each job has a short form you set up, with choices, numbers and an optional notes field. You get what you need the first time, and Valetto asks the customer to fix anything that doesn’t fit.',
    frag: (
      <div className="vt-mini">
        <span className="vt-f">
          <span className="vt-l">Metal</span>
          <span className="vt-v vt-pick">18k yellow gold</span>
        </span>
        <span className="vt-f">
          <span className="vt-l">Ring size</span>
          <span className="vt-v vt-bad">banana</span>
        </span>
        <span className="vt-err">Ring size takes a number from 3 to 13.</span>
      </div>
    ),
  },
  {
    h: 'Customers see only the jobs you allow',
    p: 'Maya’s page shows Render my ring and Check order status. Jobs you leave off stay hidden from her and won’t run.',
    frag: (
      <ul className="vt-grants">
        <li className="on">
          <span>Render my ring</span>
          <i className="vt-tog" aria-label="granted" />
        </li>
        <li className="on">
          <span>Check order status</span>
          <i className="vt-tog" aria-label="granted" />
        </li>
        <li>
          <span>Supplier price list</span>
          <i className="vt-tog" aria-label="not granted" />
        </li>
      </ul>
    ),
  },
  {
    h: 'A daily limit for each customer',
    p: 'You pick how many requests each customer can send in a day. Past that, Valetto turns their requests away until the next day.',
    frag: (
      <div className="vt-cap">
        <div className="vt-cap-row">
          <span>Maya today</span>
          <b>Your cap</b>
        </div>
        <div className="vt-cap-bar" aria-hidden="true">
          <i />
        </div>
      </div>
    ),
  },
  {
    h: 'Cut off access in one click',
    p: 'Click Revoke and Maya’s link stops working. Her next request gets a polite no.',
    frag: (
      <div className="vt-revoke">
        <span>valetto.tech/c/k7Qm…</span>
        <span className="vt-revoke-btn">Revoke</span>
      </div>
    ),
  },
  {
    h: 'All your requests in one place',
    p: 'You can read each request next to the answer your bot sent, without digging through your inbox.',
    frag: (
      <ul className="vt-log">
        <li>
          <span>Maya · Render my ring</span>
          <span className="vt-ok">answered</span>
        </li>
        <li>
          <span>Tom · Check order status</span>
          <span className="vt-ok">answered</span>
        </li>
        <li>
          <span>Maya · Render my ring</span>
          <span className="vt-run">working</span>
        </li>
      </ul>
    ),
  },
  {
    wide: true,
    h: 'Check replies before they go out, or let your bot answer',
    p: 'Pick auto-approve or review first. With review first, you approve each new request before your bot starts on it, and you release each answer before your customer sees it. Valetto emails you when something is waiting, and only you can approve.',
    frag: (
      <div className="vt-review">
        <div className="vt-review-mode">
          <span>Auto-approve</span>
          <span className="on">Review first</span>
        </div>
        <div className="vt-review-row">
          <span>
            <small>New request</small>Maya · Render my ring
          </span>
          <span className="vt-review-btn vt-approve">Approve</span>
        </div>
        <div className="vt-review-row">
          <span>
            <small>Answer ready</small>Tom · Check order status
          </span>
          <span className="vt-review-btn vt-release">Release</span>
        </div>
      </div>
    ),
  },
];

const JOBS = [
  {
    who: 'A jeweller',
    job: 'Render my ring',
    p: 'A client picks the metal, the stone and the size, and sees a render of the ring before you spend time on a call.',
  },
  {
    who: 'A contractor or manufacturer',
    job: 'Get a quote',
    p: 'Customers enter the material, the quantity and a deadline. Your bot prices it from your rate sheet and sends a quote with a total, so you don’t write it by hand.',
  },
  {
    who: 'A consultant',
    job: 'Where’s my project at?',
    p: 'Clients ask for a status update whenever they want. Your bot answers from its project notes, and you write fewer Friday update emails.',
  },
  {
    who: 'An agency',
    job: 'Pull this week’s report',
    p: 'A client pulls this week’s numbers on a Tuesday night without emailing your account manager.',
  },
];

const STEPS: { h: string; p: ReactNode }[] = [
  {
    h: 'Tell your bot what customers can ask for.',
    p: 'Describe each job in plain words, like “ask for the metal and ring size, reply with a price range”, and Valetto turns it into a short form for your customers.',
  },
  {
    h: 'Send customers your link.',
    p: 'Use one link for everyone, or approve each customer by email. Customers open it on any phone with nothing to install, and the page shows your logo and colors.',
  },
  {
    h: 'Your bot answers, and you see each request.',
    p: 'Your bot starts on a request as soon as it comes in. If the answer takes a few minutes, the page shows your bot at work and Valetto emails the customer when it’s ready.',
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
              <a href="#control">Control</a>
            </li>
            <li>
              <a href="#jobs">Jobs</a>
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
            <div className="vt-badges">
              <p className="vt-badge">
                <span className="vt-badge-dot" aria-hidden="true" />
                Works with Grok Bot
              </p>
              <Link className="vt-badge vt-badge-link" href={AGENT_TO_AGENT}>
                Valetto for agents
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <h1 id="h1">
              <span className="l">
                <Words text="Answer every customer." />
              </span>{' '}
              <span className="l vt-dim vt-h1-2">
                <Words text="Even when you’re on a job." from={3} />
              </span>
            </h1>
            <p className="vt-sub">A smart bot for your business. It answers from your website and content, and passes anything it can’t answer to you.</p>
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
          <p className="vt-key-a">
            <Words text="Your customers get answers without waiting for you." />
          </p>
          <p className="vt-key-b">
            <Words text="You get their requests with the details filled in." from={8} />
          </p>
          <p className="vt-key-c">
            <Words text="You can check anything you want before it goes out." from={17} />
          </p>
        </section>

        <section className="vt-sec" id="control" aria-labelledby="control-h">
          <p className="vt-kicker">You stay in charge</p>
          <h2 id="control-h">You decide what your bot does for customers</h2>
          <p className="vt-lede">Let in anyone with the link, or only the customers you approve.</p>
          <div className="vt-control">
            {CONTROL.map((c) => (
              <article className={c.wide ? 'vt-cell wide-cell' : 'vt-cell'} key={c.h}>
                <div className="frag" data-ui aria-hidden="true">
                  {c.frag}
                </div>
                <div>
                  <h3>{c.h}</h3>
                  <p>{c.p}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="vt-sec" id="jobs" aria-labelledby="jobs-h">
          <h2 id="jobs-h">Jobs your bot can do for you</h2>
          <p className="vt-lede">Each job is one button on your customer’s page.</p>
          <ul className="vt-jobgrid">
            {JOBS.map((j) => (
              <li className="vt-jobcard" key={j.job}>
                <span className="vt-who">{j.who}</span>
                <span className="vt-job vt-job-big">{j.job}</span>
                <p>{j.p}</p>
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
          <p className="say">Start with the request you answer most.</p>
          <p className="vt-close-sub">Valetto is in early access and runs on Grok&nbsp;Bot. No bot yet? You can still ask.</p>
          <Link className="btn vt-btn" href={EARLY_ACCESS}>
            Ask for early access
          </Link>
          <p className="vt-soon">
            <span>Coming soon</span> Telegram, WhatsApp and SMS. For now, customers use the chat page.
          </p>
        </section>
      </main>

      <ValettoFoot />
      <ValettoEffects />
    </div>
  );
}
