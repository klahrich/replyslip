import type { Metadata } from 'next';

/** Valetto's production origin. Canonicals and og:url point here, also on previews and on replyslip.com. */
export const VALETTO_URL = 'https://valetto.tech';

/** Valetto's default share text: the root layout's title and description, and the valetto.tech home page. */
export const VALETTO_TITLE = 'Valetto: a smart bot for your business';
export const VALETTO_DESCRIPTION =
  'Answer customers faster and spend less time on admin. Your bot answers customer requests on a page with your logo, and you can approve replies before they go out.';

/** The Valetto pages as served at the root of valetto.tech (next.config.ts rewrites them to /valetto/...; /connect and /connect/meta-muse are served as is). */
export const VALETTO_PATHS = ['/', '/early-access', '/agent-to-agent', '/connect', '/connect/meta-muse', '/privacy', '/terms'] as const;

/**
 * Metadata for a Valetto page: self-canonical, og:url and metadataBase on valetto.tech, and Valetto's own
 * share text. There is no Valetto og image yet, so openGraph and twitter carry no image instead of
 * inheriting the ReplySlip one from the root layout (Next replaces both objects wholesale).
 */
export function valettoMeta(path: (typeof VALETTO_PATHS)[number], title: string, description: string): Metadata {
  return {
    metadataBase: new URL(VALETTO_URL),
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: 'Valetto', title, description, url: path },
    twitter: { card: 'summary', title, description },
  };
}
