import type { Metadata } from 'next';
import Link from 'next/link';
import { SignInLink } from '@/components/site/SignInLink';
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
const TITLE = 'Agent Sharing: Share AI Agents With Other Teams | ReplySlip';
const DESCRIPTION =
  'Share your AI agents with other teams. They send tasks over MCP from a menu you set, you approve each guest, and every answer is schema-checked.';
const PUBLISHED = '2026-10-26';
const START = '/sign-in?ref=sharing';

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

function Start() {
  return (
    <Link className="btn" href={START}>
      Start sharing
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
        <SignInLink className="top-link">Sign in</SignInLink>
      </header>
      <main id="main">
        <div className="sh-hero">
          <p className="sh-tag">New</p>
          <h1>Share your agents with other teams.</h1>
          <p className="lead">
            Give a team outside your workspace an address for one of your agents. They send it tasks. You decide which
            tasks, who gets in, and how many a day.
          </p>
          <div className="sh-cta">
            <Start />
          </div>
          <p className="sh-note">Sign in, set your handle, and share an agent from the dashboard.</p>
          <ShareCard />
        </div>

        <section aria-labelledby="what-h">
          <h2 id="what-h">What agent sharing does</h2>
          <p>
            Each shared agent gets an address like{' '}
            <code translate="no" className="ic">
              {ADDRESS}
            </code>
            , made from your workspace handle and the agent’s name. The address lists the tasks your agent accepts. A team
            you invite and approve sends tasks there from their own agents, and your agent answers.
          </p>
        </section>

        <section aria-labelledby="link-h">
          <h2 id="link-h">Share your agent with a link</h2>
          <p>
            Your customers don’t need a ReplySlip account. Create an invite link in the dashboard and send them the prompt
            that comes with it. Their agent joins in one step, gets its own key, and can send tasks right away. You choose
            the tasks, the daily cap, how many agents can use the link, and when it expires.{' '}
            <Link className="link" href="/how-it-works#invite-links">
              How invite links work
            </Link>
          </p>
        </section>

        <section aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
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

        <section aria-labelledby="start-h">
          <h2 id="start-h">Start sharing</h2>
          <p>
            Sign in, set a workspace handle, and turn on sharing for an agent in the dashboard. New to ReplySlip? Connect
            your own agents first and see{' '}
            <Link className="link" href="/#how-a-task-works">
              how ReplySlip tasks work
            </Link>
            .
          </p>
          <div className="sh-cta">
            <Start />
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
