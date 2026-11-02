import { describe, expect, it } from 'vitest';
import {
  appLabel,
  canAllow,
  decisionBody,
  initialSelection,
  isFollowableRedirect,
  nameProblem,
  OPENS_APP_NOTE,
  outcomeFromResponse,
  problemFromCode,
  redirectWarning,
  returningText,
} from '@/components/site/oauth/consent-logic';
import type { ConsentView } from '@/components/site/oauth/consent-types';
import { safeNextPath } from '@/components/site/oauth/next-path';

const PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}$';
const REQ = 'Q2hhdEdQVCBjb25uZWN0aW9uIHJlcXVlc3QgdG9rZW4';

function view(over: Partial<ConsentView> = {}): ConsentView {
  return {
    request_id: '9b0f6c1e-2f4a-4c55-9a51-3b8f4d0e7a21',
    csrf_token: 'csrf',
    expires_at: '2026-11-01T18:20:00.000Z',
    client: {
      display_name: 'chatgpt.com',
      client_name: 'ChatGPT',
      verified: true,
      kind: 'cimd',
      client_uri_host: 'chatgpt.com',
      logo_url: null,
    },
    redirect: { host: 'chatgpt.com', loopback: false },
    user: { email: 'karim@valetto.tech' },
    workspaces: [{ id: 'ws1', name: 'Valetto', handle: 'valetto' }],
    agent: { suggested_name: 'chatgpt', name_pattern: PATTERN, reconnect_options: [] },
    scope: { name: 'agent', allows: ['Send tasks'], denies: ['Invite guests'] },
    plan: { at_agent_limit: false, agent_limit: 10 },
    ...over,
  };
}

const reconnect = [{ id: 'ag1', name: 'chatgpt', last_connected_at: '2026-10-03T15:00:00.000Z' }];

describe('consent page logic', () => {
  it('starts on a new agent, or on reconnect when the plan is full', () => {
    expect(initialSelection(view())).toEqual({ mode: 'new' });
    expect(initialSelection(view({ agent: { ...view().agent, reconnect_options: reconnect } }))).toEqual({ mode: 'new' });
    const full = view({ plan: { at_agent_limit: true, agent_limit: 3 }, agent: { ...view().agent, reconnect_options: reconnect } });
    expect(initialSelection(full)).toEqual({ mode: 'reconnect', agentId: 'ag1' });
  });

  it('checks the agent name against the server pattern', () => {
    expect(nameProblem('chatgpt', PATTERN)).toBeNull();
    expect(nameProblem('  ', PATTERN)).toMatch(/name/);
    expect(nameProblem('2chat', PATTERN)).toMatch(/starting with a letter/);
    expect(nameProblem('chat gpt', PATTERN)).not.toBeNull();
    expect(nameProblem('chatgpt', '([')).toBeNull(); // bad pattern falls back to AGENT_NAME_PATTERN
  });

  it('only allows a new agent under the limit, and only listed reconnect choices', () => {
    expect(canAllow(view(), { mode: 'new' }, 'chatgpt')).toBe(true);
    expect(canAllow(view(), { mode: 'new' }, '')).toBe(false);
    const full = view({ plan: { at_agent_limit: true, agent_limit: 3 } });
    expect(canAllow(full, { mode: 'new' }, 'chatgpt')).toBe(false);
    const fullWithOld = view({ plan: full.plan, agent: { ...view().agent, reconnect_options: reconnect } });
    expect(canAllow(fullWithOld, { mode: 'reconnect', agentId: 'ag1' }, '')).toBe(true);
    expect(canAllow(fullWithOld, { mode: 'reconnect', agentId: 'other' }, '')).toBe(false);
  });

  it('builds the POST body: deny has no agent, allow carries the choice', () => {
    const v = view();
    expect(decisionBody(v, 'deny', { mode: 'new' }, 'chatgpt', 'ws1')).toEqual({
      request_id: v.request_id,
      csrf_token: 'csrf',
      decision: 'deny',
      workspace_id: 'ws1',
    });
    expect(decisionBody(v, 'allow', { mode: 'new' }, ' chatgpt-work ', 'ws1').agent).toEqual({
      mode: 'new',
      name: 'chatgpt-work',
    });
    expect(decisionBody(v, 'allow', { mode: 'reconnect', agentId: 'ag1' }, 'x', 'ws1').agent).toEqual({
      mode: 'reconnect',
      agent_id: 'ag1',
    });
  });

  it('names verified apps by name and host, unverified ones in quotes with the redirect host', () => {
    expect(appLabel(view())).toMatchObject({ name: 'ChatGPT', host: 'chatgpt.com', verified: true, returnsTo: null, initial: 'C' });
    const dcr = view({
      client: { display_name: 'My Helper', client_name: 'My Helper', verified: false, kind: 'dcr', client_uri_host: null, logo_url: null },
      redirect: { host: 'localhost', loopback: true },
    });
    expect(appLabel(dcr)).toMatchObject({ name: '“My Helper”', host: 'localhost', verified: false, returnsTo: null, initial: 'M' });
    expect(returningText(view())).toBe('Returning to ChatGPT…');
    expect(returningText(dcr)).toBe('Returning to the app…');
  });

  it('maps the consent POST answer to what the page does', () => {
    expect(outcomeFromResponse(200, { redirect_to: 'https://chatgpt.com/connector_platform_oauth_redirect?code=x' })).toEqual({
      kind: 'redirect',
      url: 'https://chatgpt.com/connector_platform_oauth_redirect?code=x',
    });
    expect(outcomeFromResponse(200, { redirect_to: 'javascript:alert(1)' }).kind).toBe('error');
    expect(outcomeFromResponse(410, { error: { code: 'request_expired' } })).toEqual({ kind: 'problem', problem: 'request_expired' });
    expect(outcomeFromResponse(409, { error: { code: 'request_completed' } })).toEqual({ kind: 'problem', problem: 'request_completed' });
    expect(outcomeFromResponse(409, { error: { code: 'name_taken', details: { suggested_name: 'chatgpt-2' } } })).toMatchObject({
      kind: 'error',
      suggestedName: 'chatgpt-2',
    });
    expect(outcomeFromResponse(403, { error: { code: 'binding_failed' } })).toMatchObject({ message: expect.stringMatching(/browser where you started/) });
    expect(outcomeFromResponse(403, { error: { code: 'csrf_failed' } })).toMatchObject({ message: expect.stringMatching(/Reload/) });
    expect(outcomeFromResponse(403, { error: { code: 'plan_limit', details: { limit: 'agents', max: 3 } } })).toMatchObject({
      message: expect.stringMatching(/agent limit/),
    });
    expect(outcomeFromResponse(409, { error: { code: 'agent_revoked' } })).toMatchObject({ message: expect.stringMatching(/was removed/) });
    expect(
      outcomeFromResponse(400, { error: { code: 'validation_error', details: { issues: [{ path: 'agent.agent_id', message: 'x' }] } } }),
    ).toMatchObject({ message: expect.stringMatching(/can’t be reconnected/) });
    expect(outcomeFromResponse(409, { error: { code: 'name_taken', details: { suggested_name: null } } })).toMatchObject({
      message: 'That name is taken. Pick another.',
    });
    expect(outcomeFromResponse(429, null)).toMatchObject({ code: 'rate_limited' });
    expect(outcomeFromResponse(500, null)).toMatchObject({ kind: 'error', message: 'Something went wrong. Try again.' });
    expect(problemFromCode('workspace_required')).toBe('workspace_required');
    expect(problemFromCode('csrf_failed')).toBeNull();
  });
});

describe('sign-in next path', () => {
  it('only lets the consent page through', () => {
    expect(safeNextPath(`/oauth/consent?req=${REQ}`)).toBe(`/oauth/consent?req=${REQ}`);
    for (const bad of [
      undefined,
      [`/oauth/consent?req=${REQ}`],
      '',
      '/dashboard/settings',
      `https://evil.example/oauth/consent?req=${REQ}`,
      `//evil.example/oauth/consent?req=${REQ}`,
      `/oauth/consent?req=${REQ}&x=1`,
      `/oauth/consent?req=${REQ.slice(1)}`,
      `/\\evil.example`,
      `/oauth/consent?req=${REQ}\n`,
    ]) {
      expect(safeNextPath(bad)).toBe('/dashboard');
    }
  });

  describe('desktop app redirects (cursor://, vscode://, com.example.app:/)', () => {
    const cursor = { host: 'anysphere.cursor-retrieval', loopback: false, kind: 'custom_scheme' as const, scheme: 'cursor' };
    const reverse = { host: 'com.example.app', loopback: false, kind: 'custom_scheme' as const, scheme: 'com.example.app' };
    const web = { host: 'chatgpt.com', loopback: false, kind: 'https' as const, scheme: null };
    const dcrApp = view({
      client: { display_name: 'Cursor', client_name: 'Cursor', verified: false, kind: 'dcr', client_uri_host: null, logo_url: null },
      redirect: cursor,
    });

    it('follows the app scheme after Allow and after Cancel', () => {
      const code = 'cursor://anysphere.cursor-retrieval/oauth/callback?code=abc&state=s1&iss=https%3A%2F%2Fvaletto.tech';
      const denied = 'cursor://anysphere.cursor-retrieval/oauth/callback?error=access_denied&state=s1&iss=https%3A%2F%2Fvaletto.tech';
      expect(outcomeFromResponse(200, { redirect_to: code }, cursor)).toEqual({ kind: 'redirect', url: code });
      expect(outcomeFromResponse(200, { redirect_to: denied }, cursor)).toEqual({ kind: 'redirect', url: denied });
      expect(isFollowableRedirect('com.example.app:/cb?code=abc', reverse)).toBe(true);
      expect(isFollowableRedirect('https://chatgpt.com/cb?code=abc', web)).toBe(true);
      expect(isFollowableRedirect('http://127.0.0.1:54321/cb?code=abc', { host: '127.0.0.1', loopback: true, kind: 'loopback', scheme: null })).toBe(true);
    });

    it('refuses a scheme the view did not name, and never follows script, file or browser schemes', () => {
      expect(outcomeFromResponse(200, { redirect_to: 'cursor://x/cb?code=abc' })).toMatchObject({ kind: 'error', code: 'bad_response' });
      expect(isFollowableRedirect('cursor://x/cb?code=abc', web)).toBe(false);
      expect(isFollowableRedirect('vscode://x/cb?code=abc', cursor)).toBe(false);
      for (const scheme of ['javascript', 'data', 'file', 'blob', 'about', 'vbscript', 'chrome', 'chrome-extension', 'edge', 'moz-extension', 'view-source']) {
        const url = `${scheme}:alert(1)`;
        expect(isFollowableRedirect(url, { ...cursor, scheme })).toBe(false);
        expect(outcomeFromResponse(200, { redirect_to: url }, { ...cursor, scheme }).kind).toBe('error');
      }
      expect(isFollowableRedirect('JavaScript:alert(1)', { ...cursor, scheme: 'javascript' })).toBe(false);
      expect(isFollowableRedirect('cursor://x/cb?code=a\nb', cursor)).toBe(false);
      expect(isFollowableRedirect('cursor://x/cb', { ...cursor, scheme: null })).toBe(false);
    });

    it('warns that access goes to an app on this computer, naming the scheme', () => {
      expect(redirectWarning(cursor)).toBe(
        'This app will receive access through cursor:// on your computer. Only continue if you just started this from an app you trust.',
      );
      expect(redirectWarning(reverse)).toMatch(/through com\.example\.app:\/ on your computer/);
      expect(redirectWarning({ host: 'localhost', loopback: true, kind: 'loopback', scheme: null })).toMatch(/localhost/);
      expect(redirectWarning({ host: 'localhost', loopback: true })).toMatch(/localhost/);
      expect(redirectWarning(web)).toBeNull();
      expect(OPENS_APP_NOTE).toMatch(/opens the app/);
      expect(returningText(dcrApp)).toBe('Opening the app…');
      expect(returningText(view({ redirect: cursor }))).toBe('Opening ChatGPT…');
      expect(appLabel(dcrApp)).toMatchObject({ name: '“Cursor”', verified: false });
    });
  });
});
