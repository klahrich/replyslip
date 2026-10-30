import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { agents, tasks, workspaces } from '@/db/schema';
import { HttpError } from './errors';

export const PLAN_LIMITS = {
  free: { agents: 10, tasksPerMonth: 1000 },
  unlimited: { agents: null, tasksPerMonth: null },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;
export type PlanResource = 'agents' | 'tasks';

export type PlanCaps = { agents: number | null; tasksPerMonth: number | null };

/** Tests shrink the free cap. Unlimited stays unlimited. Production leaves this unset. */
let testCaps: PlanCaps | null = null;

export function usePlanLimitsForTests(caps: PlanCaps | null): void {
  testCaps = caps;
}

/**
 * Guests (customers) per shared agent on the free plan. Counts approved shares plus pending
 * invite_guest and agent-invite shares; a pending customer request counts only toward
 * MAX_PENDING_PER_BOT. Unlimited workspaces skip this.
 */
export const FREE_CUSTOMERS_PER_BOT = 250;
/** Old name, kept so existing imports and the plan_limit `guest_workspaces` wording stay stable. */
export const FREE_GUEST_WORKSPACES = FREE_CUSTOMERS_PER_BOT;

let testGuestMax: number | null = null;

export function setGuestWorkspaceLimitForTests(max: number | null): void {
  testGuestMax = max;
}

export type PlanLimitBody = {
  error: 'plan_limit';
  limit: 'agents' | 'tasks_per_month' | 'guest_workspaces';
  max: number;
  used: number;
  resets_at?: string;
  message: string;
};

export class PlanLimitError extends HttpError {
  constructor(readonly body: PlanLimitBody) {
    super(403, 'plan_limit', body.message, body);
  }
}

export function utcMonthWindow(now = new Date()): { start: Date; next: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, next };
}

export function planLimitMessage(limit: PlanLimitBody['limit'], max: number, resetsAt?: Date): string {
  const shown = max.toLocaleString('en-US');
  if (limit === 'agents') return `Free plan limit: ${shown} ${max === 1 ? 'agent' : 'agents'}.`;
  if (limit === 'guest_workspaces') {
    return `Free plan limit: ${shown} ${max === 1 ? 'customer' : 'customers'} per shared agent.`;
  }
  const day = (resetsAt ?? utcMonthWindow().next).toISOString().slice(0, 10);
  return `Free plan limit: ${shown} ${max === 1 ? 'task' : 'tasks'} per month. Resets ${day}.`;
}

function asPlan(value: string | null | undefined): PlanName {
  return value === 'unlimited' ? 'unlimited' : 'free';
}

function capsFor(plan: PlanName): PlanCaps {
  if (plan === 'unlimited') return PLAN_LIMITS.unlimited;
  return testCaps ?? PLAN_LIMITS.free;
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function countActiveAgents(db: Db, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), isNull(agents.revokedAt)));
  return asCount(row?.count);
}

async function countTasksThisMonth(db: Db, workspaceId: string, now = new Date()): Promise<number> {
  const { start, next } = utcMonthWindow(now);
  // Guest tasks are stored in the owner's workspace and charged to the sender via from_workspace_id.
  // Rows from before sharing have a null sender workspace and still count on workspace_id.
  const sentByWorkspace = or(
    eq(tasks.fromWorkspaceId, workspaceId),
    and(isNull(tasks.fromWorkspaceId), eq(tasks.workspaceId, workspaceId)),
  );
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(sentByWorkspace, gte(tasks.createdAt, start), lt(tasks.createdAt, next)));
  return asCount(row?.count);
}

/** Refuse another guest workspace when this shared agent is already at the free cap. `used` is the current pending+approved count. */
export async function assertGuestWorkspaceLimit(ownerWorkspaceId: string, used: number, db: Db = getDb()): Promise<void> {
  const [row] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ownerWorkspaceId)).limit(1);
  if (asPlan(row?.plan) === 'unlimited') return;
  const max = testGuestMax ?? FREE_GUEST_WORKSPACES;
  if (used < max) return;
  throw new PlanLimitError({
    error: 'plan_limit',
    limit: 'guest_workspaces',
    max,
    used,
    message: planLimitMessage('guest_workspaces', max),
  });
}

export type WorkspacePlanUsage = {
  plan: PlanName;
  usage: { agents: number; tasks_this_month: number };
  limits: { agents: number | null; tasks_per_month: number | null };
};

export async function workspacePlanUsage(workspaceId: string, db: Db = getDb()): Promise<WorkspacePlanUsage> {
  const [row] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const plan = asPlan(row?.plan);
  const caps = capsFor(plan);
  const agentCount = await countActiveAgents(db, workspaceId);
  const taskCount = await countTasksThisMonth(db, workspaceId);
  return {
    plan,
    usage: { agents: agentCount, tasks_this_month: taskCount },
    limits: { agents: caps.agents, tasks_per_month: caps.tasksPerMonth },
  };
}

/**
 * Refuse the next agent or task when the workspace is already at its cap.
 * Pass the insert transaction so the workspace row stays locked until that insert commits.
 */
export async function assertWithinLimit(workspaceId: string, resource: PlanResource, db: Db = getDb()): Promise<void> {
  await db.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
  const usage = await workspacePlanUsage(workspaceId, db);
  const max = resource === 'agents' ? usage.limits.agents : usage.limits.tasks_per_month;
  if (max === null) return;
  const used = resource === 'agents' ? usage.usage.agents : usage.usage.tasks_this_month;
  if (used < max) return;
  if (resource === 'agents') {
    throw new PlanLimitError({
      error: 'plan_limit',
      limit: 'agents',
      max,
      used,
      message: planLimitMessage('agents', max),
    });
  }
  const { next } = utcMonthWindow();
  throw new PlanLimitError({
    error: 'plan_limit',
    limit: 'tasks_per_month',
    max,
    used,
    resets_at: next.toISOString(),
    message: planLimitMessage('tasks_per_month', max, next),
  });
}
