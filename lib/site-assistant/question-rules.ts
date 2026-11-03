import { detectVisitorLanguage } from './keywords';

/**
 * Import-time rules for RedBot's suggested questions. Deterministic, no model calls.
 *
 * 1. Mechanical cleanup, for every business: escapes (`\u00e9`, `\/`, `&#39;`, `&amp;`), HTML comments, list
 *    numbering (`1\.`, `Q1:`, `Q.`, `▸`) and markdown emphasis are removed from each question, and escapes and
 *    HTML comments from the context.
 * 2. A question is dropped when it isn't something a visitor would ask: a heading or call to action ("Ready to get
 *    started?", "Why Choose Us?", all caps, no question mark, a web address), privacy or policy text, login or
 *    account text, or a question confidently in another language than the business's.
 * 3. A price or cost question is kept only when the site's own text answers it with a real price, range or fee
 *    ("$120", "from $99", "$80–$150/hour", "consultation fee $50", "à partir de 99 $"), on the subject the question
 *    asks about (Karim, Nov 3 2026: "prices are fine if the website answers them"). "Pricing", "quote", "affordable"
 *    or "contact us for a quote" is not an answer. A "free" or "no charge" line answers only a yes-or-no question about
 *    that same thing ("Do you charge for estimates?" and "Free estimates"), never "How much…?".
 * 4. A generic question (service area, job length, insurance, warranty, licence, hours, years in business, free
 *    quotes, deposits, how the customer prepares) is kept only when the context answers it: the question appears in
 *    the context (a FAQ entry), or the context has the fact the question asks for. A question asking two things
 *    needs both.
 *
 * Fewer than 3 questions, or none, is fine: the demo page shows up to 3 chips and hides "You can ask" when there are
 * none.
 */
export type QuestionRule =
  | 'heading_or_cta'
  | 'policy_or_privacy'
  | 'login_or_account'
  | 'wrong_language'
  | 'price_question'
  | 'no_answer_in_context';

export type DroppedQuestion = { question: string; rule: QuestionRule };

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  icirc: 'î',
  iuml: 'ï',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  uuml: 'ü',
  Eacute: 'É',
  Egrave: 'È',
  Agrave: 'À',
  Ccedil: 'Ç',
  oelig: 'œ',
};

function codePoint(n: number, fallback: string): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : fallback;
}

/** JSON-style `\uXXXX` and `\/`, numeric and common named HTML entities; no-break spaces become spaces. */
export function decodeEscapes(text: string): string {
  return (
    text
      .replace(/(?:\\u[0-9a-fA-F]{4})+/g, (run) =>
        String.fromCharCode(
          ...run
            .split('\\u')
            .filter(Boolean)
            .map((hex) => parseInt(hex, 16)),
        ),
      )
      .replace(/\\\//g, '/')
      .replace(/&#(\d{1,7});/g, (m, d: string) => codePoint(Number(d), m))
      .replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => codePoint(parseInt(h, 16), m))
      .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m)
      .replace(/\u00a0/g, ' ')
      // A `\u003e` that lost its backslash in the scrape ("u003edanny@…"): the code goes.
      .replace(/(?<![\p{L}\p{N}\\])u00(?:3[ce]|26|27|22)(?=[\p{L}\p{N}])/giu, '')
  );
}

/**
 * A comment that closes before a blank line or another `<!--` (one line or several). An opener with no such close is
 * unclosed: RedBot's `<!-- url` with nothing after it.
 */
const CLOSED_COMMENT = '<!--(?:(?!-->|<!--|\\n[ \\t]*\\n)[\\s\\S])*-->';

/**
 * Removes HTML comments. A line goes only when nothing but the comment is on it; text after a closing `-->` stays,
 * also when the comment spans lines. Then a line that opens a comment and never closes it, then an unclosed
 * `<!-- url` inside a line.
 */
function stripComments(text: string): string {
  return text
    .replace(new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?${CLOSED_COMMENT}[ \\t]*(?:\\n|$)`, 'gm'), '')
    .replace(new RegExp(`${CLOSED_COMMENT}[ \\t]*`, 'g'), '')
    .replace(/^[ \t]*(?:[-*+][ \t]+)?<!--.*(?:\n|$)/gm, '')
    .replace(/<!--\s*\S*/g, '');
}

/**
 * A placeholder phone number from a form field or template, not the business's: 000-0000, (555) 000-0000,
 * 555-000-0000, +1 555 000 0000. The separators are required, so "ID 1230000000" is not one.
 */
const PLACEHOLDER_PHONE = String.raw`(?<![\w+])(?:\+?1[ .-]?)?(?:(?:\(\d{3}\)[ .-]?|\d{3}[ .-]))?000[ .-]0000(?!\w|[ .-]?\d)`;
const PHONE_LABEL = String.raw`(?:phone|tel|tél|téléphone|cell|mobile)\.?[ \t]*:?[ \t]*`;
const SEPARATOR = String.raw`[ \t]*[·|•\/,][ \t]*`;

/**
 * Drops placeholder phone numbers with their debris: a "Phone:" line that is only one goes, "Phone: … ·" and
 * "Call … or" lose the label and the joiner, and one in a list is taken out with its comma.
 */
function stripPlaceholderPhones(text: string): string {
  if (!new RegExp(PLACEHOLDER_PHONE).test(text)) return text;
  return (
    text
      .replace(
        new RegExp(String.raw`^[ \t]*(?:[-*+][ \t]+)?${PHONE_LABEL}${PLACEHOLDER_PHONE}[ \t]*(?:\n|$)`, 'gim'),
        '',
      )
      // "Phone: 000-0000, 514-555-1234" keeps the label for the real number; "Phone: 000-0000 ·" loses both.
      .replace(
        new RegExp(
          String.raw`\b(${PHONE_LABEL})${PLACEHOLDER_PHONE}(?:(${SEPARATOR}|[ \t]+(?:or|ou)[ \t]+)(?=[\d(+]))?(?:${SEPARATOR})?`,
          'gi',
        ),
        (_m, label: string, beforeNumber?: string) => (beforeNumber ? label : ''),
      )
      // "Call 000-0000 or email" becomes "Email"; "Call 000-0000, 514-555-1234" becomes "Call 514-555-1234".
      .replace(
        new RegExp(
          String.raw`\b((call|text|appelez|téléphonez)(?: us| nous|-nous)?(?: at| au)?)[ \t]+${PLACEHOLDER_PHONE}(?:(?:${SEPARATOR}|[ \t]+(?:or|ou)[ \t]+)(?=[\d(+])|[ \t]+(?:or|ou)[ \t]+(\p{L}))?`,
          'giu',
        ),
        (m: string, phrase: string, verb: string, next?: string) => {
          if (next) return /^\p{Lu}/u.test(verb) ? next.toUpperCase() : next;
          return /[\d(+]$/.test(m) || /(?:[·|•\/,]|\b(?:or|ou))[ \t]*$/i.test(m) ? `${phrase} ` : '';
        },
      )
      .replace(
        new RegExp(`(${SEPARATOR})?${PLACEHOLDER_PHONE}(${SEPARATOR})?`, 'g'),
        (_m, before?: string, after?: string) => (before && after ? before : ''),
      )
      // What's left of a line that held only the placeholder ("- Phone:", "Tel: ·").
      .replace(
        /^[ \t]*(?:[-*+][ \t]+)?(?:phone|tel|tél|téléphone|cell|mobile)\.?[ \t]*:[ \t]*(?:[·|•/,][ \t]*)?(?:\n|$)/gim,
        '',
      )
      .replace(/(?<=\S)[ \t]{2,}/g, ' ')
  );
}

/** The context as stored: escapes decoded, HTML comments and placeholder phone numbers removed. */
export function cleanContextText(markdown: string): string {
  return stripPlaceholderPhones(stripComments(decodeEscapes(markdown)))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One suggested question as a visitor would type it. */
export function cleanQuestionText(question: string, language: 'en' | 'fr'): string {
  let q = stripComments(decodeEscapes(question));
  // Markdown escapes ("1\.", "\-"), then leading bullets and numbering ("1.", "2)", "Q1:", "Q.", "▸").
  q = q.replace(/\\([\\`*_{}[\]()#+\-.!?])/g, '$1');
  q = q.replace(/^\s*(?:[-*+•▸►▪·]\s*|\d{1,2}\s*[.)]\s+|\d{1,2}\s*[.)](?=\S)|Q\d{0,2}\s*[.:)]\s*)+/i, '');
  // Emphasis: ** and __ runs become a space (a missing space between words is common), single _ or * at a word edge go.
  q = q
    .replace(/\*{2,}|_{2,}/g, ' ')
    .replace(/(^|\s)[_*]+(?=\S)/g, '$1')
    .replace(/(?<=\S)[_*]+(?=\s|$|[?!.,])/g, '');
  // A bracket inside a bracket ("(Longueuil (Montreal area) and nearby)"): the inner one goes.
  q = q.replace(/\(([^()]*?)\s*\([^()]*\)([^()]*)\)/g, '($1$2)');
  q = q.replace(/\s+/g, ' ').trim();
  // French puts a space before ? and !; English doesn't.
  if (language === 'en') q = q.replace(/\s+([?!.,:;])/g, '$1');
  return q;
}

const MAX_QUESTION_CHARS = 140;

/** Starts of headings and calls to action, lower-cased with straight apostrophes. */
const CTA_START =
  /^(?:(?:are you )?ready\b|(?:êtes-vous |es-tu )?prête?s?\b|why (?:choose|should (?:you|we) (?:choose|hire|pick|trust))\b|pourquoi (?:nous )?choisir\b|(?:have|got) (?:a|any) (?:question|project)|want\b|envie\b|looking for\b|vous cherchez\b|tu cherches\b|not sure\b|pas sûr|(?:but )?did you know\b|saviez-vous\b|vous préférez\b|what can we do for you\b|que pouvons-nous faire pour vous\b)/;
/** "Why <Name>?": a heading naming the business, not a question (a verb or "my" after Why makes it one). */
const WHY_NAME =
  /^[Ww]hy\s+(?!(?:is|are|do|does|did|should|would|can|could|will|was|were|my|your|the|a|an|choose)\b)(?:[A-Z][\w'’.&-]*\s*){1,4}\?$/;
/** A page heading in the business's own voice ("What services do we offer?"), not a visitor's question. */
const BUSINESS_VOICE =
  /^(?:what|which|where|how)\b.*\b(?:do|does|can) we (?:offer|serve|provide|do)\b|\bwe complete\b|\b(?:offrons|desservons|proposons)-nous\b/;
const WEB_ADDRESS = /https?:\/\/|www\.|\/\/|\b[\w-]+\.(?:com|ca|net|org|info|biz)\b/i;
const POLICY =
  /\b(?:personal (?:information|data)|privacy|cookies?|terms (?:of|and) (?:use|service|conditions)|gdpr|casl)\b|renseignements personnels|données personnelles|confidentialité|conditions d'utilisation|politique de confidentialité/;
const ACCOUNT =
  /\b(?:accounts?|log ?in|log ?out|sign ?(?:in|up|out)|password|username|my profile|forgot)\b|\b(?:votre|un|mon|ton|créer un) compte\b|connexion|se connecter|mot de passe|identifiant|s'inscrire/;

/**
 * "Need Waterproofing?", "Need help?", "Besoin d'une soumission?": a call to action. "Need a permit for a fence?",
 * "Need permits?" and "Need help choosing a paint colour?" are a visitor's questions and stay: a "need" start is a
 * heading only when it is Title Case, offers help ("Need help?", "Need help with your move?"), or praises the work
 * ("Besoin d'un homme à tout faire fiable?", "Need roofing done right?").
 */
const NEED_START = /^(?:need|besoin)\b/;
const NEED_OFFER =
  /^(?:need (?:(?:some |any )?help(?=[\s?!.]*$|\s+with\b)|a hand|(?:a |an )?(?:free )?(?:quote|estimate)s?|a pro|an expert|assistance|us|service)\b|besoin (?:d'aide|d'un coup de main|d'une (?:soumission|estimation)|d'un (?:devis|expert|professionnel)|de nos services)\b)/;
const NEED_PRAISE =
  /\b(?:reliable|trusted|trustworthy|dependable|done right|quality|professional|affordable|top-notch|expert|best|fiables?|de confiance|bien faite?s?|qualité|professionnel(?:le)?s?|abordables?|experts?|meilleure?s?)\b/;
function isNeedCta(question: string, lower: string): boolean {
  if (!NEED_START.test(lower)) return false;
  const words = question
    .replace(/[?!.]+$/, '')
    .trim()
    .split(/\s+/);
  // "Need to check / know / replace …?" is the visitor's own task, not an offer, even with "best" or "quality" in it.
  if (!/^need to\b/.test(lower) && (NEED_OFFER.test(lower) || NEED_PRAISE.test(lower))) return true;
  const rest = words.slice(1).filter((word) => /^\p{L}/u.test(word) && !/^(?:a|an|the|de|du|des|un|une)$/i.test(word));
  return rest.length > 0 && rest.every((word) => /^\p{Lu}/u.test(word));
}

function isHeadingOrCta(question: string, lower: string): boolean {
  if (!question.includes('?')) return true;
  if (question.length > MAX_QUESTION_CHARS) return true;
  if (WEB_ADDRESS.test(question)) return true;
  if (CTA_START.test(lower) || isNeedCta(question, lower) || /^why\b(?! should i\b).*\bchoos(?:e|ing)\b/.test(lower))
    return true;
  if (WHY_NAME.test(question)) return true;
  if (BUSINESS_VOICE.test(lower)) return true;
  const letters = question.match(/\p{L}/gu) ?? [];
  const upper = letters.filter((ch) => ch !== ch.toLowerCase()).length;
  return letters.length >= 6 && upper / letters.length >= 0.8;
}

// --- Rule 3: generic questions need an answer in the context --------------------------------------------------

const DURATION_AMOUNT =
  /(?:\b(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|a few|few|several|a couple of|un|une|deux|trois|quatre|cinq|six|quelques)\s*(?:(?:-|–|to|or|à|ou)\s*(?:\d+(?:[.,]\d+)?|two|three|four|five|six|seven|eight|deux|trois|quatre|cinq|six)\s*)?(?:hours?|hrs?|days?|weeks?|months?|heures?|jours?|journées?|semaines?|mois)\b|\bsame[- ]day\b|\bin (?:a|one) day\b|\ben une journée\b|\bhalf[- ]day\b)/;
const DURATION_VERB =
  /\b(?:takes?|took|taking|lasts?|complet\w*|finish\w*|done|turnaround|duration|timeline|lead times?|deliver\w*|allow|durée|dure\w*|prend\w*|réalis\w*|termin\w*|compl[eé]t\w*|exécut\w*|livr\w*)\b/;
/** Sentences about how fast the business replies or quotes, not how long the job takes. */
const REPLY_TIME =
  /\b(?:get back to you|back to you|respond|reply|replies|call you back|contact you|hear back)\b|rappel|répond|revenir vers vous/;

type Topic = {
  name: string;
  asks: RegExp;
  /** A question this matches is another topic's, even though `asks` matches too. */
  unless?: RegExp;
  answered: (lines: string[], text: string) => boolean;
};

/**
 * Asks whether quotes are free: "How soon can you come out for a quote, and is it free?", "Do you offer free
 * estimates?", "La soumission est-elle gratuite?". "How long does a free estimate take?" asks how long, and
 * "gluten-free" is not "free".
 */
const QUOTE_WORD = String.raw`(?:quotes?|estimates?|consultations?|assessments?|inspections?|soumissions?|devis|estimations?|évaluations?)`;
const FREE_QUOTE_ASK = new RegExp(
  String.raw`\b${QUOTE_WORD}\b[^?]*\b(?:is|are) (?:it|they|that|those)? ?(?:free|gratuite?s?)\b|\b(?:is|are) (?:the |your )?${QUOTE_WORD} (?:free|gratuite?s?)\b|\b(?:offer|give|provide|do|have)\s+(?<!-)free\s+${QUOTE_WORD}\b|\best-(?:ce|elle|il) (?:gratuite?s?|sans frais)\b|\b${QUOTE_WORD} (?:est-(?:elle|il) |sont-(?:elles|ils) )?(?:gratuite?s?|sans frais)\b|\b${QUOTE_WORD}\b[^?]*(?<!-)\b(?:free|gratuite?s?)\s*\?|\b(?:do|does|will) (?:the |your |a |an )?${QUOTE_WORD} cost (?:anything|money|extra)\b|\b(?:is there|do you have) (?:a |any )?(?:charge|fee|cost) for (?:a |an |the |your )?${QUOTE_WORD}\b`,
);

/**
 * A price or cost question (rule 3): kept only when priceAnswered finds the price on the page. Not "cost-effective",
 * "keep costs low", "success rates", "How much of the yard", "charge my car battery", "fruits frais" or "couture".
 */
const PRICE_ASK =
  /\bcosts?\b(?!-effective)(?<!\b(?:keep|keeping|kept|reduce|reducing|lower|lowering|cut|cutting|save on|saving on|control|controlling|minimi[sz]e) costs?)|\bprices?\b|\bpricing\b|\bhow much (?:does|do|did|will|would|should|can|could|is|are|was|were|for|to|money|it|extra|more|less)\b|\b(?:your|hourly|daily|weekly|monthly|flat|labou?r|going|standard|current|the) rates?\b|\brates? (?:for|per|start)\b|\bfees?\b|\b(?:you|we|they) charge\b(?! (?:my|your|the|a|an|our|it|batter\w*|phones?|cars?|vehicles?|evs?)\b)|\bcharges? (?:for|per|extra)\b|\b(?:extra|additional|service|call-out|callout|travel|minimum|hidden|delivery|cancellation|flat) charges?\b|\bcharged\b|\bquoted?\s+(?:price|amount)|\bbudget\b|\btarifs?\b|\bprix\b|\bco[uû]t(?:s|e|ent|era|erait|eront|er)?\b|\b(?:les|des|vos|aux|quels|quelques|sans|de) frais\b|\bfrais (?:de|d'|supplémentaires|additionnels|cachés)\b|\bcombien (?:ça |est-ce que ça )?(?:co[uû]t|pour |demandez|chargez|facturez)/;

/** The question without its free-quote part, so "How much does it cost, and is the estimate free?" is still about price. */
const FREE_QUOTE_ALL = new RegExp(FREE_QUOTE_ASK.source, 'g');
const withoutFreeQuote = (lower: string) => lower.replace(FREE_QUOTE_ALL, ' ');

// --- Rule 3: a price question needs a price on the page (v4) ---------------------------------------------------

/** "$120", "$ 80–150", "CAD 50", "99 $", "1 017,63$", "120 dollars", "50 €". A digit is required. */
const AMOUNT =
  /(?:\$|\b(?:cad|usd)\s?|€|£)\s?(\d[\d\s,.]*)|\b(\d[\d\s,.]*?)\s?(?:\$|€|£|(?:dollars?|cad|usd|euros?)\b)/gi;
/**
 * Sentences whose amounts are not what a visitor pays for the service: insurance cover ("$5M insured"), income
 * brackets ("70 000 $ : couverture complète"), credits, rebates, grants, discounts, gift cards, a shop cart.
 */
const NOT_A_PRICE =
  /\b(?:liability|insured|insurance|coassurance|assurée?s?|assurance)\b[^.\n]{0,30}\d|\d[^.\n]{0,30}\b(?:liability|insured|couverture|coassurance)\b|\b(?:rebates?|grants?|subventions?|tax credits?|credits?|crédits?(?: d'impôt)?|donat\w*|raised|charit\w*|fundrais\w*|prizes?|gift ?cards?|cartes?[- ]cadeaux|save|saving|savings|économis\w*|discount\w*|rabais|réductions?|income|revenue|revenus?|salar\w*|salaires?|wages?|cart|panier|subtotal|sous-total|millions?|milliards?|billions?)\b|\$\s?\d+(?:[.,]\d+)?\s?(?:m|mm|b)\b|\d\s?%\s?off\b|\$\s?\d[\d.,]*\s?(?:off|back)\b/i;
/** "Orders over $75", "moins de 70 000 $": a threshold, not a price. Tested on the words just before the amount. */
const THRESHOLD = /\b(?:over|above|under|more than|less than|plus de|moins de|au-delà de)\s*$/;
/** A quote's own price: "Consultation fee $50", "$199 in-person consultation", "Estimates are $75". */
const QUOTE_PRICE = new RegExp(
  String.raw`\b${QUOTE_WORD} (?:fees?|costs?|charges?|frais)\b|(?:\$\s?\d[\d,.]*|\d[\d\s,.]*\s?\$)\s+(?:(?:in-person|in-home|on-site|initial|first|sur place|à domicile)\s+)?${QUOTE_WORD}\b|\b${QUOTE_WORD}\s+(?:is|are|costs?|runs?|starts? at|:|-|–|—)\s*(?:\$|\d)`,
);
/**
 * Fees that are not the price of the work (a deposit, a cancellation, refund or late fee, a surcharge, travel or
 * shipping, a quote's own fee): an amount next to one of these answers only a question that names it.
 */
const SIDE_FEES: { near: RegExp; asks: RegExp }[] = [
  {
    near: /\bdeposits?\b|\bdown payment\b|\bretainer\b|\bacomptes?\b|\bdépôts?\b/,
    asks: /\bdeposits?\b|\bdown payment\b|\bretainer\b|\bacomptes?\b|\bdépôts?\b/,
  },
  {
    near: /\bcancel\w*|\breschedul\w*|\bannul\w*|\bno[- ]shows?\b/,
    asks: /\bcancel\w*|\breschedul\w*|\bannul\w*|\bno[- ]shows?\b/,
  },
  { near: /\brefund\w*|\brembours\w*/, asks: /\brefund\w*|\brembours\w*/ },
  {
    near: /\blate (?:fees?|payments?|charges?)\b|\bretards?\b|\bpenalt\w*|\bpénalit\w*/,
    asks: /\blate\b|\bretards?\b|\bpenalt\w*|\bpénalit\w*/,
  },
  {
    near: /\bsurcharges?\b|\bsuppléments?\b/,
    asks: /\bsurcharges?\b|\bsuppléments?\b|\bextra\b|\badditional\b|\bweekends?\b|\bevenings?\b|\bholidays?\b|\bfin de semaine\b|\bsamedi\b|\bdimanche\b/,
  },
  {
    near: /\btravel\b|\btrip\b|\bmileage\b|\bshipping\b|\bdelivery\b|\bdéplacements?\b|\blivraisons?\b|\bexpédition\b|\bkilométrage\b/,
    asks: /\btravel\b|\btrip\b|\bmileage\b|\bshipping\b|\bdeliver\w*|\bdéplacements?\b|\blivr\w*|\bexpédi\w*|\bkilométrage\b/,
  },
];

const QUOTE_NEAR = new RegExp(String.raw`\b${QUOTE_WORD}`);
const QUOTE_ASKED = new RegExp(String.raw`\b${QUOTE_WORD}|\bconsult\w*|\bassess\w*`);

type Amount = { before: string; after: string };
/** The real, non-zero amounts of a sentence, each with the words around it up to a comma or semicolon. */
function amountsIn(sentence: string): Amount[] {
  if (NOT_A_PRICE.test(sentence)) return [];
  const out: Amount[] = [];
  for (const m of sentence.matchAll(AMOUNT)) {
    const digits = (m[1] ?? m[2] ?? '').trim();
    // "$0.00" in a cart; "$1.00" on every line is a shop template's placeholder.
    if (!/[1-9]/.test(digits) || /^0*1[.,]00$/.test(digits)) continue;
    const before = sentence.slice(Math.max(0, m.index - 40), m.index).replace(/^.*[,;•|]/s, '');
    const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 30).replace(/[,;•|].*$/s, '');
    if (THRESHOLD.test(before)) continue;
    out.push({ before, after });
  }
  return out;
}
/** The sentence has an amount that answers this question: not a side fee the question doesn't ask about. */
function pricedFor(sentence: string, lower: string): boolean {
  return amountsIn(sentence).some(({ before, after }) => {
    const near = `${before} ${after}`;
    if (SIDE_FEES.some((fee) => fee.near.test(near) && !fee.asks.test(lower))) return false;
    const quoteFee = QUOTE_PRICE.test(sentence) && QUOTE_NEAR.test(near);
    return !quoteFee || QUOTE_ASKED.test(lower);
  });
}
/**
 * "No travel charges", "at no extra cost", "Free estimates", "sans frais": a zero fee, for a yes-or-no question on that
 * same thing.
 */
const NO_FEE =
  /\bno (?:extra |additional |hidden |travel |trip |delivery |cancellation |call-out |callout )?(?:charges?|fees?|costs?)\b|\bat no (?:extra |additional )?(?:cost|charge)\b|\bfree of charge\b|\bwithout (?:any )?(?:extra |additional )?charge\b|(?<![\p{L}\p{Pd}])free(?![\p{L}\p{Pd}])(?! to\b)(?<!\bfeel free)|\bsans (?:frais|supplément)\b|\baucuns? frais\b|\bgratuite?s?\b/u;
/** A yes-or-no question on whether something costs anything: "Do you charge for travel?", "Is there a fee for…?". */
const YES_NO_FEE =
  /^(?:do|does|did|will|would|is|are|can)\b|^(?:y a-t-il|y-a-t-il|est-ce qu|facturez-vous|chargez-vous|faut-il payer|dois-je payer)/;
/** The question asks for a rate per hour: the price has to be per hour too. */
const ASKS_HOURLY = /\bhourly\b|\b(?:per|an|by the|each) hour\b|\b(?:à|de) l'heure\b|\bhoraires?\b/;
const PER_HOUR =
  /\bhourly\b|\/\s?(?:h|hr|hrs|hour|heure)\b|\b(?:per|an|a|by the|each|par|de l') ?(?:hour|hr|heure)\b|\$\s?\d+\s?(?:\/|per |par )?h\b|\d\s?\$\s?(?:\/|de l'|par )?(?:h|heure)\b/;
/** Words that say nothing about what is priced ("Roughly what does a typical job cost?"). Accents folded. */
const PRICE_FILLER = new Set(
  (
    'what whats which how much many does doing did will would could can should is are was were the and for of to in on at with ' +
    'your you my our we its it this that there any some about typical typically roughly approximately approximate approx ' +
    'average usually generally ballpark idea give cost costs costing price prices priced pricing rate rates fee fees charge ' +
    'charges charged charging budget amount job jobs project projects service services work starting start starts range ' +
    'ranges per each like look expect pay paying spend run runs involved small large big standard basic total overall ' +
    'extra additional include included includes hour hourly anything something free first initial ' +
    ' combien coute coutent couter cout couts coutera prix tarif tarifs frais quel quelle quels quelles est sont les une des ' +
    'pour vos votre mon mes nos notre vous que qu est-ce cela approximatif approximative approximativement typique moyen ' +
    'moyenne environ projet projets service services travail travaux budget montant faut prevoir demandez chargez facturez ' +
    'payer generalement habituellement partir heure horaire gratuit gratuite gratuits gratuites premiere premier initiale'
  ).split(' '),
);
const foldLower = (text: string) => fold(text.toLowerCase().replace(/’/g, "'"));
/** "painting" finds "paint", "painted"; "nettoyage" finds "nettoyer". */
const stemOf = (word: string) => {
  const bare = word.replace(/(?:ings?|ed|es|s)$/, '');
  return (bare.length >= 4 ? bare : word).slice(0, 6);
};
/** The words of the question that name what is priced, without the business's own name and niche. */
function priceSubjects(lower: string, generic: Set<string>): string[] {
  return foldLower(lower)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !PRICE_FILLER.has(word) && !generic.has(stemOf(word)))
    .map(stemOf);
}

type PriceLine = { sentence: string; about: string };
/**
 * The site's sentences with a price or a zero fee, lower-cased, each with what it is about: the sentence, its section
 * heading and, for a FAQ answer, its question. Scrape notes and placeholders don't count.
 */
function priceLines(contextMd: string): PriceLine[] {
  const out: PriceLine[] = [];
  let heading = '';
  let skipping = false;
  let lastQuestion = '';
  for (const raw of contextMd.split('\n')) {
    const line = raw.toLowerCase().replace(/’/g, "'");
    if (/^#{1,6}\s/.test(raw)) {
      skipping = NOT_EVIDENCE_HEADING.test(raw);
      heading = line;
      lastQuestion = '';
      continue;
    }
    if (skipping || !line.trim() || PLACEHOLDER.test(line) || SCRAPE_META.test(line)) continue;
    const isQuestion = /^\s*(?:[-*+]\s+)?(?:\*\*)?q\s*:/.test(line);
    const about = `${heading} ${isQuestion ? '' : lastQuestion}`;
    for (const sentence of line.split(/(?<=[.!?;])\s+/))
      if (!isQuestion && (amountsIn(sentence).length > 0 || NO_FEE.test(sentence)))
        out.push({ sentence, about: foldLower(`${about} ${sentence}`) });
    lastQuestion = isQuestion ? line : '';
  }
  return out;
}
/**
 * Rule 3: the site answers this price question. A sentence with a real amount (or, for a yes-or-no question that
 * names what is priced, a "free" / "no charge" line) on what the question asks about: every word of it ("window cleaning" is not
 * answered by "Gutter cleaning from $99"), else (for "What are your rates?") any price. Deposit, cancellation, refund and late fees answer only a question about them; an hourly rate needs a
 * price per hour.
 */
function priceAnswered(lower: string, contextMd: string, generic: Set<string>): string[] | null {
  // "How much does it cost, and is the estimate free?" asks the price of the work, not of the estimate.
  const priceAsk = withoutFreeQuote(lower);
  // Only the price part of "What does a first visit cost, and what is covered by insurance?" needs a price; the other
  // part goes through the topic check like any question.
  const clauses = priceAsk.split(
    /,\s*(?:and|or|et|ou)\b|;|\s+(?:and|et)\s+(?=(?:what|how|is|are|do|does|can|will|est-ce|quel|quels|quelle|quelles|combien)\b)/,
  );
  const priced = clauses.filter((clause) => PRICE_ASK.test(clause));
  const lines = priceLines(contextMd);
  const found: string[] = [];
  for (const clause of priced.length > 0 ? priced : [priceAsk]) {
    // "a first visit or consultation": either one priced is an answer.
    const options = clause.split(/\s+(?:or|ou)\s+/).map((part) => priceSubjects(part, generic));
    const hourly = ASKS_HOURLY.test(clause);
    // "Free" answers "Do you charge for estimates?", not "How much does a consultation cost?".
    const yesNo = YES_NO_FEE.test(clause.trim());
    const hit = lines.find(({ sentence, about }) => {
      if (hourly && !PER_HOUR.test(sentence)) return false;
      const amount = pricedFor(sentence, lower);
      return options.some((subjects) => {
        if (subjects.length === 0) return amount;
        if (!amount && !(yesNo && NO_FEE.test(sentence))) return false;
        return subjects.every((stem) => new RegExp(`(?<![\\p{L}\\p{N}])${stem}`, 'u').test(about));
      });
    });
    if (!hit) return null;
    found.push(hit.sentence.replace(/^\s*(?:[-*+]\s+)?(?:\*\*)?a\s*:(?:\*\*)?\s*/, '').trim());
  }
  return found;
}

/**
 * The site's sentences that answer a price question under rule 3, or null when the site doesn't answer it (or it is
 * not a price question). For checks and logs.
 */
export function priceEvidence(
  question: string,
  business: { contextMd: string; displayName?: string },
): string[] | null {
  const lower = question.toLowerCase().replace(/’/g, "'");
  if (!PRICE_ASK.test(withoutFreeQuote(lower))) return null;
  return priceAnswered(lower, business.contextMd, genericWords(business.contextMd, business.displayName));
}

/** The business's own name and RedBot's niche: "painting" says nothing about what Abraham Painting prices. */
function genericWords(contextMd: string, displayName?: string): Set<string> {
  const niche = /^[ \t]*(?:[-*+][ \t]+)?.*\bniche\s*:\s*(.+)$/im.exec(contextMd)?.[1] ?? '';
  return new Set(
    foldLower(`${displayName ?? ''} ${niche}`)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4)
      .map(stemOf),
  );
}

/** Soot, scale and mineral deposits are not a down payment. */
const DEPOSIT_WORD =
  /(?<!\b(?:soot|creosote|mineral|calcium|lime|limescale|scale|carbon|grease|rust|tar|fat|sediment|water|oil|salt) )\bdeposits?\b(?! of (?:soot|creosote|minerals?|calcium|lime|scale|grease|rust))|\bdown payment\b|\bretainer\b|\bdépôts?\b(?! (?:de|d') ?(?:suie|calcaire|créosote|graisse|minéraux|tartre))|\bacomptes?\b|\bversement initial\b/;
const NO_DEPOSIT =
  /\bno deposits?\b|\b(?:do not|don't|never|won't) (?:take|require|ask for|charge|need) (?:a |any )?deposits?\b|\bwithout (?:a |any )?deposit\b|\b(?:from|after|upon|on receipt of) (?:the |your |a )?deposit\b|\baucun (?:dépôt|acompte)\b|\bsans (?:dépôt|acompte)\b/;

const has = (re: RegExp) => (_lines: string[], text: string) => re.test(text);

const TOPICS: Topic[] = [
  {
    name: 'area',
    asks: /\b(?:serve|service areas?|my area|what areas|which areas|travel to|come to)\b|desserv|mon secteur|quels secteurs|quelles régions|territoire|vous déplacez/,
    answered: has(
      /\b(?:serv(?:e|es|ed|ing|icing)|service areas?|surrounding|areas? we)\b|desserv|environs|\brégions?\b|rive-(?:nord|sud)|\bgta\b/,
    ),
  },
  {
    name: 'years',
    asks: /how long have you been|how many years|years in business|depuis combien de temps|depuis quand|combien d'années/,
    answered: has(
      /\bsince (?:19|20)\d\d\b|\b\d+\+? years?\b|depuis (?:19|20)\d\d|\bdepuis plus de\b|\b\d+ ans\b|\bfounded\b|\bfondée?\b/,
    ),
  },
  {
    name: 'duration',
    asks: /\bhow long (?!have you been)|combien de temps (?!êtes)|\bdurée\b|\bdure\b|\btimeline\b|\bdélais?\b/,
    unless: FREE_QUOTE_ASK,
    answered: (lines) =>
      lines
        .flatMap((line) => line.split(/(?<=[.!?;])\s+/))
        .some(
          (sentence) => DURATION_AMOUNT.test(sentence) && DURATION_VERB.test(sentence) && !REPLY_TIME.test(sentence),
        ),
  },
  {
    name: 'insured',
    asks: /\binsur|\bassur(?:é|e|ance)/,
    answered: has(/\binsur(?:ed|ance)\b|\bliability\b|\bassur(?:é|ée|és|ées|ance|ances)\b/),
  },
  {
    name: 'warranty',
    asks: /warrant|guarant|garanti/,
    answered: has(/warrant|guarant|garanti/),
  },
  {
    name: 'licensed',
    asks: /\blicen[cs]|\brbq\b|\bcertified\b|licenci|certifi/,
    answered: has(/\blicen[cs]|\brbq\b|certifi|licenci/),
  },
  {
    name: 'free_quote',
    asks: FREE_QUOTE_ASK,
    // "Free estimates", or the quote's own price ("Consultation fee $50"), which answers "Is the consultation free?".
    answered: (lines, text) =>
      /(?<!-)\bfree\b[^.\n]{0,40}\b(?:quotes?|estimates?|consultations?|assessments?|inspections?|evaluations?)\b|\b(?:quotes?|estimates?|consultations?)\b[^.\n]{0,30}\b(?:free|at no (?:cost|charge))\b|\bno[- ]obligation\b|\b(?:soumissions?|estimations?|devis|consultations?|évaluations?)\b[^.\n]{0,30}\b(?:gratuite?s?|sans frais|sans obligation)\b/.test(
        text,
      ) ||
      lines.some((line) =>
        line.split(/(?<=[.!?;])\s+/).some((sentence) => QUOTE_PRICE.test(sentence) && amountsIn(sentence).length > 0),
      ),
  },
  {
    name: 'deposit',
    asks: DEPOSIT_WORD,
    // A deposit in a sentence about paying or booking ("soot deposits" and "dépôts de suie" are not), or a plain
    // "No deposits" / "We do not take deposits", which answers it too.
    answered: (lines) =>
      lines.some(
        (line) =>
          NO_DEPOSIT.test(line) ||
          (DEPOSIT_WORD.test(line) &&
            /\b(?:pay\w*|book\w*|reserv\w*|secures?|contracts?|invoices?|required|requires|non-refundable|refundable|balance|percent)\b|%|\$|paiement|pay[eé]\w*|réserv\w*|requis|exigé|factur\w*|contrat|solde|remboursable/.test(
              line,
            )),
      ),
  },
  {
    name: 'prepare',
    // The customer asking about their own part ("How should I prepare?"), not "Do you prepare food on-site?".
    asks: /\bhow (?:should|do|can|would|must) (?:i|we) (?:best )?prepare\b|\b(?:do|should|must|will) (?:i|we) (?:need to |have to )?prepare\b|\b(?:i|we) (?:need|have|should|ought) to (?:do to )?prepare\b|\bwhat (?:should|do|must|can) (?:i|we) (?:need to |have to )?do (?:to prepare|before)\b|\bis there anything (?:i|we) (?:need|should|have) to (?:do|prepare)\b|\bcomment (?:dois-je |devrais-je |puis-je |je dois |on doit )?(?:me |nous )?préparer\b|\b(?:dois-je|devrais-je|faut-il|est-ce que je dois) (?:me |nous )?préparer\b|\bque (?:dois-je|devrais-je|faut-il|est-ce que je dois) faire avant\b|\by a-t-il quelque chose (?:à|que je dois) (?:faire|préparer)\b/,
    // The customer's part, not the crew's ("surface preparation" is the painter's job).
    answered: has(
      /\b(?:how to|you (?:should|can|need to|may want to)|please|to help you)\s+prepare\b|\bprepare (?:your|the) (?:home|house|space|room|rooms|yard|area|property|vehicle|car)\b|\bbefore (?:we|our (?:team|crew|technicians?|cleaners?|movers?)) (?:arrive|come)\b|\bbefore your (?:appointment|visit|cleaning|move|service|session|lesson)\b|\bcomment (?:vous )?préparer\b|\bpréparer (?:votre|vos|la|le) (?:maison|domicile|espace|pièces?|terrain|véhicule)\b|\bavant (?:notre|votre) (?:arrivée|passage|visite|rendez-vous)\b/,
    ),
  },
  {
    name: 'hours',
    asks: /\bhours\b(?! does| do| will| would)|\bopen\b|heures d'ouverture|\bouverts?\b|\bhoraires?\b/,
    answered: has(
      /\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b[^\n]{0,40}\d|\b24\/7\b|\b(?:open|available|operating|answering|on call)\s+24 hours\b|(?<!\b(?:within|in|after|before|of) )\b24 hours,? (?:a day|(?:7|seven) days(?: a week)?)\b(?! (?:after|before|later|prior|from|of|notice|in advance)\b)|\b24[- ]hours? (?:emergency )?(?:service|emergenc\w*|availability|support|line|dispatch)\b|\b(?:7|seven) days a week\b|\b7\s?(?:jours?|j)\s?(?:sur|\/)\s?7\b|\b24\s?h\s?(?:sur|\/)\s?24\b|\bweekends?\b[^\n]{0,30}\b(?:open|available)\b|\b(?:open|available)\b[^\n]{0,30}\bweekends?\b|\d(?::\d\d)?\s?(?:am|pm)\b|\b\d{1,2}\s?h\s?\d{0,2}\s?(?:à|-|–)/,
    ),
  },
];

/** Sections that describe RedBot's scrape, not the business. Their lines never count as an answer. */
const NOT_EVIDENCE_HEADING = /^#{1,6}\s*(?:gaps|pages scraped|language|langue)\b/i;
/** RedBot's header lines ("Site:", "Scraped:", "City: Montreal, QC · Niche: catering"), not the site's words. */
const SCRAPE_META = /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*|__)?(?:site|scraped|city|niche|source|url)(?:\*\*|__)?\s*:/i;
const PLACEHOLDER =
  /\bnot (?:stated|listed|published|found|mentioned|given)\b|\bnon (?:indiqu|précis|mentionn)|\bno faq\b|\(none\)/i;

/**
 * The context's lines that can answer a question, lower-cased: RedBot's scrape notes and header lines, placeholders and headings
 * ("## Service areas" is not a service area) don't count. `withHeadings` keeps headings, to find a question the
 * page itself asks.
 */
function evidenceLines(contextMd: string, withHeadings = false): string[] {
  const lines: string[] = [];
  let skipping = false;
  for (const line of contextMd.split('\n')) {
    const heading = /^#{1,6}\s/.test(line);
    if (heading) skipping = NOT_EVIDENCE_HEADING.test(line);
    if (skipping || !line.trim() || PLACEHOLDER.test(line) || SCRAPE_META.test(line) || (heading && !withHeadings))
      continue;
    lines.push(line.toLowerCase().replace(/’/g, "'"));
  }
  return lines;
}

const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Template words in RedBot's brackets ("(Ottawa and nearby)", "(Montreal et environs)"); they prove nothing. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '');
const BRACKET_FILLER = new Set([
  'and',
  'or',
  'nearby',
  'area',
  'areas',
  'the',
  'et',
  'ou',
  'environs',
  'secteur',
  'region',
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
]);

/**
 * A short bracket none of whose words is in the context is RedBot's filler, often in the wrong language
 * ("Quel est le prix approximatif d'un projet typique (catering)?"): the bracket goes. Accents are ignored
 * ("Montreal" matches "Montréal"). `foldedContext` is the normalized context without accents, space-padded.
 */
/** Words after which a bracket is the question's object ("Do you serve (Kingston)?"), so it can't go. */
const NEEDS_OBJECT = new Set([
  'serve',
  'service',
  'cover',
  'visit',
  'travel',
  'come',
  'work',
  'in',
  'to',
  'for',
  'near',
  'at',
  'of',
  'around',
  'from',
  'on',
  'with',
  'by',
  'about',
  'include',
  'offer',
  'do',
  'install',
  'repair',
  'dans',
  'a',
  'au',
  'aux',
  'en',
  'pour',
  'vers',
  'pres',
  'sur',
  'desservez',
  'couvrez',
  'offrez',
  'faites',
]);
/** The word and its singular or plural ("windows" finds "window", "door" finds "doors"). */
const wordForms = (word: string) => [
  word,
  `${word}s`,
  `${word}es`,
  ...(word.endsWith('es') ? [word.slice(0, -2)] : []),
  ...(word.endsWith('s') ? [word.slice(0, -1)] : []),
];

function dropUnseenBrackets(question: string, foldedContext: string): string {
  return question.replace(/\s*\(([^()]{1,60})\)/g, (whole, inner: string, offset: number) => {
    const before = fold(normalized(question.slice(0, offset))).split(' ');
    if (NEEDS_OBJECT.has(before[before.length - 1] ?? '') || before.filter(Boolean).length < 3) return whole;
    // A worked example ("(typical bungalow)", "(e.g. a deck)") narrows the question; it isn't RedBot's filler.
    if (/^\s*(?:typical|typique|e\.?\s?g\.?|ex\.|for example|par exemple|such as|like|say|approx)/i.test(inner))
      return whole;
    const words = fold(normalized(inner))
      .split(' ')
      .filter((word) => word.length >= 3 && !BRACKET_FILLER.has(word));
    const seen = words.some((word) => wordForms(word).some((form) => foldedContext.includes(` ${form} `)));
    return words.length === 0 || seen ? whole : '';
  });
}

/**
 * Applies rules 1-3 to RedBot's list, in order, keeping the first copy of a repeated question. Returns what is kept
 * and, for each dropped question, the first rule that dropped it.
 */
export function applyQuestionRules(
  questions: readonly string[],
  business: { contextMd: string; language: 'en' | 'fr'; displayName?: string },
): { kept: string[]; dropped: DroppedQuestion[] } {
  const lines = evidenceLines(business.contextMd);
  const text = lines.join('\n');
  const flatContext = ` ${normalized(evidenceLines(business.contextMd, true).join(' '))} `;
  const foldedContext = fold(flatContext);
  const names = business.displayName ? [business.displayName] : [];
  const generic = genericWords(business.contextMd, business.displayName);
  const kept: string[] = [];
  const dropped: DroppedQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of questions) {
    const question = dropUnseenBrackets(cleanQuestionText(raw, business.language), foldedContext);
    const key = normalized(question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const lower = question.toLowerCase().replace(/’/g, "'");
    let rule: QuestionRule | null = null;
    if (isHeadingOrCta(question, lower)) rule = 'heading_or_cta';
    else if (POLICY.test(lower)) rule = 'policy_or_privacy';
    else if (ACCOUNT.test(lower)) rule = 'login_or_account';
    else {
      const language = detectVisitorLanguage(question, { names });
      if (language !== null && language !== business.language) rule = 'wrong_language';
    }
    if (!rule && PRICE_ASK.test(withoutFreeQuote(lower)) && !priceAnswered(lower, business.contextMd, generic))
      rule = 'price_question';
    if (!rule) {
      const topics = TOPICS.filter((topic) => topic.asks.test(lower) && !topic.unless?.test(lower));
      const onPage = flatContext.includes(` ${key} `);
      if (topics.length > 0 && !onPage && !topics.every((topic) => topic.answered(lines, text)))
        rule = 'no_answer_in_context';
    }
    if (rule) dropped.push({ question, rule });
    else kept.push(question);
  }
  return { kept, dropped };
}
