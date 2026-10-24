/** Response shapes of the /api/v1 routes, as documented in docs/API.md. */

export type Delivery = {
  mode: 'none' | 'webhook' | 'herdr';
  url: string | null;
  auth_type: string | null;
  secret_set: boolean;
  pane: string | null;
};

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  revoked_at: string | null;
  delivery: Delivery;
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
