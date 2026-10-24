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
  delivery: Delivery;
  last_delivered_at?: string | null;
  last_failed_at?: string | null;
  last_error?: string | null;
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
