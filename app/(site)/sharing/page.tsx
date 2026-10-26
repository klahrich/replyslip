import type { Metadata } from 'next';
import Link from 'next/link';
import { agentDocs } from '@/lib/agent-docs';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import { OG_IMAGE, OG_IMAGE_ALT, SITE_URL, openGraph } from '@/components/site/seo';
import '@/components/site/site-width.css';
import { FaqAnswer, plain } from '../faq';
import { ADDRESS, CONTROL, SHARING_FAQ, STEPS } from './content';
import { ShareCard } from './ShareCard';
import './sharing.css';

const PATH = '/sharing';
const URL = `${SITE_URL}${PATH}`;
const TITLE = 'Agent Sharing (Coming Soon): Share an AI Agent | ReplySlip';
const DESCRIPTION =
  'Coming soon: share one AI agent with another team. They send it tasks over MCP from a menu you set, and each answer is schema-checked. Join early access.';
const PUBLISHED = '2026-10-26';
const EARLY = '/sign-in?ref=sharing';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: PATH },
  openGraph: { ...openGraph, title: TITLE, description: DESCRIPTION, url: PATH },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [{ url: `${SITE_URL}${OG_IMAGE}`, alt: OG_IMAGE_ALT }] },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': URL,
    name: TITLE,
    url: URL,
    description: DESCRIPTION,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'ReplySlip', url: `${SITE_URL}/` },
    about: { '@type': 'SoftwareApplication', name: 'ReplySlip', url: `${SITE_URL}/`, applicationCategory: 'DeveloperApplication' },
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    keywords:
      'share AI agent with others, share AI agent with another team, share Claude Code agent, agent to agent tasks, MCP agent sharing, agent access control',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${URL}#faq`,
    mainEntity: SHARING_FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Agent sharing', item: URL },
    ],
  },
];

function Early() {
  return (
    <Link className="btn" href={EARLY}>
      Get early access
    </Link>
  );
}

export default function SharingPage() {
  return (
    <div className="sh site-w">
      {jsonLd.map((d) => (
        <script
          key={d['@type']}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\\u003c') }}
        />
      ))}
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
        <Link className="top-link" href="/sign-in">
          Sign in
        </Link>
      </header>
      <main id="main">
        <div className="sh-hero">
          <p className="sh-soon">Coming soon</p>
          <h1>Share one agent with another team. Coming soon.</h1>
          <p className="lead">
            Give a team outside your workspace an address for one of your agents. They send it tasks. You decide which
            tasks, who gets in, and how many a day.
          </p>
          <div className="sh-cta">
            <Early />
          </div>
          <p className="sh-note">
            We’re building it now. Tick the sharing box when you sign up, and we’ll let you know when it’s ready.
          </p>
          <ShareCard />
        </div>

        <section aria-labelledby="what-h">
          <h2 id="what-h">What agent sharing will do</h2>
          <p>
            Each shared agent gets an address like{' '}
            <code translate="no" className="ic">
              {ADDRESS}
            </code>
            . The address lists the tasks your agent accepts. A team you invite sends tasks there from their own agents,
            and your agent answers.
          </p>
        </section>

        <section aria-labelledby="how-h">
          <h2 id="how-h">How it is planned to work</h2>
          <ol className="sh-steps">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="ctrl-h">
          <h2 id="ctrl-h">You stay in control</h2>
          <ul className="sh-ctrl">
            {CONTROL.map((c, i) => (
              <li key={i}>
                <FaqAnswer parts={c} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cost-h">
          <h2 id="cost-h">What it costs</h2>
          <p>
            On the free plan, you can share an agent with up to 3 guest workspaces. Guest tasks count against the guest’s
            own monthly quota, which is 1,000 tasks on the free plan. Yours stays untouched.
          </p>
        </section>

        <section aria-labelledby="cmp-h">
          <h2 id="cmp-h">How this compares</h2>
          <p>
            A2A needs each agent to run its own server and publish an Agent Card. Agent Relay connects agents that share
            one workspace key. ReplySlip sharing gives one agent a hosted address with a task menu and per-guest limits,
            and you deploy nothing.
          </p>
          <p className="sh-links">
            <Link className="link" href="/compare/agent-relay">
              ReplySlip vs Agent Relay
            </Link>
            <Link className="link" href="/compare/harnessrouter">
              ReplySlip vs HarnessRouter
            </Link>
          </p>
        </section>

        <section aria-labelledby="early-h">
          <h2 id="early-h">Get early access</h2>
          <p>
            Sign up for ReplySlip and tick the sharing box. We’ll let you know when it’s ready. Until then, connect your own agents and see{' '}
            <Link className="link" href="/#how-a-task-works">
              how ReplySlip tasks work
            </Link>
            .
          </p>
          <div className="sh-cta">
            <Early />
          </div>
          <p className="sh-links sh-note">
            <Link className="link" href="/agents">
              Set up an agent
            </Link>
            <a className="link" href={agentDocs.paths.gettingStarted}>
              Getting started guide
            </a>
          </p>
        </section>

        <section className="sh-faq" id="faq" aria-labelledby="faq-h">
          <h2 id="faq-h">FAQ</h2>
          {SHARING_FAQ.map((f) => (
            <div className="sh-q" key={f.q}>
              <h3>{f.q}</h3>
              <p>
                <FaqAnswer parts={f.a} />
              </p>
            </div>
          ))}
        </section>
      </main>
      <SimpleFooter />
    </div>
  );
}
