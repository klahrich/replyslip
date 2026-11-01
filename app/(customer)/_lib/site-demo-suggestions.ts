import type { Lang, SuggestedQuestion } from './site-demo-types';

/** The most suggestion chips the demo shows. */
export const MAX_SUGGESTIONS = 3;

/**
 * The suggestion chips for the page's current language: only rows whose `language` is exactly `lang` (the server
 * stores 'en', 'fr' or 'other', never regional tags), in the server's order. No fallback to another language: a
 * French page with only English rows shows no chips, and each chip carries its own row's stored answer.
 */
export function pickSuggestions(all: SuggestedQuestion[], lang: Lang): SuggestedQuestion[] {
  return all.filter((s) => s.language === lang).slice(0, MAX_SUGGESTIONS);
}
