import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** free or unlimited. A person sets unlimited with one UPDATE; the app does not name that workspace. */
    plan: text('plan').notNull().default('free'),
    /** Public address for shared agents: @handle/agentname. Null until the workspace sets one. */
    handle: text('handle'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('workspaces_plan_check', sql`${table.plan} in ('free', 'unlimited')`),
    uniqueIndex('workspaces_handle_unique').on(table.handle).where(sql`${table.handle} is not null`),
    check('workspaces_handle_check', sql`${table.handle} is null or ${table.handle} ~ '^[a-z][a-z0-9-]{1,31}$'`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    email: text('email').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    /** Explicit marketing consent. Stays false until a person opts in; nothing pre-checks it. */
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    /** When the current consent was given. Kept after unsubscribe as proof. */
    marketingConsentAt: ts('marketing_consent_at'),
    /** Exact checkbox wording the person agreed to. */
    marketingConsentText: text('marketing_consent_text'),
    /** When they withdrew consent. Null while they are opted in. */
    marketingUnsubscribedAt: ts('marketing_unsubscribed_at'),
    /** Set once, on the request that creates the user. Later sign-ins do not replace it. */
    signupSource: text('signup_source'),
    /** Signed up wanting agent sharing (e.g. via ?ref=sharing). Informational only; does not gate sharing. Set by request-code; once true, never cleared by it. */
    wantsSharing: boolean('wants_sharing').notNull().default(false),
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
    localDriver: text('local_driver'),
    localTarget: text('local_target'),
    revokedAt: ts('revoked_at'),
    /** When true, other workspaces can be granted tasks to this agent at @handle/name. */
    shared: boolean('shared').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agents_workspace_name_unique').on(table.workspaceId, table.name),
    check('agents_delivery_mode_check', sql`${table.deliveryMode} in ('none', 'webhook', 'herdr', 'local')`),
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
    /** Set on each successful watcher poll. Ack does not update it. */
    lastSeenAt: ts('last_seen_at'),
  },
  (table) => [uniqueIndex('watcher_keys_token_hash_unique').on(table.tokenHash)],
);

export const agentOffers = pgTable(
  'agent_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    resultSchema: jsonb('result_schema').$type<Record<string, unknown>>().notNull(),
    /** Optional form a guest fills in (normalized profile schema). Null = free-text offer. */
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>(),
    /** Whether a guest may add notes (tasks.description) to a form task. Only false with input_schema set. */
    notesEnabled: boolean('notes_enabled').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_offers_agent_name_unique').on(table.agentId, table.name),
    check('agent_offers_name_check', sql`${table.name} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check('agent_offers_notes_check', sql`${table.notesEnabled} or ${table.inputSchema} is not null`),
  ],
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
    /** Workspace that sent the task. Null on rows created before sharing existed. */
    fromWorkspaceId: uuid('from_workspace_id').references(() => workspaces.id),
    /** Set when the task used a shared-agent offer. The stored result_schema is a copy of that offer. */
    offerId: uuid('offer_id').references(() => agentOffers.id),
    /** Copy of the offer input_schema when the task was created. Set together with input. */
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>(),
    /** The guest's form fields, already validated against inputSchema. */
    input: jsonb('input').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (table) => [
    check('tasks_status_check', sql`${table.status} in ('open', 'done', 'needs_info', 'failed')`),
    check('tasks_input_pair_check', sql`(${table.input} is null) = (${table.inputSchema} is null)`),
    index('tasks_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('tasks_to_agent_idx').on(table.toAgentId, table.status),
    index('tasks_from_agent_idx').on(table.fromAgentId, table.status),
    index('tasks_from_workspace_idx').on(table.fromWorkspaceId, table.createdAt),
  ],
);

export const agentShares = pgTable(
  'agent_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    guestWorkspaceId: uuid('guest_workspace_id')
      .notNull()
      .references(() => workspaces.id),
    status: text('status').notNull().default('pending'),
    dailyCap: integer('daily_cap').notNull().default(50),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_shares_agent_guest_unique').on(table.agentId, table.guestWorkspaceId),
    check('agent_shares_status_check', sql`${table.status} in ('pending', 'approved', 'revoked')`),
    check('agent_shares_daily_cap_check', sql`${table.dailyCap} >= 1 and ${table.dailyCap} <= 10000`),
  ],
);

export const agentShareOffers = pgTable(
  'agent_share_offers',
  {
    shareId: uuid('share_id')
      .notNull()
      .references(() => agentShares.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => agentOffers.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.shareId, table.offerId] })],
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
      sql`${table.reason} in ('message', 'task', 'result', 'question', 'failure', 'test')`,
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
