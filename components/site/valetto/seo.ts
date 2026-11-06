import type { Metadata } from 'next';

/** Valetto's production origin. Canonicals and og:url point here, also on previews and on replyslip.com. */
export const VALETTO_URL = 'https://valetto.tech';

/** Valetto's default share text: the root layout's title and description, and the valetto.tech home page. */
export const VALETTO_TITLE = 'Answer every customer. Web, phone, and email.';
export const VALETTO_DESCRIPTION =
  'One smart bot for your shop. It answers on the web, by phone, and by email, so you save up to 7 hours a week and stop losing jobs.';

/** The Valetto pages as served at the root of valetto.tech (next.config.ts rewrites them to /valetto/...; /connect and /connect/meta-muse are served as is). */
export const VALETTO_PATHS = ['/', '/early-access', '/agent-to-agent', '/connect', '/connect/meta-muse', '/privacy', '/terms'] as const;

/**
 * Valetto's social image (public/valetto/og.png, 1200x630): the homepage hero lines on its dark background.
 * No rewrite in next.config.ts matches /valetto/og.png, so it is served as a static file on every host.
 */
export const VALETTO_OG_IMAGE = {
  url: '/valetto/og.png',
  width: 1200,
  height: 630,
  alt: 'Valetto: Answer every customer. On the web. On the phone. In their inbox.',
};

/**
 * Metadata for a Valetto page: self-canonical, og:url and metadataBase on valetto.tech, and Valetto's own
 * share text. Every Valetto page carries the Valetto og image in openGraph and twitter (summary_large_image);
 * Next replaces both objects wholesale, so nothing is inherited from the root layout.
 */
export function valettoMeta(path: (typeof VALETTO_PATHS)[number], title: string, description: string): Metadata {
  return {
    metadataBase: new URL(VALETTO_URL),
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: 'Valetto', title, description, url: path, images: [VALETTO_OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [VALETTO_OG_IMAGE] },
  };
}
