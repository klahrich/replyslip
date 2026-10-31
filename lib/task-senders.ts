import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '@/db';
import { agentShares, agents, tasks, users, workspaces, type TaskRow } from '@/db/schema';

/**
 * Who sent a task, for the owner. Same shape as a review's `sender`. A customer is known by the email they
 * signed in with (the share's requested_by user); an agent by its workspace handle and name.
 */
export type TaskSender = {
  kind: 'customer' | 'agent';
  customer_email: string | null;
  workspace_handle: string | null;
  agent_name: string | null;
};

/**
 * Senders for these tasks as `viewerWorkspaceId` may see them. customer_email is set only when the viewer owns the
 * task (the bot's workspace). Cookie routes only: never pass this to a bot, an agent tool, or the sender.
 */
export async function sendersFor(db: Db, rows: TaskRow[], viewerWorkspaceId: string): Promise<Map<string, TaskSender>> {
  const out = new Map<string, TaskSender>();
  if (rows.length === 0) return out;
  const fromAgent = alias(agents, 'from_agent');
  const fromWorkspace = alias(workspaces, 'from_workspace');
  const found = await db
    .select({
      id: tasks.id,
      ownerWorkspaceId: tasks.workspaceId,
      fromName: fromAgent.name,
      fromRole: fromAgent.role,
      fromHandle: fromWorkspace.handle,
      customerEmail: users.email,
    })
    .from(tasks)
    .innerJoin(fromAgent, eq(fromAgent.id, tasks.fromAgentId))
    .leftJoin(fromWorkspace, eq(fromWorkspace.id, tasks.fromWorkspaceId))
    .leftJoin(
      agentShares,
      and(eq(agentShares.agentId, tasks.toAgentId), eq(agentShares.guestWorkspaceId, tasks.fromWorkspaceId)),
    )
    .leftJoin(users, and(eq(users.id, agentShares.requestedByUserId), eq(fromAgent.role, 'customer_sender')))
    .where(inArray(tasks.id, rows.map((row) => row.id)));
  for (const row of found) {
    const customer = row.fromRole === 'customer_sender';
    const ownerSide = row.ownerWorkspaceId === viewerWorkspaceId;
    out.set(row.id, {
      kind: customer ? 'customer' : 'agent',
      customer_email: customer && ownerSide ? (row.customerEmail ?? null) : null,
      workspace_handle: customer ? null : (row.fromHandle ?? null),
      agent_name: customer ? null : row.fromName,
    });
  }
  return out;
}

/**
 * The customer to email about a customer-sent task: the verified user who opened the share. Null for agent senders,
 * in-workspace tasks, and a share with no known verified user.
 */
export async function customerRecipientFor(db: Db, task: TaskRow): Promise<{ userId: string; email: string } | null> {
  if (!task.fromWorkspaceId || task.fromWorkspaceId === task.workspaceId) return null;
  const [row] = await db
    .select({ userId: users.id, email: users.email })
    .from(agents)
    .innerJoin(
      agentShares,
      and(eq(agentShares.agentId, task.toAgentId), eq(agentShares.guestWorkspaceId, task.fromWorkspaceId)),
    )
    .innerJoin(users, eq(users.id, agentShares.requestedByUserId))
    .where(
      and(
        eq(agents.id, task.fromAgentId),
        eq(agents.role, 'customer_sender'),
        eq(agents.workspaceId, task.fromWorkspaceId),
        eq(users.workspaceId, task.fromWorkspaceId),
        sql`${users.emailVerifiedAt} is not null`,
      ),
    )
    .limit(1);
  return row ?? null;
}
