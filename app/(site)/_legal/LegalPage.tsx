import type { Metadata } from 'next';
import { SignInLink } from '@/components/site/SignInLink';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import { OG_IMAGE, OG_IMAGE_ALT, openGraph } from '@/components/site/seo';
import { type Block, inline, parse } from '../compare/harnessrouter/md';
import '../compare/harnessrouter/compare.css';
import './legal.css';

/** Title, description, canonical and share tags for a legal page, so it never shows the homepage defaults. */
export function legalMeta(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...openGraph, title: `${title} · ReplySlip`, description, url: path },
    twitter: { card: 'summary_large_image', title: `${title} · ReplySlip`, description, images: [{ url: OG_IMAGE, alt: OG_IMAGE_ALT }] },
  };
}

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
    default:
      return null;
  }
}

/** /privacy and /terms: the Markdown copy on the /compare article styles, with the date line under the title. */
export function LegalPage({ md }: { md: string }) {
  const [h1, updated, ...body] = parse(md) as [{ t: 'h1'; text: string }, { t: 'p'; text: string }, ...Block[]];
  return (
    <div className="cmp legal">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
        <SignInLink className="top-link">Sign in</SignInLink>
      </header>
      <main id="main">
        <article className="cmp-body">
          <h1>{h1.text}</h1>
          <p className="legal-updated">{updated.text}</p>
          {body.map(render)}
        </article>
      </main>
      <SimpleFooter />
    </div>
  );
}
