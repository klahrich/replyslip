import type { Review } from './types';

/** Fired after an owner acts on a review, so the nav badge recounts. */
export const REVIEWS_CHANGED_EVENT = 'replyslip:reviews-changed';

/** The job's display title (offer title), else the request title. */
export function jobTitle(r: Review): string {
  return r.offer?.title || r.title;
}

/** Who sent it: the customer's email, or @handle/agent for another team's agent. */
export function senderText(r: Review): string {
  if (r.sender.kind === 'customer') return r.sender.customer_email ?? 'A customer';
  const name = r.sender.agent_name ?? 'an agent';
  return r.sender.workspace_handle ? `@${r.sender.workspace_handle}/${name}` : name;
}

/**
 * One short line so list rows for the same job differ: the held question, else what the customer filled in
 * and their note. Plain text; the row clips it with CSS.
 */
export function previewText(r: Review, max = 140): string {
  const parts = r.question
    ? [`Your bot asks: ${r.question}`]
    : [...r.input_display.map((f) => `${f.label}: ${f.value}`), ...(r.notes ? [`Note: ${r.notes}`] : [])];
  const text = parts.join(' · ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Where an item stands once nobody needs to act on it. */
export function settledText(r: Review): string {
  switch (r.status) {
    case 'open':
      return 'Your bot is working on this request.';
    case 'needs_info':
      return 'Your customer has a question from your bot to answer.';
    case 'done':
      return 'Done. Your customer has the answer.';
    case 'failed':
      return 'Closed. Your customer sees that this request was not done.';
    default:
      return '';
  }
}
