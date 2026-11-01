import { OAUTH_SCOPE, SCOPE_OWNER, SCOPE_RESPOND } from './config';

/**
 * §5.7: the scope each MCP tool needs. `agent` tools work for OAuth apps; `agent:respond` and `agent:owner` are held
 * only by rsk_ keys. A test lists every registered tool against this map, so a new tool must pick a scope.
 */
export const TOOL_SCOPES = {
  whoami: OAUTH_SCOPE,
  list_agents: OAUTH_SCOPE,
  get_agent_card: OAUTH_SCOPE,
  create_task: OAUTH_SCOPE,
  // Per-task check inside: OAuth apps may only message on tasks they created (ownTasksOnly).
  send_message: OAUTH_SCOPE,
  get_task: OAUTH_SCOPE,
  list_tasks: OAUTH_SCOPE,
  answer_task: OAUTH_SCOPE,
  complete_task: SCOPE_RESPOND,
  fail_task: SCOPE_RESPOND,
  ask: SCOPE_RESPOND,
  set_workspace_handle: SCOPE_OWNER,
  set_agent_sharing: SCOPE_OWNER,
  upsert_offer: SCOPE_OWNER,
  delete_offer: SCOPE_OWNER,
  invite_guest: SCOPE_OWNER,
  revoke_guest: SCOPE_OWNER,
  list_guest_shares: SCOPE_OWNER,
  redeem_invite: SCOPE_OWNER,
} as const satisfies Record<string, string>;

export type ToolName = keyof typeof TOOL_SCOPES;

export const INSUFFICIENT_SCOPE_MESSAGE = "Connected apps can't use this tool. Use an agent key or the Valetto dashboard.";
export const OWN_TASKS_ONLY_MESSAGE = 'Connected apps can only message on tasks they created.';

export function hasScope(scopes: readonly string[] | undefined, needed: string): boolean {
  return Array.isArray(scopes) && scopes.includes(needed);
}
