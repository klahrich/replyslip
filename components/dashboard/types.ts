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
  input_schema: Record<string, unknown> | null;
  input: Record<string, unknown> | null;
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
  /** Owner-facing name, from the invite link or the redeemer. Null for handle invites. */
  label: string | null;
  invite_id: string | null;
  /** Prefix of the invite link this guest joined with. */
  invite_prefix: string | null;
  /** How the grant started: a handle invite, an agent invite link, or a customer link. */
  source: 'handle' | 'agent_invite' | 'customer';
  customer_invite_id: string | null;
  customer_invite_prefix: string | null;
  /** The customer's sign-in email. Owner only. */
  customer_email: string | null;
  status: ShareStatus;
  daily_cap: number;
  offers: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
};

/** GET /api/v1/agents/:id/invites. An invite link on a shared agent. The token is never listed. */
export type Invite = {
  id: string;
  agent_id: string;
  prefix: string;
  label: string | null;
  offers: { id: string; name: string }[];
  daily_cap: number;
  max_uses: number;
  uses: number;
  approve_on_redeem: boolean;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
};

/** GET /api/v1/agents/:id/invites `invites`. A customer link (personal or public). The token is never listed. */
export type CustomerInvite = {
  id: string;
  agent_id: string;
  kind: 'personal' | 'public';
  prefix: string;
  label: string | null;
  email: string | null;
  all_offers: boolean;
  /** Null when all_offers is true. */
  offers: { id: string; name: string }[] | null;
  daily_cap: number;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  rotated_at: string | null;
  created_at: string;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
};

export type CustomerAccess = {
  mode: 'open_link' | 'approve_each';
  notify_pending_email: boolean;
  customer_daily_cap: number;
  preapproved_emails: string[];
  pending_count: number;
  customer_count: number;
};

export type InvitesResponse = {
  invites: CustomerInvite[];
  customer_access: CustomerAccess;
  agent_guests_enabled: boolean;
  agent_invites: Invite[];
};

export type NewCustomerInvite = { invite: CustomerInvite; token: string; url: string };

/** POST /api/v1/agents/:id/invites with kind "agent". token, url, and agent_prompt are shown once. */
export type NewInvite = { invite: Invite; token: string; url: string; agent_prompt: string };

/** GET /api/v1/agents/:id/offers. A task on a shared agent's menu. */
export type Offer = {
  id: string;
  name: string;
  description: string;
  result_schema: unknown;
  input_schema: Record<string, unknown> | null;
  notes_enabled: boolean;
  created_at: string;
};
