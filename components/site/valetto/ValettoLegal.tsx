import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { type Block, inline, parse } from '@/app/(site)/compare/harnessrouter/md';
import { EARLY_ACCESS, ValettoFoot, ValettoTop } from './ValettoChrome';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Inline Markdown, with every "[TBD: …]" turned into a highlighted placeholder that still needs a real answer. */
function text(s: string): ReactNode {
  return s.split(/(\[TBD:[^\]]*\])/g).map((part, k) =>
    part.startsWith('[TBD:') ? (
      <mark key={k} className="vt-tbd">
        {part}
      </mark>
    ) : (
      <Fragment key={k}>{inline(part)}</Fragment>
    ),
  );
}

function render(b: Block, k: number) {
  switch (b.t) {
    case 'h2':
      return (
        <h2 key={k} id={slug(b.text)}>
          {text(b.text)}
        </h2>
      );
    case 'h3':
      return <h3 key={k}>{text(b.text)}</h3>;
    case 'p':
      return <p key={k}>{text(b.text)}</p>;
    case 'ul':
    case 'ol': {
      const L = b.t;
      return (
        <L key={k}>
          {b.items.map((it, n) => (
            <li key={n}>{text(it)}</li>
          ))}
        </L>
      );
    }
    default:
      return null;
  }
}

/** /valetto/privacy and /valetto/terms: draft Markdown copy in the Valetto chrome, with a review banner. */
export function ValettoLegal({ md }: { md: string }) {
  const [h1, updated, ...body] = parse(md) as [{ t: 'h1'; text: string }, { t: 'p'; text: string }, ...Block[]];
  return (
    <div className="lp vt vt-sub-page">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <ValettoTop>
        <ul>
          <li>
            <Link className="go" href={EARLY_ACCESS}>
              Early access
            </Link>
          </li>
        </ul>
      </ValettoTop>
      <main id="main" className="vt-doc">
        <p className="vt-draft" role="note">
          <b>Draft, pending review.</b> Highlighted items still need a real answer.
        </p>
        <article>
          <h1>{h1.text}</h1>
          <p className="vt-doc-updated">{text(updated.text)}</p>
          {body.map(render)}
        </article>
      </main>
      <ValettoFoot />
    </div>
  );
}
