import { setEmailSenderForTests, type LoginCodeEmail } from '@/lib/email';

export const inbox: LoginCodeEmail[] = [];

export function installInbox(): void {
  inbox.length = 0;
  setEmailSenderForTests({
    async sendLoginCode(message) {
      inbox.push(message);
    },
  });
}

export function latestCode(email: string): string {
  const found = [...inbox].reverse().find((message) => message.to === email.toLowerCase());
  if (!found) throw new Error(`No sign-in code was sent to ${email}`);
  return found.code;
}
