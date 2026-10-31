import { isProductionDeployment } from './origin';

export type LoginCodeEmail = {
  to: string;
  code: string;
};

export type FirstAgentAlertEmail = {
  to: string;
  workspaceName: string;
  ownerEmail: string;
  agentName: string;
  deliveryMode: 'webhook' | 'local' | 'none';
  signupSource: string | null;
  createdAt: Date;
};

/** Owner notice for pending customer requests. Count and link only: no customer email or task text. */
export type PendingCustomersEmail = {
  to: string;
  agentName: string;
  pendingCount: number;
  dashboardUrl: string;
};

/** Owner notice for review_first requests waiting for review. Count and link only: no customer email or task text. */
export type ReviewNeededEmail = {
  to: string;
  agentName: string;
  waitingCount: number;
  reviewUrl: string;
};

/** Valetto early-access request. Every field but `to` is submitter input; the body is plain text. */
export type EarlyAccessNoticeEmail = {
  to: string;
  /** The submitter's address. Sent as Reply-To, never as From. */
  replyTo: string;
  name: string;
  business: string;
  website: string | null;
  industry: string;
  teamSize: string;
  usesGrokBot: string;
  customerJobs: string;
  heardFrom: string | null;
  createdAt: Date;
};

export interface EmailSender {
  sendLoginCode(message: LoginCodeEmail): Promise<void>;
  sendFirstAgentAlert(message: FirstAgentAlertEmail): Promise<void>;
  sendPendingCustomers(message: PendingCustomersEmail): Promise<void>;
  sendEarlyAccessNotice(message: EarlyAccessNoticeEmail): Promise<void>;
  sendReviewNeeded(message: ReviewNeededEmail): Promise<void>;
}

const GENERIC_SUBJECT = 'Your ReplySlip sign-in code';
const FIRST_AGENT_SUBJECT = 'ReplySlip: first agent';
const PENDING_CUSTOMERS_SUBJECT = 'New customer requests are waiting';
const REVIEW_NEEDED_SUBJECT = 'Requests are waiting for your review';

export function reviewNeededText(message: Omit<ReviewNeededEmail, 'to'>): string {
  const n = message.waitingCount;
  return [
    `${n} ${n === 1 ? 'item is' : 'items are'} waiting for your review on ${message.agentName}.`,
    '',
    `Review them: ${message.reviewUrl}`,
    '',
    'Your bot cannot see a new request until you approve it, and customers see no answer until you release it.',
    '',
    "You get at most one of these emails per hour per bot. Turn them off in the bot's review settings.",
  ].join('\n');
}

export function pendingCustomersText(message: Omit<PendingCustomersEmail, 'to'>): string {
  const n = message.pendingCount;
  return [
    `${n} ${n === 1 ? 'customer is' : 'customers are'} waiting for your approval on ${message.agentName}.`,
    '',
    `Review them in your dashboard: ${message.dashboardUrl}`,
    '',
    'You get at most one of these emails per hour per bot. Turn them off in the bot\'s Customers settings.',
  ].join('\n');
}

export function loginCodeText(code: string): string {
  return [
    `Your ReplySlip sign-in code is ${code}.`,
    '',
    'It expires in 10 minutes. If you did not ask to sign in, you can ignore this email.',
  ].join('\n');
}

export function firstAgentAlertText(message: Omit<FirstAgentAlertEmail, 'to'>): string {
  return [
    'A workspace registered its first agent.',
    '',
    `Workspace: ${message.workspaceName}`,
    `Owner: ${message.ownerEmail}`,
    `Agent: ${message.agentName}`,
    `Delivery: ${message.deliveryMode}`,
    `Signup source: ${message.signupSource ?? 'none'}`,
    `Time (UTC): ${message.createdAt.toISOString()}`,
  ].join('\n');
}

/** One line, no control characters, so submitter text cannot add header-like lines to a subject. */
function singleLine(value: string, max: number): string {
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// Bidi controls and zero-width characters: they can reorder or hide text in a mail client's subject line.
const INVISIBLE = /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export function earlyAccessSubject(message: Pick<EarlyAccessNoticeEmail, 'business'>): string {
  return `Valetto early access: ${singleLine(message.business.replace(INVISIBLE, ''), 80)}`;
}

const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * One plain address, safe as a Reply-To: printable ASCII only (so no whitespace, bidi or zero-width characters),
 * no `,` `;` `<` `>` `"`, exactly one `@`, a dot-atom local part and a hostname with a letter TLD.
 */
export function isStrictEmailAddress(value: string): boolean {
  if (value.length > 254 || !/^[\x21-\x7e]+$/.test(value) || /[,;<>"]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length > 64 || !EMAIL_LOCAL.test(local)) return false;
  if (domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => EMAIL_LABEL.test(label))) return false;
  return /^[A-Za-z]{2,63}$/.test(labels[labels.length - 1]!);
}

export function earlyAccessNoticeText(message: Omit<EarlyAccessNoticeEmail, 'to'>): string {
  return [
    'New Valetto early-access request. Reply to this email to answer the sender.',
    '',
    `Name: ${singleLine(message.name, 200)}`,
    `Email: ${singleLine(message.replyTo, 300)}`,
    `Business: ${singleLine(message.business, 200)}`,
    `Website: ${message.website === null ? 'none' : singleLine(message.website, 300)}`,
    `Industry: ${message.industry}`,
    `Team size: ${message.teamSize}`,
    `Uses Grok Bot: ${message.usesGrokBot}`,
    `Heard from: ${message.heardFrom === null ? 'none' : singleLine(message.heardFrom, 300)}`,
    `Time (UTC): ${message.createdAt.toISOString()}`,
    '',
    'What would your customers ask your bot to do?',
    message.customerJobs,
  ].join('\n');
}

class ConsoleEmailSender implements EmailSender {
  async sendLoginCode(message: LoginCodeEmail): Promise<void> {
    console.info(`[replyslip] sign-in code for ${message.to}: ${message.code}`);
  }

  async sendFirstAgentAlert(message: FirstAgentAlertEmail): Promise<void> {
    console.info(`[replyslip] first-agent alert for ${message.to}\n${firstAgentAlertText(message)}`);
  }

  async sendPendingCustomers(message: PendingCustomersEmail): Promise<void> {
    console.info(`[replyslip] pending-customers notice\n${pendingCustomersText(message)}`);
  }

  async sendReviewNeeded(message: ReviewNeededEmail): Promise<void> {
    console.info(`[replyslip] review-needed notice\n${reviewNeededText(message)}`);
  }

  async sendEarlyAccessNotice(message: EarlyAccessNoticeEmail): Promise<void> {
    console.info(`[replyslip] Valetto early-access notice for ${message.to}\n${earlyAccessNoticeText(message)}`);
  }
}

/** Production without RESEND_API_KEY: every send fails, so nothing is silently logged instead of emailed. */
class UnconfiguredEmailSender implements EmailSender {
  private fail(label: string): never {
    throw new Error(`RESEND_API_KEY is not set in production; the ${label} was not sent.`);
  }

  async sendLoginCode(): Promise<void> {
    this.fail('sign-in email');
  }

  async sendFirstAgentAlert(): Promise<void> {
    this.fail('first-agent alert');
  }

  async sendPendingCustomers(): Promise<void> {
    this.fail('pending-customers notice');
  }

  async sendEarlyAccessNotice(): Promise<void> {
    this.fail('Valetto early-access notice');
  }

  async sendReviewNeeded(): Promise<void> {
    this.fail('review-needed notice');
  }
}

export const RESEND_TIMEOUT_MS = 10_000;
let resendTimeoutMs = RESEND_TIMEOUT_MS;

/** Tests shorten the Resend timeout; null restores the default. */
export function setResendTimeoutForTests(ms: number | null): void {
  resendTimeoutMs = ms ?? RESEND_TIMEOUT_MS;
}

class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendLoginCode(message: LoginCodeEmail): Promise<void> {
    await this.post(message.to, GENERIC_SUBJECT, loginCodeText(message.code), 'sign-in email');
  }

  async sendFirstAgentAlert(message: FirstAgentAlertEmail): Promise<void> {
    await this.post(message.to, FIRST_AGENT_SUBJECT, firstAgentAlertText(message), 'first-agent alert');
  }

  async sendPendingCustomers(message: PendingCustomersEmail): Promise<void> {
    await this.post(message.to, PENDING_CUSTOMERS_SUBJECT, pendingCustomersText(message), 'pending-customers notice');
  }

  async sendReviewNeeded(message: ReviewNeededEmail): Promise<void> {
    await this.post(message.to, REVIEW_NEEDED_SUBJECT, reviewNeededText(message), 'review-needed notice');
  }

  async sendEarlyAccessNotice(message: EarlyAccessNoticeEmail): Promise<void> {
    await this.post(
      message.to,
      earlyAccessSubject(message),
      earlyAccessNoticeText(message),
      'Valetto early-access notice',
      message.replyTo,
    );
  }

  private async post(to: string, subject: string, text: string, label: string, replyTo?: string): Promise<void> {
    if (replyTo !== undefined && !isStrictEmailAddress(replyTo)) {
      throw new Error(`Refusing to send the ${label}: the reply-to is not a single plain email address.`);
    }
    // Bounded, so a hung Resend call cannot hold the caller's transaction and advisory lock.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(resendTimeoutMs),
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject,
        text,
        ...(replyTo ? { reply_to: [replyTo] } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the ${label} (HTTP ${response.status}).`);
    }
  }
}

let testSender: EmailSender | null = null;

/** Tests inject a sender so codes are captured without reading the log. */
export function setEmailSenderForTests(sender: EmailSender | null): void {
  testSender = sender;
}

export function getEmailSender(): EmailSender {
  if (testSender) return testSender;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return isProductionDeployment() ? new UnconfiguredEmailSender() : new ConsoleEmailSender();
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set');
  }
  return new ResendEmailSender(apiKey, from);
}
