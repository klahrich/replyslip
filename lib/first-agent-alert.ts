import { asc, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import type { Db } from '@/db';
import { users, workspaces } from '@/db/schema';
import { getEmailSender, type FirstAgentAlertEmail } from './email';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FirstAgentNotice = Omit<FirstAgentAlertEmail, 'to'> & { workspaceId: string };

/** Comma-separated workspace UUIDs. Anything that is not a UUID is ignored. */
export function excludedWorkspaceIds(raw = process.env.STATS_EXCLUDE_WORKSPACE_IDS): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (UUID_PATTERN.test(id)) seen.add(id);
  }
  return [...seen];
}

export function isExcludedWorkspace(workspaceId: string, raw = process.env.STATS_EXCLUDE_WORKSPACE_IDS): boolean {
  return excludedWorkspaceIds(raw).includes(workspaceId.toLowerCase());
}

export function publicDeliveryMode(mode: string): FirstAgentAlertEmail['deliveryMode'] {
  if (mode === 'webhook') return 'webhook';
  if (mode === 'local' || mode === 'herdr') return 'local';
  return 'none';
}

/**
 * Count agents while holding the workspace row. `assertWithinLimit` locks that row too.
 * A second registration waits, then sees the first insert, so only one alert is queued.
 */
export async function agentCountForUpdate(tx: Db, workspaceId: string): Promise<number> {
  await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
  const rows = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from agents where workspace_id = ${workspaceId}`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function loadFirstAgentNotice(
  tx: Db,
  agent: { workspaceId: string; name: string; deliveryMode: string; createdAt: Date },
): Promise<FirstAgentNotice | null> {
  const [workspace] = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, agent.workspaceId))
    .limit(1);
  const [owner] = await tx
    .select({ email: users.email, signupSource: users.signupSource })
    .from(users)
    .where(eq(users.workspaceId, agent.workspaceId))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!workspace || !owner) return null;
  return {
    workspaceId: agent.workspaceId,
    workspaceName: workspace.name,
    ownerEmail: owner.email,
    agentName: agent.name,
    deliveryMode: publicDeliveryMode(agent.deliveryMode),
    signupSource: owner.signupSource,
    createdAt: agent.createdAt,
  };
}

/** Runs after the response. Production uses Next's `after()` so the serverless function stays alive. */
export type FirstAgentScheduler = (task: () => Promise<void>) => void;

let chain: Promise<void> = Promise.resolve();
let scheduler: FirstAgentScheduler = (task) => {
  after(task);
};

/** Tests await this when the chained scheduler is installed. */
export function flushFirstAgentAlerts(): Promise<void> {
  return chain;
}

/** Tests replace `after()` with a scheduler that does not need a Next request scope. */
export function setFirstAgentAlertSchedulerForTests(next: FirstAgentScheduler | null): void {
  scheduler =
    next ??
    ((task) => {
      after(task);
    });
}

/** Run a task after the response with the same scheduler (and test hook) as the first-agent alert. */
export function runAfterResponse(task: () => Promise<void>): void {
  // A throw after the response has no one to report to; log it so it is not an unhandled rejection.
  scheduler(async () => {
    try {
      await task();
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`[replyslip] after-response task failed: ${reason}`);
    }
  });
}

/** Queue alerts on a promise chain and reset it. `flushFirstAgentAlerts` waits for that chain. */
export function installChainedFirstAgentAlertsForTests(): void {
  chain = Promise.resolve();
  setFirstAgentAlertSchedulerForTests((task) => {
    chain = chain.then(task);
  });
}

/**
 * Schedules the send after the registration response. `createAgent` and
 * `registerAgentWithJoinCode` both call this, including when a tool on the MCP
 * route calls them. Skips when `ALERT_EMAIL` is unset or the workspace is excluded.
 * A send failure is logged and does not reject.
 */
export function queueFirstAgentAlert(notice: FirstAgentNotice): void {
  const to = process.env.ALERT_EMAIL?.trim() ?? '';
  if (!to) return;
  if (isExcludedWorkspace(notice.workspaceId)) return;
  const message: FirstAgentAlertEmail = {
    to,
    workspaceName: notice.workspaceName,
    ownerEmail: notice.ownerEmail,
    agentName: notice.agentName,
    deliveryMode: notice.deliveryMode,
    signupSource: notice.signupSource,
    createdAt: notice.createdAt,
  };
  scheduler(async () => {
    try {
      await getEmailSender().sendFirstAgentAlert(message);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`[replyslip] first-agent alert failed: ${reason}`);
    }
  });
}
