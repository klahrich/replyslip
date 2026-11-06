import { authenticateAgentKey, type AgentPrincipal } from './agents';
import { agentGuestsEnabled } from './constants';
import { HttpError } from './errors';
import { bearerToken } from './http';
import { authenticateInviteBearer } from './invites';
import { clientIp } from './origin';

/** Tools an invite-link guest may call. Owner, sharing, and "do the work" tools are absent. */
export const EXTERNAL_GUEST_TOOLS = new Set([
  'whoami',
  'get_agent_card',
  'create_task',
  'get_task',
  'list_tasks',
  'answer_task',
]);

export const EXTERNAL_GUEST_DENIED =
  'This link can only use the tasks it was granted, and the results of those tasks.';

export function externalToolAllowed(name: string, externalGuest: boolean): boolean {
  return !externalGuest || EXTERNAL_GUEST_TOOLS.has(name);
}

/**
 * Bearer for the external HTTP fallback. A single-use invite token, or the guest key redeem
 * returned for a multi-use link. A normal agent key is rejected.
 */
export async function requireExternalCaller(req: Request): Promise<AgentPrincipal> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'unauthorized', 'Send the invite token as Authorization: Bearer.');
  if (token.startsWith('rsi_')) {
    if (!agentGuestsEnabled()) throw new HttpError(404, 'not_found', 'Not found.');
    const caller = await authenticateInviteBearer(token, clientIp(req));
    if (!caller) {
      throw new HttpError(
        401,
        'unauthorized',
        'This invite link is not a usable credential. It may have been revoked, or it admits more than one agent and must be redeemed.',
      );
    }
    return caller;
  }
  if (token.startsWith('rsk_')) {
    const caller = await authenticateAgentKey(token);
    if (!caller?.externalGuest) {
      throw new HttpError(403, 'insufficient_scope', 'This route accepts an invite link or the guest key from redeem.');
    }
    return caller;
  }
  throw new HttpError(401, 'unauthorized', 'Send the invite token as Authorization: Bearer.');
}
