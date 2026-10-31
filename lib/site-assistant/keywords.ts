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

// ---------------------------------------------------------------------------------------------------------------
// Server-side language check (spec 6b). Cheap and deterministic: common function words plus letters that only
// some languages use. It only has to tell English and French from "clearly something else"; anything short or
// close is left undecided, and the caller falls back to the business's language.

type DetectLanguage = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'nl';

const STOPWORDS: Record<DetectLanguage, ReadonlySet<string>> = {
  en: new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'was',
    'be', 'do', 'does', 'did', 'have', 'has', 'you', 'your', 'we', 'our', 'i', 'my', 'me', 'it', 'this', 'that',
    'what', 'which', 'how', 'can', 'could', 'would', 'will', 'when', 'where', 'who', 'why', 'any', 'there', 'if',
    'not', 'hi', 'hello', 'thanks', 'please', 'offer', 'about', 'much', 'many', 't', 'll', 're', 've', 'm',
  ]),
  fr: new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'à', 'au', 'aux', 'en', 'dans', 'sur', 'pour',
    'avec', 'par', 'est', 'sont', 'je', 'vous', 'nous', 'votre', 'vos', 'notre', 'mon', 'ma', 'mes', 'ce', 'cette',
    'ces', 'que', 'qui', 'quel', 'quelle', 'quels', 'quelles', 'quoi', 'comment', 'combien', 'où', 'quand',
    'pourquoi', 'est-ce', 'avez', 'faites', 'pouvez', 'offrez', 'êtes', 'pas', 'ne', 'oui', 'non', 'bonjour',
    'merci', 'svp', 'il', 'elle', 'y', 'a', 'c', 'l', 'qu', 'j', 'n', 'ça',
  ]),
  de: new Set([
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'und', 'oder', 'ist', 'sind', 'ich', 'sie',
    'wir', 'ihr', 'ihre', 'haben', 'hat', 'mit', 'für', 'auf', 'von', 'zu', 'nicht', 'was', 'wie', 'wo', 'wann',
    'warum', 'welche', 'können', 'kann', 'bieten', 'auch', 'es', 'im', 'am', 'bei', 'nach', 'hallo', 'danke',
    'bitte', 'gibt', 'mein', 'meine', 'noch',
  ]),
  es: new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'y', 'o', 'de', 'del', 'en', 'con', 'por', 'para', 'es', 'son',
    'está', 'están', 'yo', 'usted', 'ustedes', 'nosotros', 'su', 'sus', 'mi', 'qué', 'que', 'cuál', 'cómo',
    'cuánto', 'cuánta', 'dónde', 'cuándo', 'tienen', 'tiene', 'hacen', 'ofrecen', 'puedo', 'pueden', 'no', 'sí',
    'hola', 'gracias', 'también', 'al', 'lo', 'se', 'me', 'hay',
  ]),
  it: new Set([
    'il', 'lo', 'la', 'gli', 'le', 'un', 'una', 'e', 'o', 'di', 'del', 'della', 'in', 'con', 'per', 'è', 'sono',
    'io', 'voi', 'noi', 'che', 'cosa', 'come', 'quanto', 'dove', 'quando', 'avete', 'fate', 'offrite', 'potete',
    'non', 'ciao', 'grazie', 'anche', 'mi', 'vostro', 'vostra',
  ]),
  pt: new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'ou', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'com', 'por',
    'para', 'é', 'são', 'eu', 'você', 'vocês', 'nós', 'seu', 'sua', 'que', 'qual', 'como', 'quanto', 'onde',
    'quando', 'têm', 'tem', 'fazem', 'oferecem', 'podem', 'não', 'sim', 'olá', 'obrigado', 'obrigada', 'também',
  ]),
  nl: new Set([
    'de', 'het', 'een', 'en', 'of', 'van', 'in', 'op', 'voor', 'met', 'is', 'zijn', 'ik', 'u', 'jullie', 'wij',
    'we', 'uw', 'mijn', 'wat', 'welke', 'hoe', 'waar', 'wanneer', 'waarom', 'hebben', 'heeft', 'kunnen', 'kan',
    'bieden', 'niet', 'ook', 'hallo', 'bedankt', 'dank', 'graag', 'er', 'dit', 'dat',
  ]),
};

/** Letters one language uses and the others here (mostly) don't. Each word with one adds 2 to that language. */
const LETTERS: Partial<Record<DetectLanguage, RegExp>> = {
  fr: /[àâçèêëîïôûùœÿ]/,
  de: /[äöüß]/,
  es: /[ñ¿¡áíóú]/,
  pt: /[ãõ]/,
};

const MIN_WORDS = 3;

/**
 * Server-side language of a visitor message: 'en', 'fr', 'other' when it is confidently another language, or null
 * when the text is too short (under 3 words) or too close to call. Confident means the top language scores at
 * least 2 and at least twice the runner-up. Shared words (de, la, in, a…) count for every language that has them.
 */
export function detectVisitorLanguage(text: string): 'en' | 'fr' | 'other' | null {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  // Hyphens and apostrophes split too, so "faites-vous", "qu'est-ce" and "don't" count piece by piece.
  const words = lower.split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < MIN_WORDS) return null;
  const scores = new Map<DetectLanguage, number>();
  for (const lang of Object.keys(STOPWORDS) as DetectLanguage[]) {
    let score = 0;
    for (const w of words) {
      if (STOPWORDS[lang].has(w)) score += 1;
      const letters = LETTERS[lang];
      if (letters && letters.test(w)) score += 2;
    }
    if (lang === 'es' && /[¿¡]/.test(lower)) score += 2;
    scores.set(lang, score);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = [ranked[0]!, ranked[1]!];
  if (top[1] < 2 || top[1] < second[1] * 2) return null;
  return top[0] === 'en' || top[0] === 'fr' ? top[0] : 'other';
}
