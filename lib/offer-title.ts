import { OFFER_TITLE_MAX } from './constants';
import { FORBIDDEN_NAME_CHARS, looksLikeValetto } from './customer-branding';
import { HttpError } from './errors';

/**
 * The owner's readable offer title. undefined keeps the stored value; null, "", or only spaces
 * clear it. Same character rules as a display name: no control, format (bidi, zero-width,
 * soft hyphen), or line/paragraph separator characters, checked before trimming, and the same
 * Valetto look-alike check.
 */
export function normalizeOfferTitle(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_offer_title', 'title must be text or null.');
  if (FORBIDDEN_NAME_CHARS.test(value)) {
    throw new HttpError(400, 'invalid_offer_title', 'title has characters that are not allowed.');
  }
  const title = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!title) return null;
  if ([...title].length > OFFER_TITLE_MAX) {
    throw new HttpError(400, 'invalid_offer_title', `title must be at most ${OFFER_TITLE_MAX} characters.`);
  }
  if (looksLikeValetto(title)) {
    throw new HttpError(400, 'invalid_offer_title', 'title cannot contain "Valetto".');
  }
  return title;
}

/** "ring-quote" -> "Ring quote": separators become spaces, first letter capitalized. */
export function humanizeOfferName(name: string): string {
  const text = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name;
}

/**
 * A new or renamed offer name must not read as "Valetto" once humanized, because customers see
 * the humanized name when the owner sets no title. Existing names are left alone, so keeping or
 * upserting an offer under its current name never fails here.
 */
export function assertOfferNameNotValetto(name: string): void {
  if (looksLikeValetto(humanizeOfferName(name))) {
    throw new HttpError(400, 'invalid_offer', 'An offer name cannot spell "Valetto": customers see it as the job title.');
  }
}

/** What a customer sees as the job's heading: the owner's title, else the humanized name. Never the description. */
export function offerDisplayTitle(offer: { name: string; title: string | null }): string {
  return offer.title ?? humanizeOfferName(offer.name);
}
