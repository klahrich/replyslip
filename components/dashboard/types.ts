/** Response shapes of the /api/v1 routes, as documented in docs/API.md. */

export type SecretMask = { set: boolean; last4: string | null };

export type Delivery = {
  mode: 'none' | 'webhook' | 'local' | 'herdr';
  driver: string | null;
  target: string | null;
  /** scheme://host only. The path is not returned. */
  url: string | null;
  url_set: boolean;
  url_path_last4: string | null;
  auth_type: string | null;
  secret_set: boolean;
  token: SecretMask;
  secret: SecretMask;
  headers: { name: string; value: SecretMask }[];
  /** Deprecated alias of `target` for local delivery. */
  pane: string | null;
};

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  revoked_at: string | null;
  /** True when other workspaces can reach it at @handle/name. */
  shared?: boolean;
  delivery: Delivery;
  last_delivered_at?: string | null;
  last_failed_at?: string | null;
  last_error?: string | null;
  /** Local agents only. Null for webhook and none. */
  watcher_last_seen_at?: string | null;
  watcher_online?: boolean;
};

export type AgentKey = {
  id: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

export type NewAgentKey = { id: string; prefix: string; created_at: string; secret: string };

export type JoinCode = {
  id: string;
  prefix: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  consumed_by_agent_id: string | null;
  status: 'pending' | 'consumed' | 'revoked' | 'expired';
  secret?: string;
};

export type TaskStatus = 'open' | 'done' | 'needs_info' | 'failed';

export type Task = {
  id: string;
  from: string;
  to: string;
  from_agent_id: string;
  to_agent_id: string;
  title: string;
  description: string;
  result_schema: unknown;
  status: TaskStatus;
  result: unknown;
  question: string | null;
  fail_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type Message = {
  id: string;
  from: string;
  to: string;
  from_agent_id: string;
  to_agent_id: string;
  body: string;
  task_id: string | null;
  created_at: string;
};

/** POST /api/v1/agents/:id/test-wake. Webhook answers inline; local leaves the wake pending for the watcher. */
export type TestWakeResult =
  | { ok: boolean; wake_id: string; status_code?: number; error?: string; pending?: undefined }
  | { ok: true; pending: true; wake_id: string };

export type WakeStatus = 'pending' | 'delivered' | 'failed' | 'cancelled';

export type Wake = {
  id: string;
  agent_id: string;
  status: WakeStatus;
  reason: string;
  task_id: string | null;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type WatcherKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  last_seen_at?: string | null;
};

export type NewWatcherKey = { id: string; name: string; prefix: string; created_at: string; secret: string };

/** GET /api/v1/agents/:id/shares. One guest workspace's grant on a shared agent. */
export type ShareStatus = 'pending' | 'approved' | 'revoked';

export type Share = {
  id: string;
  agent_id: string;
  guest_workspace_id: string;
  /** Null when the guest workspace has cleared its handle. */
  guest_handle: string | null;
  status: ShareStatus;
  daily_cap: number;
  offers: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
};

/** GET /api/v1/agents/:id/offers. A task on a shared agent's menu. */
export type Offer = { id: string; name: string; description: string; result_schema: unknown; created_at: string };
