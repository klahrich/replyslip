import {
  setEmailSenderForTests,
  type EarlyAccessNoticeEmail,
  type FirstAgentAlertEmail,
  type LoginCodeEmail,
  type PendingCustomersEmail,
} from '@/lib/email';
import { installChainedFirstAgentAlertsForTests } from '@/lib/first-agent-alert';

export const inbox: LoginCodeEmail[] = [];
export const alerts: FirstAgentAlertEmail[] = [];
export const pendingNotices: PendingCustomersEmail[] = [];
export const earlyAccessNotices: EarlyAccessNoticeEmail[] = [];

export function installInbox(): void {
  inbox.length = 0;
  alerts.length = 0;
  pendingNotices.length = 0;
  earlyAccessNotices.length = 0;
  installChainedFirstAgentAlertsForTests();
  setEmailSenderForTests({
    async sendLoginCode(message) {
      inbox.push(message);
    },
    async sendFirstAgentAlert(message) {
      alerts.push(message);
    },
    async sendPendingCustomers(message) {
      pendingNotices.push(message);
    },
    async sendEarlyAccessNotice(message) {
      earlyAccessNotices.push(message);
    },
  });
}

export function latestCode(email: string): string {
  const found = [...inbox].reverse().find((message) => message.to === email.toLowerCase());
  if (!found) throw new Error(`No sign-in code was sent to ${email}`);
  return found.code;
}
