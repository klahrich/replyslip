import type { Metadata } from 'next';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { MarkIcon } from '@/components/site/Mark';
import { PhoneChat } from '@/components/site/valetto/PhoneChat';
import { ValettoEffects } from '@/components/site/valetto/ValettoEffects';
import '@/components/site/landing.css';
import '../landing-width.css';
import '../landing-bg.css';
import '../landing-stripes.css';
import '@/components/site/valetto/valetto.css';
import { GlowBg } from '../GlowBg';

// Preview of the Valetto pivot. Kept out of search until the brand moves to valetto.ai.
export const metadata: Metadata = {
  title: { absolute: 'Valetto: share your bot with customers, one job at a time' },
  description:
    'Give each customer a private link to the jobs your Grok Bot does for them. Daily caps, one-click revoke, and a record of every request.',
  robots: { index: false, follow: false },
};

const EARLY = 'mailto:karim@replyslip.com?subject=Valetto%20early%20access';

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
    h: 'Customers fill in the fields you set',
    p: 'Each job has a short form you design: picklists, numbers and an optional notes field. Your bot gets clean answers to known questions instead of whatever a stranger types, and Valetto sends back input that doesn’t fit.',
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
    h: 'They get the jobs you granted',
    p: 'Maya’s page shows Render my ring and Check order status. Jobs you didn’t grant her stay off her page and won’t run.',
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
    h: 'A daily cap for each customer',
    p: 'You pick how many requests each customer can send in a day. Past it, Valetto turns their requests away until tomorrow.',
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
    h: 'Revoke in one click',
    p: 'Click revoke and the link stops working. Maya’s next request gets a polite no.',
    frag: (
      <div className="vt-revoke">
        <span>valetto.ai/c/k7Qm…</span>
        <span className="vt-revoke-btn">Revoke</span>
      </div>
    ),
  },
  {
    h: 'Every request leaves a record',
    p: 'You can read each request next to the answer your bot sent back.',
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
];

const JOBS = [
  {
    who: 'A jeweller',
    job: 'Render my ring',
    p: 'A client picks the metal, the stone and the size, and gets a product render back. The rest of your shop stays off their page.',
  },
  {
    who: 'A contractor or manufacturer',
    job: 'Get a quote',
    p: 'Customers enter the material, the quantity and a deadline. Your bot prices it from your rate sheet and sends a quote with a total. Quotes are all this bot does for them.',
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
    h: 'Pick the jobs your bot will do for customers.',
    p: 'Give each job a name, the fields a customer fills in, like a metal picklist or a ring size, and the answer you want back.',
  },
  {
    h: 'Share one open link, or approve each customer by email.',
    p: (
      <>
        Each link has a long random code in it, and customers open it on any phone with nothing to install. The page
        carries your logo and your colors, so customers see your business.{' '}
        <code className="vt-link">valetto.ai/c/k7Qm2xR9vTb4…</code>
      </>
    ),
  },
  {
    h: 'They ask, your bot answers, you see every request.',
    p: 'Valetto wakes your bot when a request comes in. Answers take a few minutes, so the page shows your bot at work and emails the customer when the answer is ready.',
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
              <a className="go" href={EARLY}>
                Early access
              </a>
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
                <Words text="Share your bot with customers." />
              </span>{' '}
              <span className="l vt-dim">
                <Words text="Only the jobs you choose." from={5} />
              </span>
            </h1>
            <p className="vt-sub">
              Your bot knows your files, inbox, prices and calendar. Valetto lets your customers use it for the jobs you
              pick, through a private link.
            </p>
            <p className="vt-eg">Customers open the link on their phone. Nothing to install.</p>
            <div className="vt-cta">
              <a className="btn vt-btn" href={EARLY}>
                Ask for early access
              </a>
              <a className="link vt-cta-2" href="#how">
                How it works
              </a>
            </div>
          </div>
          <div className="vt-hero-stage">
            <PhoneChat />
          </div>
        </section>

        <section className="vt-key" aria-label="The valet key" data-play>
          <p className="vt-key-a">
            <Words text="A valet key lets the valet drive." />
          </p>
          <p className="vt-key-b">
            <Words text="It won’t open the trunk." from={7} />
          </p>
          <p className="vt-key-c">
            <Words text="Valetto gives your customers that key to your bot." from={12} />
          </p>
        </section>

        <section className="vt-sec" id="control" aria-labelledby="control-h">
          <p className="vt-kicker">Controlled access</p>
          <h2 id="control-h">You set the limits for each customer</h2>
          <p className="vt-lede">You decide who gets in: anyone with the link, or only customers you approve.</p>
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
          <p className="vt-limit">
            <b>One limit to know.</b> Valetto keeps access controlled, and a notes field still reaches your bot as free
            text. Valetto decides which jobs a customer can ask for, what they fill in and how often. Your bot’s
            instructions for each job decide what it says back.
          </p>
        </section>

        <section className="vt-sec" id="jobs" aria-labelledby="jobs-h">
          <h2 id="jobs-h">Jobs you can hand out</h2>
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
          <p className="say">Start with one customer and one job.</p>
          <p className="vt-close-sub">Valetto is in early access for Grok Bot owners.</p>
          <a className="btn vt-btn" href={EARLY}>
            Ask for early access
          </a>
          <p className="vt-soon">
            <span>Coming soon</span> Telegram, WhatsApp and SMS. For now, customers use the chat page.
          </p>
        </section>
      </main>

      <footer className="foot vt-foot">
        <p>
          Valetto is built by{' '}
          <a className="link" href="https://clairevue.ai">
            ClaireVue
          </a>
          , Montréal
        </p>
        <p className="foot-legal">
          <Link className="link" href="/privacy">
            Privacy
          </Link>
          <Link className="link" href="/terms">
            Terms
          </Link>
        </p>
        <p className="yr">© 2026 ClaireVue</p>
      </footer>
      <ValettoEffects />
    </div>
  );
}
