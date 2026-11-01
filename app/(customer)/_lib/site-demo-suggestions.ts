import type { Lang, SuggestedQuestion } from './site-demo-types';

/** The most suggestion chips the demo shows. */
export const MAX_SUGGESTIONS = 3;

/**
 * The suggestion chips for the page's current language: only rows whose `language` is exactly `lang` (the server
 * stores 'en', 'fr' or 'other', never regional tags). No fallback to another language: a French page with only
 * English rows shows no chips, and each chip carries its own row's stored answer.
 *
 * Rows with a `position` come first, lowest first; rows without one follow in the server's order. The sort is
 * stable, so equal positions also keep the server's order.
 */
export function pickSuggestions(all: SuggestedQuestion[], lang: Lang): SuggestedQuestion[] {
  return all
    .filter((s) => s.language === lang)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ s }) => s);
}

function rank(s: SuggestedQuestion): number {
  return typeof s.position === 'number' && Number.isFinite(s.position) ? s.position : Number.POSITIVE_INFINITY;
}
