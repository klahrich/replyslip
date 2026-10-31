import { normalizeForKeywords } from './normalize';

/**
 * Owner-only topics (spec 2.3, 4.3). Data only: every word has a unit test. Matched as whole words or phrases on
 * accent-stripped, case-folded text. False positives are fine: they only send the question to the owner.
 */
export const SITE_KEYWORDS = {
  price: {
    en: [
      'price', 'prices', 'pricing', 'cost', 'costs', 'costing', 'quote', 'quotes', 'quotation', 'estimate',
      'estimates', 'how much', 'rate', 'rates', 'fee', 'fees', 'charge', 'charges', 'deposit', 'discount', 'cheap',
      'cheaper', 'expensive', 'budget', 'invoice', 'payment', 'pay',
    ],
    fr: [
      'prix', 'cout', 'couts', 'couter', 'coute', 'combien pour', 'combien demandez', 'combien chargez',
      'combien facturez', 'combien est-ce', 'soumission', 'soumissions', 'devis', 'estime',
      'estimation', 'tarif', 'tarifs', 'frais', 'taux', 'depot', 'rabais', 'facture', 'paiement', 'payer',
    ],
  },
  availability_booking: {
    en: [
      'available', 'availability', 'open slot', 'open slots', 'opening', 'openings', 'book', 'booking', 'booked',
      'appointment', 'appointments', 'schedule', 'reschedule', 'reserve', 'reservation', 'slot', 'slots',
      'when can you', 'how soon', 'earliest', 'wait time', 'lead time',
    ],
    fr: [
      'disponible', 'disponibles', 'disponibilite', 'disponibilites', 'plage horaire', 'reserver', 'reservation',
      'rendez-vous', 'rdv', 'prendre rendez-vous', 'delai', 'delais', 'quand pouvez-vous', 'le plus tot',
    ],
  },
  complaint: {
    en: [
      'refund', 'refunds', 'complaint', 'complain', 'complaining', 'unhappy', 'disappointed', 'damaged', 'broken',
      'warranty claim', 'cancel', 'cancellation', 'lawyer', 'chargeback',
    ],
    fr: [
      'remboursement', 'rembourser', 'plainte', 'plaindre', 'insatisfait', 'decu', 'endommage', 'brise',
      'reclamation de garantie', 'reclamation sous garantie',
      'annuler', 'annulation', 'avocat',
    ],
  },
} as const;

export type KeywordCategory = keyof typeof SITE_KEYWORDS;

/** `$`, `€`, and amounts like `40 dollars`, `40$`, `40 cad`. */
const CURRENCY_PATTERNS: RegExp[] = [/\$/, /€/, /\d+\s*(\$|dollars?\b|cad\b|usd\b)/];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED: { category: KeywordCategory; word: string; re: RegExp }[] = (
  Object.entries(SITE_KEYWORDS) as [KeywordCategory, { en: readonly string[]; fr: readonly string[] }][]
).flatMap(([category, lists]) =>
  [...lists.en, ...lists.fr].map((word) => ({
    category,
    word,
    // Whole word or phrase: no letter or digit right before or after. Hyphens and spaces inside a phrase match
    // either a hyphen or a space ("rendez vous" matches "rendez-vous").
    re: new RegExp(`(^|[^a-z0-9])${escapeRegex(word).replace(/[- ]/g, '[- ]')}(?=$|[^a-z0-9])`),
  })),
);

export type KeywordHit = { category: KeywordCategory | 'currency'; word: string };

/** First owner-only keyword in the text, or null. */
export function findOwnerKeyword(text: string): KeywordHit | null {
  const normalized = normalizeForKeywords(text);
  for (const entry of COMPILED) {
    if (entry.re.test(normalized)) return { category: entry.category, word: entry.word };
  }
  for (const re of CURRENCY_PATTERNS) {
    const m = re.exec(normalized);
    if (m) return { category: 'currency', word: m[0] };
  }
  return null;
}

const FRENCH_HINTS = new Set([
  'je', 'vous', 'nous', 'est', 'les', 'des', 'une', 'pour', 'avec', 'quel', 'quelle', 'quels', 'quelles', 'est-ce',
  'que', 'qui', 'pouvez', 'avez', 'faites', 'votre', 'vos', 'dans', 'sur', 'combien', 'merci', 'bonjour', 'du',
  'au', 'aux', 'ou', 'oui', 'non', 'mon', 'ma', 'mes', 'le', 'la', 'et', 'pas', 'offrez',
]);
const ENGLISH_HINTS = new Set([
  'the', 'you', 'your', 'do', 'does', 'is', 'are', 'what', 'which', 'how', 'can', 'for', 'with', 'and', 'i', 'my',
  'we', 'of', 'to', 'in', 'on', 'have', 'offer', 'hi', 'hello', 'thanks', 'where', 'when', 'who',
]);

/**
 * Rough language guess for the fixed replies when the model wasn't called (keyword pre-check, caps, errors).
 * French accents or more French function words than English ones means fr; otherwise en.
 */
export function guessLanguage(text: string): 'en' | 'fr' {
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr';
  const words = text.toLowerCase().split(/[^a-zà-ÿ'-]+/).filter(Boolean);
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FRENCH_HINTS.has(w)) fr++;
    if (ENGLISH_HINTS.has(w)) en++;
  }
  return fr > en ? 'fr' : 'en';
}

/** Language of a whole page: function-word counts only (one "café" shouldn't make an English page French). */
export function guessPageLanguage(text: string): 'en' | 'fr' {
  const words = text.toLowerCase().split(/[^a-zà-ÿ'-]+/).filter(Boolean);
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FRENCH_HINTS.has(w)) fr++;
    if (ENGLISH_HINTS.has(w)) en++;
  }
  return fr > en ? 'fr' : 'en';
}
