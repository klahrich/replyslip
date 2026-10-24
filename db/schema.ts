import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    email: text('email').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash)],
);

export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: ts('consumed_at'),
    invalidatedAt: ts('invalidated_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('login_codes_email_created_idx').on(table.email, table.createdAt)],
);

export const rateEvents = pgTable(
  'rate_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    email: text('email'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('rate_events_lookup_idx').on(table.kind, table.createdAt)],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    deliveryMode: text('delivery_mode').notNull().default('none'),
    webhookUrl: text('webhook_url'),
    webhookAuthMode: text('webhook_auth_mode'),
    webhookSecretCiphertext: text('webhook_secret_ciphertext'),
    webhookHeadersCiphertext: text('webhook_headers_ciphertext'),
    herdrPane: text('herdr_pane'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agents_workspace_name_unique').on(table.workspaceId, table.name),
    check('agents_delivery_mode_check', sql`${table.deliveryMode} in ('none', 'webhook', 'herdr')`),
  ],
);

export const agentKeys = pgTable(
  'agent_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
  },
  (table) => [uniqueIndex('agent_keys_token_hash_unique').on(table.tokenHash)],
);

export const joinCodes = pgTable(
  'join_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    consumedAt: ts('consumed_at'),
    consumedByAgentId: uuid('consumed_by_agent_id').references(() => agents.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('join_codes_token_hash_unique').on(table.tokenHash),
    index('join_codes_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const watcherKeys = pgTable(
  'watcher_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
  },
  (table) => [uniqueIndex('watcher_keys_token_hash_unique').on(table.tokenHash)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    fromAgentId: uuid('from_agent_id')
      .notNull()
      .references(() => agents.id),
    toAgentId: uuid('to_agent_id')
      .notNull()
      .references(() => agents.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    resultSchema: jsonb('result_schema').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('open'),
    result: jsonb('result').$type<unknown>(),
    question: text('question'),
    failReason: text('fail_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (table) => [
    check('tasks_status_check', sql`${table.status} in ('open', 'done', 'needs_info', 'failed')`),
    index('tasks_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('tasks_to_agent_idx').on(table.toAgentId, table.status),
    index('tasks_from_agent_idx').on(table.fromAgentId, table.status),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    fromAgentId: uuid('from_agent_id')
      .notNull()
      .references(() => agents.id),
    toAgentId: uuid('to_agent_id')
      .notNull()
      .references(() => agents.id),
    body: text('body').notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('messages_task_idx').on(table.taskId, table.createdAt),
    index('messages_to_agent_idx').on(table.toAgentId, table.createdAt),
  ],
);

export const wakes = pgTable(
  'wakes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    reason: text('reason').notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    messageId: uuid('message_id').references(() => messages.id),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    deliveredAt: ts('delivered_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('wakes_status_check', sql`${table.status} in ('pending', 'delivered', 'failed', 'cancelled')`),
    check(
      'wakes_reason_check',
      sql`${table.reason} in ('message', 'task', 'result', 'question', 'failure')`,
    ),
    index('wakes_due_idx').on(table.status, table.nextAttemptAt),
  ],
);

export type AgentRow = typeof agents.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type JoinCodeRow = typeof joinCodes.$inferSelect;
