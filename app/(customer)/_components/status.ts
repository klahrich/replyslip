import type { FailCode, RequestStatus } from '../_lib/types';

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
      return { badge: 'Answer in review', title: `${name} is checking the answer`, body: `${name} checks each answer before you see it. You can close this page.`, tone: 'neutral' };
    case 'done':
      return { badge: 'Done', title: 'Done', body: '', tone: 'success' };
    case 'failed':
      return { badge: 'Not completed', title: "This request wasn't completed", body: '', tone: 'danger' };
  }
}

/** Section 17.5: customer copy per `fail_code`. `fail_message` (bot text) is shown separately, as plain text. */
export function failCopy(code: FailCode | null, name: string): { title: string; body: string } {
  switch (code) {
    case 'declined_by_owner':
      return { title: `${name} declined this request`, body: `If you have questions, contact ${name} directly.` };
    case 'expired':
      return { title: 'This request timed out', body: `${name} didn't finish it in time. Send it again if you still need it.` };
    case 'bot_failed':
    default:
      return { title: "This request wasn't completed", body: `Something went wrong on ${name}'s side. Try sending it again.` };
  }
}
