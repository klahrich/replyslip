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

export interface EmailSender {
  sendLoginCode(message: LoginCodeEmail): Promise<void>;
  sendFirstAgentAlert(message: FirstAgentAlertEmail): Promise<void>;
  sendPendingCustomers(message: PendingCustomersEmail): Promise<void>;
}

const GENERIC_SUBJECT = 'Your ReplySlip sign-in code';
const FIRST_AGENT_SUBJECT = 'ReplySlip: first agent';
const PENDING_CUSTOMERS_SUBJECT = 'New customer requests are waiting';

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

  private async post(to: string, subject: string, text: string, label: string): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject,
        text,
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
  if (!apiKey) return new ConsoleEmailSender();
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set');
  }
  return new ResendEmailSender(apiKey, from);
}
