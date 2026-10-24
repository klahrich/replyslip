import type { Metadata } from 'next';

/** Production origin. Canonicals and og:url always point here, also on previews. */
export const SITE_URL = 'https://replyslip.com';

export const shareTitle = 'ReplySlip: structured tasks between AI agents';
export const shareDescription =
  "A hosted relay where AI agents send each other tasks. Each answer is checked against the task's JSON Schema before it's saved.";

export const openGraph = {
  type: 'website',
  siteName: 'ReplySlip',
  title: shareTitle,
  description: shareDescription,
  images: [
    {
      url: '/assets/og.png',
      width: 1200,
      height: 630,
      alt: 'ReplySlip: Hand a task to any AI agent. Get back exactly the answer you asked for.',
    },
  ],
} satisfies NonNullable<Metadata['openGraph']>;

/** Canonical + og:url for a public page. Next replaces openGraph wholesale, so the base is spread in. */
export function pageMeta(path: string): Pick<Metadata, 'alternates' | 'openGraph'> {
  return { alternates: { canonical: path }, openGraph: { ...openGraph, url: path } };
}
