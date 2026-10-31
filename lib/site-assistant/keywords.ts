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
// Server-side language check (spec 6b). Cheap and deterministic. It only has to tell English and French from
// "something else": common function words decide English and French (accented letters alone never make French),
// while non-Latin script, letters French doesn't use, and other languages' function words point to "other".
// Anything short or close is left undecided (null).

type OtherLanguage = 'de' | 'es' | 'it' | 'pt' | 'nl' | 'pl' | 'tl';

const EN_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'was',
  'be', 'do', 'does', 'did', 'have', 'has', 'you', 'your', 'we', 'our', 'i', 'my', 'me', 'it', 'this', 'that',
  'what', 'which', 'how', 'can', 'could', 'would', 'will', 'when', 'where', 'who', 'why', 'any', 'there', 'if',
  'not', 'hi', 'hello', 'thanks', 'please', 'offer', 'about', 'much', 'many', 't', 'll', 're', 've', 'm',
]);
const FR_WORDS: ReadonlySet<string> = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'à', 'au', 'aux', 'en', 'dans', 'sur', 'pour',
  'avec', 'par', 'est', 'sont', 'je', 'vous', 'nous', 'votre', 'vos', 'notre', 'mon', 'ma', 'mes', 'ce', 'cette',
  'ces', 'que', 'qui', 'quel', 'quelle', 'quels', 'quelles', 'quoi', 'comment', 'combien', 'où', 'quand',
  'pourquoi', 'avez', 'faites', 'pouvez', 'offrez', 'êtes', 'pas', 'ne', 'oui', 'non', 'bonjour', 'merci', 'svp',
  'il', 'elle', 'y', 'a', 'c', 'l', 'qu', 'j', 'n', 'ça', 'parlez',
]);
const OTHER_WORDS: Record<OtherLanguage, ReadonlySet<string>> = {
  de: new Set([
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'und', 'oder', 'ist', 'sind', 'ich', 'sie',
    'wir', 'ihr', 'ihre', 'haben', 'hat', 'mit', 'für', 'auf', 'von', 'zu', 'nicht', 'was', 'wie', 'wo', 'wann',
    'warum', 'welche', 'können', 'kann', 'bieten', 'auch', 'es', 'im', 'am', 'bei', 'nach', 'hallo', 'danke',
    'bitte', 'gibt', 'mein', 'meine', 'noch', 'kostet', 'machen', 'ihnen',
  ]),
  es: new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'y', 'o', 'de', 'del', 'en', 'con', 'por', 'para', 'es', 'son',
    'está', 'están', 'yo', 'usted', 'ustedes', 'nosotros', 'su', 'sus', 'mi', 'qué', 'que', 'cuál', 'cómo',
    'cuánto', 'cuánta', 'dónde', 'cuándo', 'tienen', 'tiene', 'hacen', 'ofrecen', 'puedo', 'pueden', 'no', 'sí',
    'hola', 'gracias', 'también', 'al', 'lo', 'se', 'me', 'hay', 'cuesta',
  ]),
  it: new Set([
    'il', 'lo', 'la', 'gli', 'le', 'un', 'una', 'e', 'o', 'di', 'del', 'della', 'delle', 'dei', 'degli', 'nel',
    'nella', 'alla', 'in', 'con', 'per', 'è', 'sono', 'io', 'voi', 'noi', 'che', 'cosa', 'come', 'quanto', 'dove',
    'quando', 'avete', 'fate', 'offrite', 'potete', 'non', 'ciao', 'grazie', 'anche', 'mi', 'vostro', 'vostra',
    'costa', 'vorrei', 'buongiorno',
  ]),
  pt: new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'ou', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'com', 'por',
    'para', 'é', 'são', 'eu', 'você', 'vocês', 'nós', 'seu', 'sua', 'que', 'qual', 'como', 'quanto', 'onde',
    'quando', 'têm', 'tem', 'fazem', 'oferecem', 'podem', 'não', 'sim', 'olá', 'obrigado', 'obrigada', 'também',
    'custa',
  ]),
  nl: new Set([
    'de', 'het', 'een', 'en', 'of', 'van', 'in', 'op', 'voor', 'met', 'is', 'zijn', 'ik', 'u', 'jullie', 'wij',
    'we', 'uw', 'mijn', 'wat', 'welke', 'hoe', 'hoeveel', 'waar', 'wanneer', 'waarom', 'hebben', 'heeft',
    'kunnen', 'kan', 'bieden', 'niet', 'ook', 'hallo', 'bedankt', 'dank', 'graag', 'er', 'dit', 'dat', 'doen',
    'kost',
  ]),
  pl: new Set([
    'i', 'w', 'z', 'na', 'się', 'nie', 'jest', 'czy', 'to', 'że', 'jak', 'co', 'ile', 'pan', 'pani', 'państwo',
    'mają', 'robicie', 'oferują', 'dzień', 'dobry', 'dziękuję', 'proszę', 'kosztuje', 'jaki', 'jaka', 'gdzie',
    'kiedy', 'za', 'dla', 'mnie', 'macie', 'można',
  ]),
  tl: new Set([
    'ang', 'ng', 'mga', 'sa', 'na', 'ay', 'ko', 'mo', 'po', 'ba', 'kayo', 'ako', 'ninyo', 'namin', 'magkano',
    'saan', 'kailan', 'paano', 'ano', 'may', 'meron', 'salamat', 'opo', 'hindi', 'oo', 'ito', 'iyan', 'nyo',
  ]),
};

/** Accented letters French uses. They add to French only alongside French words, never alone. */
const FRENCH_LETTERS = /[àâæçéèêëîïôœùûüÿ]/;
/** Accented Latin letters French doesn't use (á ñ ã ł ß ơ ư ă đ ạ ố…): each word with one points to "other". */
const NON_FRENCH_LETTER = /[^\x00-\x7fàâæçéèêëîïôœùûüÿ]/;
/** Over this share of non-Latin letters (Chinese, Arabic, Cyrillic…) is "other", however short the text. */
const NON_LATIN_SHARE = 0.3;
const MIN_WORDS = 3;

const ALL_FUNCTION_WORDS = new Set([...EN_WORDS, ...FR_WORDS, ...Object.values(OTHER_WORDS).flatMap((set) => [...set])]);

/**
 * Removes the business's own name from the text before scoring: the whole name wherever it appears, then any of
 * its words that aren't function words (so "Le Jardin de Marie" keeps "le" and "de" in the visitor's French).
 */
function stripNames(text: string, names: string[]): string {
  let out = text;
  for (const name of names) {
    const clean = name.normalize('NFC').trim();
    if (!clean) continue;
    out = out.replace(new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ');
    for (const part of clean.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (part.length < 2 || ALL_FUNCTION_WORDS.has(part)) continue;
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
    }
  }
  return out;
}

/**
 * Lowercased words with whether each looks like a proper name: capitalised and not the first word of a sentence
 * (start of text, or after . ! ? ¿ ¡ or a line break).
 */
function wordTokens(text: string): { word: string; properName: boolean }[] {
  const tokens: { word: string; properName: boolean }[] = [];
  const normalized = text.replace(/[’‘]/g, "'");
  for (const match of normalized.matchAll(/\p{L}+/gu)) {
    const before = normalized.slice(0, match.index).replace(/[ \t"'«»“”(\[-]+$/u, '');
    const sentenceStart = before === '' || /[.!?¿¡\n]$/.test(before);
    tokens.push({ word: match[0].toLowerCase(), properName: !sentenceStart && /^\p{Lu}/u.test(match[0]) });
  }
  return tokens;
}

/** Share of letters that are not Latin script (counted by Unicode script, not by accents). */
export function nonLatinLetterShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  return (letters.length - latin) / letters.length;
}

/**
 * Server-side language of a visitor message: 'en', 'fr', 'other' when it is confidently another language, or null
 * when the text is too short (under 3 words) or too close to call.
 * - Over 30% non-Latin letters: 'other', at any length.
 * - Scores: English and French count their function words; French letters add only when French words are there;
 *   "other" is the best other-language word count plus 2 per word with a letter French doesn't use.
 * - Confident means the top score is at least 2 and at least twice the runner-up; English or French also need at
 *   least 2 of their own function words.
 */
export function detectVisitorLanguage(text: string, options: { names?: string[] } = {}): 'en' | 'fr' | 'other' | null {
  const stripped = stripNames(text.normalize('NFC'), options.names ?? []);
  if (nonLatinLetterShare(stripped) > NON_LATIN_SHARE) return 'other';
  // Hyphens and apostrophes split too, so "faites-vous", "qu'est-ce" and "don't" count piece by piece.
  const tokens = wordTokens(stripped);
  const words = tokens.map((t) => t.word);
  if (words.length < MIN_WORDS) return null;
  const lower = stripped.toLowerCase();

  let enWords = 0;
  let frWords = 0;
  let frLetters = 0;
  let foreignLetters = 0;
  const otherWords = new Map<OtherLanguage, number>();
  for (const { word: w, properName } of tokens) {
    if (EN_WORDS.has(w)) enWords += 1;
    if (FR_WORDS.has(w)) frWords += 1;
    // A capitalised word mid-sentence is likely a name (Mañana, Straße, Søren, Gómez): its letters prove nothing.
    if (NON_FRENCH_LETTER.test(w)) foreignLetters += properName ? 0 : 1;
    else if (FRENCH_LETTERS.test(w)) frLetters += 1;
    for (const lang of Object.keys(OTHER_WORDS) as OtherLanguage[]) {
      if (OTHER_WORDS[lang].has(w)) otherWords.set(lang, (otherWords.get(lang) ?? 0) + 1);
    }
  }
  const scores = {
    en: enWords,
    fr: frWords + (frWords > 0 ? frLetters : 0),
    other: Math.max(0, ...otherWords.values()) + 2 * foreignLetters + (/[¿¡]/.test(lower) ? 2 : 0),
  };
  const ranked = (Object.entries(scores) as ['en' | 'fr' | 'other', number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = [ranked[0]!, ranked[1]!];
  if (top[1] < 2 || top[1] < second[1] * 2) return null;
  if (top[0] === 'en' && enWords < 2) return null;
  if (top[0] === 'fr' && frWords < 2) return null;
  return top[0];
}
