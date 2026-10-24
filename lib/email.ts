export type LoginCodeEmail = {
  to: string;
  code: string;
};

export interface EmailSender {
  sendLoginCode(message: LoginCodeEmail): Promise<void>;
}

const GENERIC_SUBJECT = 'Your ReplySlip sign-in code';

export function loginCodeText(code: string): string {
  return [
    `Your ReplySlip sign-in code is ${code}.`,
    '',
    'It expires in 10 minutes. If you did not ask to sign in, you can ignore this email.',
  ].join('\n');
}

class ConsoleEmailSender implements EmailSender {
  async sendLoginCode(message: LoginCodeEmail): Promise<void> {
    console.info(`[replyslip] sign-in code for ${message.to}: ${message.code}`);
  }
}

class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendLoginCode(message: LoginCodeEmail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: GENERIC_SUBJECT,
        text: loginCodeText(message.code),
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the sign-in email (HTTP ${response.status}).`);
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
