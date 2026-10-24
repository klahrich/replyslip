import type { Metadata } from 'next';
import Link from 'next/link';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import { SITE_URL, openGraph } from '@/components/site/seo';
import { ARTICLE_MD } from './article';
import { type Block, inline, parse, plain } from './md';
import './compare.css';

const PATH = '/compare/harnessrouter';
const URL = `${SITE_URL}${PATH}`;
const TITLE = 'HarnessRouter Alternative? How ReplySlip Differs';
const DESCRIPTION =
  'HarnessRouter runs AI agents; ReplySlip coordinates the agents you already run, with schema-checked tasks over MCP. See when to use each, or both.';
const SHARE_TITLE = 'ReplySlip vs HarnessRouter: Two Layers of the Agent Stack';
const SHARE_DESCRIPTION =
  'HarnessRouter runs agents. ReplySlip coordinates the agents you already run, with tasks whose answers must match a JSON Schema.';
const PUBLISHED = '2026-10-24';
const IMAGE = `${SITE_URL}/assets/og.png`;

// robots is left unset on purpose: the page inherits the site-wide setting from app/layout.tsx.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { ...openGraph, type: 'article', title: SHARE_TITLE, description: SHARE_DESCRIPTION, url: PATH },
  twitter: { card: 'summary_large_image', title: SHARE_TITLE, description: SHARE_DESCRIPTION, images: [IMAGE] },
};

const blocks = parse(ARTICLE_MD);
const h1 = blocks.find((b) => b.t === 'h1') as { t: 'h1'; text: string };
const faqStart = blocks.findIndex((b) => b.t === 'h2' && b.text === 'FAQ');
const body = blocks.slice(1, faqStart);

/** One source for the visible FAQ and the FAQPage JSON-LD. */
const FAQ: { q: string; a: string[] }[] = [];
for (const b of blocks.slice(faqStart + 1)) {
  if (b.t === 'h3') FAQ.push({ q: b.text, a: [] });
  else if (b.t === 'p') FAQ[FAQ.length - 1].a.push(b.text);
}

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${URL}#article`,
    headline: h1.text,
    description: DESCRIPTION,
    url: URL,
    mainEntityOfPage: { '@type': 'WebPage', '@id': URL },
    image: IMAGE,
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    inLanguage: 'en',
    author: { '@type': 'Organization', name: 'ReplySlip', url: `${SITE_URL}/` },
    publisher: { '@type': 'Organization', name: 'ReplySlip', url: `${SITE_URL}/` },
    about: [
      { '@type': 'SoftwareApplication', name: 'ReplySlip', url: `${SITE_URL}/`, applicationCategory: 'DeveloperApplication' },
      {
        '@type': 'SoftwareApplication',
        name: 'HarnessRouter',
        url: 'https://github.com/HarnessRouter/harnessrouter',
        applicationCategory: 'DeveloperApplication',
      },
    ],
    keywords:
      'HarnessRouter alternative, HarnessRouter vs ReplySlip, agent-to-agent communication, MCP agent messaging, send tasks between AI agents, structured output between agents, multi-agent coordination, agent relay',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${URL}#faq`,
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: plain(f.q),
      acceptedAnswer: { '@type': 'Answer', text: f.a.map(plain).join('\n\n') },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ReplySlip', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'ReplySlip vs HarnessRouter', item: URL },
    ],
  },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function render(b: Block, k: number) {
  switch (b.t) {
    case 'h2':
      return (
        <h2 key={k} id={slug(b.text)}>
          {inline(b.text)}
        </h2>
      );
    case 'h3':
      return <h3 key={k}>{inline(b.text)}</h3>;
    case 'p':
      return <p key={k}>{inline(b.text)}</p>;
    case 'ul':
    case 'ol': {
      const L = b.t;
      return (
        <L key={k}>
          {b.items.map((it, n) => (
            <li key={n}>{inline(it)}</li>
          ))}
        </L>
      );
    }
    case 'table':
      return (
        <div key={k} className="cmp-table">
          <table>
            <thead>
              <tr>
                {b.head.map((h, n) =>
                  n === 0 ? (
                    <td key={n} />
                  ) : (
                    <th key={n} scope="col">
                      {inline(h)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) =>
                    m === 0 ? (
                      <th key={m} scope="row">
                        {inline(c)}
                      </th>
                    ) : (
                      <td key={m} data-label={b.head[m]}>
                        {inline(c)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export default function CompareHarnessRouterPage() {
  return (
    <div className="cmp">
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
        <article className="cmp-body">
          <h1>{inline(h1.text)}</h1>
          {body.map(render)}
          <section className="cmp-faq" aria-labelledby="faq">
            <h2 id="faq">FAQ</h2>
            {FAQ.map((f) => (
              <div key={f.q} className="cmp-q">
                <h3>{inline(f.q)}</h3>
                {f.a.map((p, n) => (
                  <p key={n}>{inline(p)}</p>
                ))}
              </div>
            ))}
          </section>
        </article>
      </main>
      <SimpleFooter />
    </div>
  );
}
