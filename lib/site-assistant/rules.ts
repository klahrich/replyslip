import { findOwnerKeyword } from './keywords';
import { normalizeForMatch } from './normalize';
import type { HandoffReason } from './replies';
import { OWNER_ONLY_TOPICS, type SiteModelAnswer } from './schema';

/** Which rule decided a reply (stored on the assistant message, spec 4.2 rule 10). */
export type DecidedBy =
  | 'answered'
  | 'keyword_visitor'
  | 'keyword_reply'
  | 'owner_topic'
  | 'language_other'
  | 'model_needs_owner'
  | 'model_off_topic'
  | 'no_sources'
  | 'contact_detail'
  | 'invalid_output'
  | 'llm_error'
  | 'llm_timeout'
  | 'llm_unconfigured'
  | 'cap_visitor'
  | 'cap_business_messages'
  | 'cap_business_cost'
  | 'cap_global_cost';

export function handoffReason(decidedBy: string | null | undefined): HandoffReason | null {
  switch (decidedBy) {
    case 'keyword_visitor':
    case 'keyword_reply':
    case 'owner_topic':
      return 'owner_topic';
    case 'model_needs_owner':
    case 'no_sources':
      return 'not_in_context';
    case 'language_other':
      return 'other_language';
    case 'contact_detail':
    case 'invalid_output':
    case 'llm_error':
    case 'llm_timeout':
    case 'llm_unconfigured':
      return 'check_failed';
    default:
      return null;
  }
}

/** A quote shorter than this proves nothing ("the", "yes") and is dropped. */
export const MIN_SOURCE_CHARS = 8;

export function checkSources(sources: string[], normalizedContext: string): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const source of sources) {
    const n = normalizeForMatch(source);
    if (n.length >= MIN_SOURCE_CHARS && normalizedContext.includes(n)) kept.push(source);
    else dropped.push(source);
  }
  return { kept, dropped };
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"'\]]+/gi;
const BARE_DOMAIN_RE =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|ca|net|org|io|co|tech|info|biz|app|dev|shop|store|site|online|us|fr|qc\.ca|on\.ca)\b(?:\/[^\s<>()"']*)?/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{5,}\d)/g;

function urlKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[.,;:!?]+$/, '')
    .replace(/\/+$/, '');
}

function digits(value: string): string {
  return value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

export type ContactIndex = { text: string; urlText: string; phones: Set<string> };

export function contactIndex(context: string): ContactIndex {
  const lower = context.toLowerCase();
  const phones = new Set<string>();
  for (const m of context.matchAll(PHONE_RE)) {
    const d = digits(m[0]);
    if (d.length >= 7 && d.length <= 15) phones.add(d);
  }
  return { text: lower, urlText: lower.replace(/https?:\/\//g, '').replace(/(^|[^a-z0-9.-])www\./g, '$1'), phones };
}

/** First URL, email or phone number in the reply that is not in the context (spec 4.2 rule 9), or null. */
export function unknownContactDetail(reply: string, index: ContactIndex): string | null {
  const emails = reply.match(EMAIL_RE) ?? [];
  for (const email of emails) if (!index.text.includes(email.toLowerCase())) return email;
  const withoutEmails = reply.replace(EMAIL_RE, ' ');
  for (const url of [...(withoutEmails.match(URL_RE) ?? []), ...(withoutEmails.match(BARE_DOMAIN_RE) ?? [])]) {
    const key = urlKey(url);
    if (key && !index.urlText.includes(key)) return url;
  }
  for (const m of withoutEmails.matchAll(PHONE_RE)) {
    const d = digits(m[0]);
    if (d.length < 7 || d.length > 15) continue;
    if (!index.phones.has(d)) return m[0].trim();
  }
  return null;
}

export type RuleOutcome = {
  status: 'answered' | 'needs_owner' | 'off_topic';
  decidedBy: DecidedBy;
  kept: string[];
  dropped: string[];
};

/**
 * Server rules on a schema-valid model answer (spec 4.2). The model's status is a suggestion; these decide.
 * Order matters only for which rule is recorded: any owner rule wins over answered.
 */
export function applyRules(answer: SiteModelAnswer, normalizedContext: string, contacts: ContactIndex): RuleOutcome {
  const { kept, dropped } = checkSources(answer.sources, normalizedContext);
  const owner = (decidedBy: DecidedBy): RuleOutcome => ({ status: 'needs_owner', decidedBy, kept, dropped });
  if (answer.language === 'other') return owner('language_other');
  if (OWNER_ONLY_TOPICS.has(answer.topic)) return owner('owner_topic');
  if (answer.status === 'needs_owner') return owner('model_needs_owner');
  if (answer.status === 'off_topic') return { status: 'off_topic', decidedBy: 'model_off_topic', kept, dropped };
  if (kept.length === 0) return owner('no_sources');
  if (findOwnerKeyword(answer.reply)) return owner('keyword_reply');
  if (unknownContactDetail(answer.reply, contacts)) return owner('contact_detail');
  return { status: 'answered', decidedBy: 'answered', kept, dropped };
}
