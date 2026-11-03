import { applyQuestionRules } from './question-rules';

/**
 * Rule 4: a business left with fewer than MIN_SUGGESTED questions after rules 1-3 gets fresh candidates drawn from
 * its own context, in this order:
 *   1. the site's own FAQ questions, each checked against its own answer (a FAQ whose answer is missing, lorem
 *      ipsum or about something else is skipped);
 *   2. "Do you offer <service>?" for short service names in the Services section (English only);
 *   3. single-topic generic questions (new patients, direct billing, hours, emergency visits, area, years, free estimates,
 *      insurance, licence, warranty).
 * Every candidate goes through the same rules as RedBot's list (applyQuestionRules), so headings, questions asking for
 * the visitor's personal details and questions the context doesn't answer never survive, and a price question
 * survives only when its answer gives the price (rule 3). Deterministic: no model calls. Businesses that already have
 * MIN_SUGGESTED or more are untouched.
 */
export const MIN_SUGGESTED = 3;

export type AddedQuestion = { question: string; source: 'faq' | 'service' | 'generic' };

const STOPWORDS = new Set(
  'about after also and are can could does doing from have here how into just more most much need only other over should some such than that their them then there these they this those through very what when where which while will with would your you yours vous votre vos pour avec dans quel quelle quels quelles est-ce sont nous comment combien faire offrez'.split(
    ' ',
  ),
);
const LOREM = /\b(?:lorem|ipsum|dolor sit|eget|aenean|rhoncus|consectetur|adipiscing)\b/i;
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/’/g, "'");
const contentWords = (text: string) =>
  new Set(
    fold(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
      .map((word) => word.replace(/s$/, '')),
  );

/** "- **Q:** …" followed by "**A:** …" in the FAQ section. */
export function faqPairs(contextMd: string): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = [];
  const lines = contextMd.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const q = /^\s*(?:[-*+]\s+)?(?:\*\*)?Q\s*:(?:\*\*)?\s*(.+?)\s*$/.exec(lines[i]!);
    if (!q) continue;
    const a = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:A|R)\s*:(?:\*\*)?\s*(.*?)\s*$/.exec(lines[i + 1] ?? '');
    const question = q[1]!
      .replace(/\*\*/g, '')
      .replace(/^(?:faq|q\d*)\s*[:.)-]\s*/i, '')
      .replace(/^\d{1,2}\s*[-.)]\s*/, '')
      .trim();
    pairs.push({
      question: question.charAt(0).toUpperCase() + question.slice(1),
      answer: a ? a[1]!.replace(/\*\*/g, '').trim() : '',
    });
  }
  return pairs;
}

/** A visitor's question opens with a question word; "Drain Or Sewage Problems?" and "Something else in mind?" don't. */
const QUESTION_START =
  /^(?:what|what's|when|where|who|which|why|how|do|does|did|can|could|will|would|is|are|should|may|have|has|que|qu'|quel|quels|quelle|quelles|quand|où|comment|combien|pourquoi|est-ce|qui|pouvez|offrez|faites|avez|êtes|y a-t-il|dois-je|puis-je|faut-il)\b/i;
/** Asks the visitor about themselves ("Are you planning a renovation?", "Do you have a question?"): a CTA. */
const ASKS_VISITOR =
  /^(?:are|do|have|did|were) you (?:planning|looking|wondering|thinking|ready|interested|still|have (?:a|any) questions?|need|want)\b|^(?:vous souhaitez|vous cherchez|vous avez (?:un|une|des) (?:projet|question))/i;
/** About the site's own data handling, not the business. */
const SITE_DATA =
  /\b(?:your data|confidentiality|privacy|personal (?:data|information)|cookies?|vos données|renseignements personnels)\b/i;
/** Asks when or how fast: the answer has to give a time. */
const ASKS_WHEN = /\bturnaround\b|\bhow (?:soon|quickly|fast)\b|\bwhen (?:can|will|do|should) (?:i|we)\b|\bdélai/i;
const TIME_GIVEN =
  /\b\d+(?:\s*(?:-|to|à)\s*\d+)?\s*(?:hours?|days?|weeks?|months?|heures?|jours?|semaines?|mois)\b|\bsame[- ]day\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter)\b/i;

/** Title Case ("How Do You Build Interlock to Last Through Ottawa Winters?") is a blog heading, not a visitor. */
function titleCase(question: string): boolean {
  const words = question
    .split(/\s+/)
    .slice(1)
    .filter((word) => /^\p{L}{4,}/u.test(word));
  return words.length >= 3 && words.filter((word) => /^\p{Lu}/u.test(word)).length / words.length >= 0.6;
}

/** The answer is a real answer to this question: long enough, not filler, not a question, and on the same subject. */
function answerFits(question: string, answer: string): boolean {
  if (!QUESTION_START.test(question.replace(/’/g, "'")) || titleCase(question)) return false;
  if (ASKS_VISITOR.test(question) || SITE_DATA.test(question)) return false;
  if (answer.split(/\s+/).length < 5 || LOREM.test(answer) || /\?\s*$/.test(answer)) return false;
  // "When is the best time for newborn photos." under a maternity question is the next question, not an answer.
  if (
    QUESTION_START.test(answer.replace(/’/g, "'")) &&
    /^(?:what|when|where|who|which|why|how|quel|quand|où|comment|pourquoi)\b/i.test(answer)
  )
    return false;
  if (ASKS_WHEN.test(question) && !TIME_GIVEN.test(answer)) return false;
  const asked = contentWords(question);
  return [...contentWords(answer)].some((word) => asked.has(word));
}

/** Last words that make a Services line a service name ("Private Piano Lessons", "WETT Inspection"). */
const SERVICE_NOUN =
  /^(?:lessons?|classes|photography|photos?|portraits?|headshots?|sessions?|cleaning|sweeping|inspections?|repairs?|installations?|upgrades?|replacements?|removal|tutoring|coaching|design|consultations?|maintenance|painting|landscaping|moving|catering|detailing|treatment|services?)$/i;
const NOT_A_SERVICE =
  /\b(?:pric\w*|rates?|cost\w*|fees?|charges?|faq|questions?|about|contact|book\w*|why|our|your|we|testimonials?|philosophy|reviews?|words|covid|policy|other|extra|additional|related|list|award\w*|best|more|all|general|kindness|quality|type|types)\b/i;

function serviceQuestions(contextMd: string): string[] {
  const section = /^##\s*Services\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(contextMd)?.[1] ?? '';
  const out: string[] = [];
  for (const line of section.split('\n')) {
    const item = /^\s*[-*+]\s+(.+?)\s*$/
      .exec(line)?.[1]
      ?.replace(/\*\*|__/g, '')
      .trim();
    if (!item || !/^\p{Lu}[\p{L}&' -]*$/u.test(item) || NOT_A_SERVICE.test(item)) continue;
    const words = item.split(/\s+/);
    if (words.length < 2 || words.length > 5 || !SERVICE_NOUN.test(words[words.length - 1]!)) continue;
    // A capitalized word the site never writes in lower case is a name ("Montreal", "Tremblant"): skip the line.
    const named = words.some(
      (word, i) =>
        i > 0 &&
        /^\p{Lu}\p{Ll}/u.test(word) &&
        !new RegExp(`\\b${word.toLowerCase().replace(/s$/, '')}`).test(contextMd),
    );
    if (named) continue;
    const phrase = words.map((word) => (/^\p{Lu}{2,}$/u.test(word) ? word : word.toLowerCase())).join(' ');
    out.push(`Do you offer ${phrase}?`);
  }
  return out;
}

// Each generic question also needs plain evidence of its own, stronger than the rules' topic check: "Insurance" as a
// cost line or "many years of experience" is not enough to offer "Are you insured?" or "How long in business?".
const NEW_PATIENTS = /\b(?:accept(?:s|ing)?|welcom(?:e|es|ing)|taking) new patients\b|\bnouveaux patients\b/i;
const DIRECT_BILLING = /\bdirect[- ]?bill\w*|\bfacturation directe\b/i;
const EMERGENCY_VISITS =
  /\bemergency (?:appointments?|visits?|dental|care|exams?)\b|\bsame[- ]day appointments?\b|\brendez-vous (?:d'urgence|le jour même)\b|\burgences? dentaires?\b/i;
const HOURS = /\b\d{1,2}(?::\d\d)?\s*(?:a\.?m\.?|p\.?m\.?|h\b|h\d\d)|\b24\/7\b/i;
const AREA = /\b(?:[Ss]erv(?:e|es|ed|ing)|[Dd]esserv\w*|[Tt]ravel(?:s|ling)?)\b[^.\n]{0,60}?\b\p{Lu}\p{Ll}{2,}/u;
const YEARS =
  /\b(?:since|depuis|founded in|established in|fondée? en)\s+(?:19|20)\d\d\b|\b\d{1,3}\+?\s*(?:years|ans)\b(?! old)/i;
const FREE_ESTIMATE =
  /\bfree (?:estimates?|quotes?|consultations?)\b|\b(?:soumissions?|estimations?|évaluations?) gratuites?\b/i;
const INSURED = /\b(?:fully )?insured\b|\bassuré(?:e|s|es)?\b/i;
const LICENSED = /\blicen[cs]ed\b|\bRBQ\b|\blicence (?:RBQ|n|#)/i;
const WARRANTY = /\bwarrant(?:y|ies)\b|\bguarantee(?:d|s)?\b|\bgaranti(?:e|es)\b/i;
const GENERIC: Record<'en' | 'fr', [string, RegExp][]> = {
  en: [
    ['Do you accept new patients?', NEW_PATIENTS],
    ['Do you direct-bill insurance?', DIRECT_BILLING],
    ['What are your hours?', HOURS],
    ['Do you offer emergency appointments?', EMERGENCY_VISITS],
    ['What areas do you serve?', AREA],
    ['How long have you been in business?', YEARS],
    ['Do you offer free estimates?', FREE_ESTIMATE],
    ['Are you insured?', INSURED],
    ['Are you licensed?', LICENSED],
    ['Do you offer a warranty or guarantee?', WARRANTY],
  ],
  fr: [
    ['Acceptez-vous de nouveaux patients ?', NEW_PATIENTS],
    ['Offrez-vous la facturation directe aux assureurs ?', DIRECT_BILLING],
    ["Quelles sont vos heures d'ouverture ?", HOURS],
    ["Offrez-vous des rendez-vous d'urgence ?", EMERGENCY_VISITS],
    ['Quels secteurs desservez-vous ?', AREA],
    ['Depuis combien de temps êtes-vous en affaires ?', YEARS],
    ['Offrez-vous des soumissions gratuites ?', FREE_ESTIMATE],
    ['Êtes-vous assurés ?', INSURED],
    ['Avez-vous une licence RBQ ?', LICENSED],
    ['Offrez-vous une garantie ?', WARRANTY],
  ],
};

const key = (q: string) =>
  fold(q)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Rule 4: fresh, context-answered questions for a business left with fewer than MIN_SUGGESTED. */
export function regenerateQuestions(
  kept: readonly string[],
  business: { contextMd: string; language: 'en' | 'fr'; displayName?: string },
): AddedQuestion[] {
  if (kept.length >= MIN_SUGGESTED) return [];
  const seen = new Set(kept.map(key));
  const added: AddedQuestion[] = [];
  const offer = (question: string, source: AddedQuestion['source'], contextMd: string) => {
    if (kept.length + added.length >= MIN_SUGGESTED) return;
    const result = applyQuestionRules([question], { ...business, contextMd });
    const q = result.kept[0];
    if (!q || seen.has(key(q))) return;
    seen.add(key(q));
    added.push({ question: q, source });
  };
  // A FAQ question is checked against its own answer only, so being on the page is not enough.
  for (const { question, answer } of faqPairs(business.contextMd))
    if (answerFits(question, answer)) offer(question, 'faq', `## FAQ\n- ${answer}`);
  if (business.language === 'en')
    for (const question of serviceQuestions(business.contextMd)) offer(question, 'service', business.contextMd);
  for (const [question, evidence] of GENERIC[business.language])
    if (evidence.test(business.contextMd)) offer(question, 'generic', business.contextMd);
  return added;
}
