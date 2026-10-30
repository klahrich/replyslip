import type { Metadata } from 'next';

/** Valetto's production origin. Canonicals and og:url point here, also on previews and on replyslip.com. */
export const VALETTO_URL = 'https://valetto.tech';

/** The Valetto pages as served at the root of valetto.tech (next.config.ts rewrites them to /valetto/...). */
export const VALETTO_PATHS = ['/', '/early-access', '/privacy', '/terms'] as const;

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
