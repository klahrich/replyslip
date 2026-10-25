import { POST as createKeyRoute } from '@/app/api/v1/agents/[id]/keys/route';
import { POST as revokeKeyRoute } from '@/app/api/v1/agents/[id]/keys/[keyId]/revoke/route';
import { POST as revokeWatcherRoute } from '@/app/api/v1/watcher-keys/[id]/revoke/route';
import { POST as createWatcherRoute } from '@/app/api/v1/watcher-keys/route';
import { POST as mcp } from '@/app/api/mcp/route';
import {
  AGENT_AUTH_MISSING,
  AGENT_AUTH_NOT_BEARER,
  AGENT_AUTH_REVOKED,
  AGENT_AUTH_REVOKED_WATCHER,
  AGENT_AUTH_UNKNOWN,
  AGENT_AUTH_WATCHER_KEY,
  agentAuthErrorDescription,
  replaceWwwAuthenticateDescription,
} from '@/lib/agent-auth-error';
import { apiReferenceMarkdown, skillMarkdown } from '@/lib/agent-docs';
import { describe, expect, it } from 'vitest';
import { call, createAgent, mcpListTools, signIn } from './helpers';

const CANARY = 'CANARY_do_not_echo_9f3a';

function mcpRequest(authorization?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
}

async function rejected(authorization?: string) {
  const res = await mcp(mcpRequest(authorization));
  const text = await res.text();
  const data = JSON.parse(text) as { error?: string; error_description?: string };
  return { res, text, data, challenge: res.headers.get('www-authenticate') ?? '' };
}

describe('agent auth error descriptions', () => {
  it('describes each rejected credential and never returns the token', () => {
    expect(agentAuthErrorDescription(null)).toBe(AGENT_AUTH_MISSING);
    expect(agentAuthErrorDescription(`Basic ${CANARY}`)).toBe(AGENT_AUTH_NOT_BEARER);
    expect(agentAuthErrorDescription(`Bearer rsw_${CANARY}`)).toBe(AGENT_AUTH_WATCHER_KEY);
    expect(agentAuthErrorDescription(`Bearer rsk_${CANARY}`)).toBe(AGENT_AUTH_UNKNOWN);
    expect(agentAuthErrorDescription(`Bearer ${CANARY}`)).toBe(AGENT_AUTH_UNKNOWN);
    expect(agentAuthErrorDescription(`Bearer rsk_${CANARY}`, { agentKeyRevoked: true, watcherKeyRevoked: false })).toBe(
      AGENT_AUTH_REVOKED,
    );
    expect(agentAuthErrorDescription(`Bearer rsw_${CANARY}`, { agentKeyRevoked: false, watcherKeyRevoked: true })).toBe(
      AGENT_AUTH_REVOKED_WATCHER,
    );
    for (const description of [
      AGENT_AUTH_MISSING,
      AGENT_AUTH_NOT_BEARER,
      AGENT_AUTH_WATCHER_KEY,
      AGENT_AUTH_REVOKED,
      AGENT_AUTH_REVOKED_WATCHER,
      AGENT_AUTH_UNKNOWN,
    ]) {
      expect(description).not.toContain(CANARY);
    }

    const challenge = replaceWwwAuthenticateDescription(
      'Bearer error="invalid_token", error_description="No authorization provided", resource_metadata="https://replyslip.test/.well-known/oauth-protected-resource"',
      AGENT_AUTH_WATCHER_KEY,
    );
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`error_description="${AGENT_AUTH_WATCHER_KEY}"`);
    expect(challenge).toContain('resource_metadata="https://replyslip.test/.well-known/oauth-protected-resource"');
  });

  it('documents each description in the skill and the API reference', () => {
    const skill = skillMarkdown('https://replyslip.test');
    const api = apiReferenceMarkdown('https://replyslip.test');
    expect(skill).toContain('## Troubleshooting');
    for (const description of [
      AGENT_AUTH_MISSING,
      AGENT_AUTH_NOT_BEARER,
      AGENT_AUTH_WATCHER_KEY,
      AGENT_AUTH_REVOKED,
      AGENT_AUTH_REVOKED_WATCHER,
      AGENT_AUTH_UNKNOWN,
    ]) {
      expect(skill).toContain(description);
      expect(api).toContain(description);
    }
  });

  it('returns a distinct 401 description for each MCP credential failure', async () => {
    const missing = await rejected();
    expect(missing.res.status).toBe(401);
    expect(missing.data).toEqual({ error: 'invalid_token', error_description: AGENT_AUTH_MISSING });
    expect(missing.challenge).toContain('error="invalid_token"');
    expect(missing.challenge).toContain(`error_description="${AGENT_AUTH_MISSING}"`);
    expect(missing.challenge).toContain('resource_metadata=');

    const basic = await rejected(`Basic ${CANARY}`);
    expect(basic.data.error_description).toBe(AGENT_AUTH_NOT_BEARER);
    expect(basic.text).not.toContain(CANARY);
    expect(basic.challenge).not.toContain(CANARY);
    expect(basic.challenge).toContain('error="invalid_token"');

    const raw = await rejected(`rsk_${CANARY}`);
    expect(raw.data.error_description).toBe(AGENT_AUTH_NOT_BEARER);
    expect(raw.text).not.toContain(CANARY);

    const watcher = await rejected(`Bearer rsw_${CANARY}`);
    expect(watcher.data.error_description).toBe(AGENT_AUTH_WATCHER_KEY);
    expect(watcher.text).not.toContain(CANARY);
    expect(watcher.challenge).not.toContain(CANARY);
    expect(watcher.challenge).toContain('resource_metadata=');

    const unknown = await rejected(`Bearer rsk_${CANARY}`);
    expect(unknown.data.error_description).toBe(AGENT_AUTH_UNKNOWN);
    expect(unknown.text).not.toContain(CANARY);
    expect(unknown.challenge).not.toContain(CANARY);

    const other = await rejected(`Bearer ${CANARY}`);
    expect(other.data.error_description).toBe(AGENT_AUTH_UNKNOWN);
    expect(other.text).not.toContain(CANARY);
  });

  it('uses the invalid-key description for a revoked agent key and still accepts a live key', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'AuthBot');
    const created = await call(createKeyRoute, `http://localhost/api/v1/agents/${agent.id}/keys`, {
      cookie: session.cookie,
      params: { id: agent.id },
    });
    expect(created.status).toBe(201);
    const secret = created.data.key.secret as string;
    const listed = await mcpListTools(secret);
    expect(listed.length).toBeGreaterThan(0);

    const revoked = await call(revokeKeyRoute, `http://localhost/api/v1/agents/${agent.id}/keys/${created.data.key.id}/revoke`, {
      cookie: session.cookie,
      params: { id: agent.id, keyId: created.data.key.id },
    });
    expect(revoked.status).toBe(200);

    const rejectedKey = await rejected(`Bearer ${secret}`);
    expect(rejectedKey.res.status).toBe(401);
    expect(rejectedKey.data).toEqual({ error: 'invalid_token', error_description: AGENT_AUTH_REVOKED });
    expect(rejectedKey.text).not.toContain(secret.slice('rsk_'.length));
    expect(rejectedKey.challenge).not.toContain(secret.slice('rsk_'.length));
  });

  it('says a watcher key was revoked only when its hash matches a revoked row', async () => {
    const session = await signIn();
    const created = await call(createWatcherRoute, 'http://localhost/api/v1/watcher-keys', {
      cookie: session.cookie,
      body: { name: 'local' },
    });
    expect(created.status).toBe(201);
    const secret = created.data.watcher_key.secret as string;
    expect(secret.startsWith('rsw_')).toBe(true);

    const live = await rejected(`Bearer ${secret}`);
    expect(live.data.error_description).toBe(AGENT_AUTH_WATCHER_KEY);
    expect(live.text).not.toContain(secret.slice('rsw_'.length));

    const revoked = await call(revokeWatcherRoute, `http://localhost/api/v1/watcher-keys/${created.data.watcher_key.id}/revoke`, {
      cookie: session.cookie,
      params: { id: created.data.watcher_key.id },
    });
    expect(revoked.status).toBe(200);

    const rejectedKey = await rejected(`Bearer ${secret}`);
    expect(rejectedKey.res.status).toBe(401);
    expect(rejectedKey.data).toEqual({ error: 'invalid_token', error_description: AGENT_AUTH_REVOKED_WATCHER });
    expect(rejectedKey.text).not.toContain(secret.slice('rsw_'.length));
    expect(rejectedKey.challenge).not.toContain(secret.slice('rsw_'.length));
    expect(rejectedKey.challenge).toContain('error="invalid_token"');
  });
});
