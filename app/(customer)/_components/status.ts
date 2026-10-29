import type { RequestStatus } from '../_lib/types';

export type Tone = 'neutral' | 'working' | 'attention' | 'success' | 'danger';

/** Customer-facing words for each request status (spec 15.7 table, plus section 16). */
export function statusCopy(status: RequestStatus, name: string): { badge: string; title: string; body: string; tone: Tone } {
  switch (status) {
    case 'in_review':
      return { badge: 'In review', title: `Waiting for ${name} to review your request`, body: 'They check each request before work starts. You can close this page.', tone: 'neutral' };
    case 'open':
      return { badge: 'Working on it', title: `Sent. ${name} is working on it.`, body: "We'll show the answer here. You can close this page.", tone: 'working' };
    case 'needs_info':
      return { badge: 'Needs your answer', title: `${name} has a question`, body: 'Answer below so they can finish your request.', tone: 'attention' };
    case 'awaiting_release':
      return { badge: 'Answer in review', title: 'Your answer is being reviewed', body: `${name} checks each answer before you see it.`, tone: 'neutral' };
    case 'done':
      return { badge: 'Done', title: 'Done', body: '', tone: 'success' };
    case 'failed':
      return { badge: 'Not completed', title: "This request wasn't completed", body: '', tone: 'danger' };
  }
}

/** `fail_reason` is bot text, except the section 16 code for an owner decline. */
export function failText(reason: string | null, name: string): string {
  if (reason === 'declined_by_owner') return `${name} declined this request.`;
  return reason || 'No reason was given.';
}
