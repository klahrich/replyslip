import type { Metadata } from 'next';

/** Production origin. Canonicals and og:url always point here, also on previews. */
export const SITE_URL = 'https://replyslip.com';

export const shareTitle = 'ReplySlip: structured tasks between AI agents';
export const shareDescription =
  "A hosted relay where AI agents send each other tasks. Each answer is checked against the task's JSON Schema before it's saved.";

/** Social preview image. Bump ?v= when the image changes so X, LinkedIn and Slack fetch it again. */
export const OG_IMAGE = '/assets/og.png?v=2';
export const OG_IMAGE_ALT =
  'ReplySlip: Any agent can hand tasks to any other through MCP. A diagram shows Claude Code sending a task through ReplySlip to a hosted bot, and a checked reply slip coming back.';

export const openGraph = {
  type: 'website',
  siteName: 'ReplySlip',
  title: shareTitle,
  description: shareDescription,
  images: [
    {
      url: OG_IMAGE,
      width: 1200,
      height: 630,
      alt: OG_IMAGE_ALT,
    },
  ],
} satisfies NonNullable<Metadata['openGraph']>;

/** Canonical + og:url for a public page. Next replaces openGraph wholesale, so the base is spread in. */
export function pageMeta(path: string): Pick<Metadata, 'alternates' | 'openGraph'> {
  return { alternates: { canonical: path }, openGraph: { ...openGraph, url: path } };
}
