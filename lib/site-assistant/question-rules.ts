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
 * 3. A generic question (service area, job length, insurance, warranty, licence, price, hours, years in business,
 *    free quotes, deposits, how to prepare)
 *    is kept only when the context answers it: the question appears in the context (a FAQ entry), or the context
 *    has the fact the question asks for. A question asking two things needs both.
 *
 * Fewer than 3 questions, or none, is fine: the demo page shows up to 3 chips and hides "You can ask" when there are
 * none.
 */
export type QuestionRule =
  'heading_or_cta' | 'policy_or_privacy' | 'login_or_account' | 'wrong_language' | 'no_answer_in_context';

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
  return text
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
    .replace(/\u00a0/g, ' ');
}

/**
 * Removes HTML comments. A line goes only when nothing but the comment is on it (or it opens a comment that doesn't
 * close on that line); text after a closing `-->` stays. Then whole comments, then an unclosed `<!-- url`.
 */
function stripComments(text: string): string {
  return text
    .replace(/^[ \t]*(?:[-*+][ \t]+)?<!--(?:(?!-->).)*(?:-->[ \t]*)?(?:\n|$)/gm, '')
    .replace(/<!--[\s\S]*?-->[ \t]*/g, '')
    .replace(/<!--\s*\S*/g, '');
}

/** The context as stored: escapes decoded and HTML comments removed. */
export function cleanContextText(markdown: string): string {
  return stripComments(decodeEscapes(markdown))
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
 * "Need Waterproofing?", "Need help?", "Besoin d'une soumission?": a call to action. "Need a permit for a fence?" is a
 * visitor's question and stays: a "need" start is a heading only when it is two words, Title Case, offers help, or
 * praises the work ("Besoin d'un homme à tout faire fiable?", "Need roofing done right?").
 */
const NEED_START = /^(?:need|besoin)\b/;
const NEED_OFFER =
  /^(?:need (?:(?:some |any )?help|a hand|(?:a |an )?(?:free )?(?:quote|estimate)s?|a pro|an expert|assistance|us|service)\b|besoin (?:d'aide|d'un coup de main|d'une (?:soumission|estimation)|d'un (?:devis|expert|professionnel)|de nos services)\b)/;
const NEED_PRAISE =
  /\b(?:reliable|trusted|trustworthy|dependable|done right|quality|professional|affordable|top-notch|expert|best|fiables?|de confiance|bien faite?s?|qualité|professionnel(?:le)?s?|abordables?|experts?|meilleure?s?)\b/;
function isNeedCta(question: string, lower: string): boolean {
  if (!NEED_START.test(lower)) return false;
  const words = question
    .replace(/[?!.]+$/, '')
    .trim()
    .split(/\s+/);
  if (words.length <= 2 || NEED_OFFER.test(lower) || NEED_PRAISE.test(lower)) return true;
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

/** "How soon can you come out for a quote, and is it free?": asks whether quotes are free. */
const FREE_QUOTE_ASK =
  /\b(?:quotes?|estimates?|soumissions?|devis|estimations?)\b[^?]*\b(?:free|gratuite?s?)\b|\b(?:free|gratuite?s?)\b[^?]*\b(?:quotes?|estimates?|soumissions?|devis|estimations?)\b/;

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
    name: 'price',
    asks: /\bcosts?\b|\bprices?\b|\bpricing\b|\bhow much\b|\brates?\b|\bfees?\b|\bcharge\b|\btarifs?\b|\bprix\b|\bcoût|\bcoûte|\bcombien (?:co[uû]t|ça co[uû]t|est-ce que ça co[uû]t|pour |demandez|chargez|facturez)/,
    answered: has(/[$€]\s?\d|\d\s?(?:[$€]|dollars?\b)/),
  },
  {
    name: 'free_quote',
    asks: FREE_QUOTE_ASK,
    answered: has(
      /\bfree\b[^.\n]{0,40}\b(?:quotes?|estimates?|consultations?|assessments?|inspections?|evaluations?)\b|\b(?:quotes?|estimates?|consultations?)\b[^.\n]{0,30}\b(?:free|at no (?:cost|charge))\b|\bno[- ]obligation\b|\b(?:soumissions?|estimations?|devis|consultations?|évaluations?)\b[^.\n]{0,30}\b(?:gratuite?s?|sans frais|sans obligation)\b/,
    ),
  },
  {
    name: 'deposit',
    asks: /\bdeposits?\b|\bdown payment\b|\bdépôts?\b|\bacomptes?\b/,
    // A deposit in a sentence about paying or booking ("soot deposits" and "dépôts de suie" are not).
    answered: (lines) =>
      lines.some(
        (line) =>
          /\bdeposits?\b|\bdown payment\b|\bretainer\b|\bdépôts?\b|\bacomptes?\b|\bversement initial\b/.test(line) &&
          /\b(?:pay\w*|book\w*|reserv\w*|secure|date|contract|order|invoice|requir\w*|take|no|production|percent)\b|%|\$|paiement|pay[eé]\w*|réserv\w*|requis|exigé|facture|commande|contrat|aucun/.test(
            line,
          ),
      ),
  },
  {
    name: 'prepare',
    asks: /\bprepare\b|\bpreparation\b|\bbefore you (?:arrive|come|start)\b|\bpréparer\b|\bpréparation\b|\bavant votre (?:arrivée|venue|passage)\b/,
    // The customer's part, not the crew's ("surface preparation" is the painter's job).
    answered: has(
      /\b(?:how to|you (?:should|can|need to|may want to)|please|to help you)\s+prepare\b|\bprepare (?:your|the) (?:home|house|space|room|rooms|yard|area|property|vehicle|car)\b|\bbefore (?:we|our (?:team|crew|technicians?|cleaners?|movers?)) (?:arrive|come)\b|\bbefore your (?:appointment|visit|cleaning|move|service|session|lesson)\b|\bcomment (?:vous )?préparer\b|\bpréparer (?:votre|vos|la|le) (?:maison|domicile|espace|pièces?|terrain|véhicule)\b|\bavant (?:notre|votre) (?:arrivée|passage|visite|rendez-vous)\b/,
    ),
  },
  {
    name: 'hours',
    asks: /\bhours\b(?! does| do| will| would)|\bopen\b|heures d'ouverture|\bouverts?\b|\bhoraires?\b/,
    answered: has(
      /\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b[^\n]{0,40}\d|\b24\/7\b|\b24 hours\b|\d(?::\d\d)?\s?(?:am|pm)\b|\b\d{1,2}\s?h\s?\d{0,2}\s?(?:à|-|–)/,
    ),
  },
];

/** Sections that describe RedBot's scrape, not the business. Their lines never count as an answer. */
const NOT_EVIDENCE_HEADING = /^#{1,6}\s*(?:gaps|pages scraped|language|langue)\b/i;
const PLACEHOLDER =
  /\bnot (?:stated|listed|published|found|mentioned|given)\b|\bnon (?:indiqu|précis|mentionn)|\bno faq\b|\(none\)/i;

/**
 * The context's lines that can answer a question, lower-cased: RedBot's scrape notes, placeholders and headings
 * ("## Service areas" is not a service area) don't count. `withHeadings` keeps headings, to find a question the
 * page itself asks.
 */
function evidenceLines(contextMd: string, withHeadings = false): string[] {
  const lines: string[] = [];
  let skipping = false;
  for (const line of contextMd.split('\n')) {
    const heading = /^#{1,6}\s/.test(line);
    if (heading) skipping = NOT_EVIDENCE_HEADING.test(line);
    if (skipping || !line.trim() || PLACEHOLDER.test(line) || (heading && !withHeadings)) continue;
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
  const names = business.displayName ? [business.displayName] : [];
  const kept: string[] = [];
  const dropped: DroppedQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of questions) {
    const question = cleanQuestionText(raw, business.language);
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
