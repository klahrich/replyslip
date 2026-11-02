import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsentForm } from '@/components/site/oauth/ConsentForm';
import { ExtraScopes } from '@/components/site/oauth/ExtraScopes';
import {
  appLabel,
  CANT_HEADING_DEFAULT,
  canAllow,
  cantHeading,
  decisionBody,
  extraScopeFields,
  extraScopesOffer,
  initialSelection,
  isFollowableRedirect,
  nameProblem,
  OPENS_APP_NOTE,
  outcomeFromResponse,
  problemFromCode,
  redirectWarning,
  returningText,
  showCombinedWarning,
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
    extra_scopes: { offered: [], opt_in_field: 'grant_scopes', unverified_client: false, warning: null, combined_warning: null, connection_days: null },
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

// The copy the server serves while MCP_OAUTH_OWNER_SCOPE=1 (lib/oauth/consent.ts ELEVATED_SCOPE_COPY, PR #153).
type Offered = ConsentView['extra_scopes']['offered'];
const RESPOND: Offered[number] = {
  name: 'agent:respond',
  title: 'Work on tasks sent to it',
  allows: ['Finish tasks other agents send to it, with an answer', 'Turn down tasks sent to it, with a reason'],
  requested_by_client: false,
};
const OWNER: Offered[number] = {
  name: 'agent:owner',
  title: 'Manage your workspace settings and guests',
  allows: ['Change your workspace handle', 'Invite guests, remove them, and see who has access'],
  requested_by_client: false,
};
const UNVERIFIED_WARNING = "Valetto can't confirm who made this app. Only give it these extra permissions if you trust it.";
// The page shows whatever combined_warning the server sends; this is #153's copy.
const COMBINED = 'With both, anyone who sends this app a task could try to get it to change your sharing or guests.';

function offering(over: Record<string, unknown> = {}): ConsentView {
  return view({
    extra_scopes: {
      offered: [RESPOND, OWNER],
      opt_in_field: 'grant_scopes',
      unverified_client: false,
      warning: null,
      connection_days: 30,
      combined_warning: COMBINED,
      ...over,
    } as ConsentView['extra_scopes'],
  });
}

const render = (v: ConsentView) => renderToStaticMarkup(createElement(ConsentForm, { view: v }));
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const boxes = (html: string) => html.match(/<input type="checkbox"[^>]*>/g) ?? [];

describe('extra permissions on the Allow page (§5.10)', () => {
  it('shows nothing new when nothing is offered or the field is missing', () => {
    expect(extraScopesOffer(view())).toBeNull();
    const { extra_scopes: _omit, ...older } = view();
    void _omit;
    expect(extraScopesOffer(older as ConsentView)).toBeNull();
    const plain = render(view());
    expect(plain).not.toMatch(/extra permission/i);
    expect(boxes(plain)).toHaveLength(0);
    expect(render(older as ConsentView)).toBe(plain);
  });

  it('renders one unticked checkbox per offered scope, with what each allows and the days note', () => {
    const html = decode(render(offering()));
    const inputs = boxes(html);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).not.toMatch(/checked/);
    expect(inputs[0]).toContain('value="agent:respond"');
    expect(inputs[1]).toContain('value="agent:owner"');
    for (const item of [RESPOND, OWNER]) {
      expect(html).toContain(item.title);
      for (const line of item.allows) expect(html).toContain(line);
    }
    expect(html).toContain('With either one, this connection ends after 30 days.');
    expect(html).not.toContain('oc-warn-strong');
    expect(html).not.toContain(COMBINED); // nothing ticked yet
    expect(html).not.toContain('Requested by the app');
    expect(html.indexOf(RESPOND.title)).toBeLessThan(html.indexOf('Connect as'));
    expect(html).toMatch(/<button type="submit" class="oc-btn oc-btn-go">Allow<\/button>/);
  });

  it('handles a single offered scope', () => {
    const html = decode(render(offering({ offered: [RESPOND] })));
    expect(boxes(html)).toHaveLength(1);
    expect(html).not.toContain(OWNER.title);
    const offer = extraScopesOffer(offering({ offered: [RESPOND] }))!;
    expect(offer.combinedWarning).toBeNull();
    expect(showCombinedWarning(offer, ['agent:respond'])).toBe(false);
  });

  it('shows the combined warning only while every box is ticked', () => {
    const offer = extraScopesOffer(offering())!;
    expect(showCombinedWarning(offer, [])).toBe(false);
    expect(showCombinedWarning(offer, ['agent:respond'])).toBe(false);
    expect(showCombinedWarning(offer, ['agent:owner'])).toBe(false);
    expect(showCombinedWarning(offer, ['agent:respond', 'agent:owner'])).toBe(true);
    expect(showCombinedWarning(extraScopesOffer(offering({ combined_warning: null }))!, ['agent:respond', 'agent:owner'])).toBe(false);
  });

  it('renders the ticked boxes, and the combined warning only with both ticked', () => {
    const section = (v: ConsentView, ticked: string[]) =>
      decode(
        renderToStaticMarkup(
          createElement(ExtraScopes, { offer: extraScopesOffer(v)!, ticked, onChange: () => {}, disabled: false, id: 'x' }),
        ),
      );
    const none = section(offering(), []);
    expect(boxes(none).filter((b) => /checked/.test(b))).toHaveLength(0);
    expect(none).not.toContain(COMBINED);

    const one = section(offering(), ['agent:owner']);
    const oneBoxes = boxes(one);
    expect(oneBoxes[0]).not.toMatch(/checked/);
    expect(oneBoxes[1]).toMatch(/checked/);
    expect(one).not.toContain(COMBINED);

    const both = section(offering(), ['agent:respond', 'agent:owner']);
    expect(boxes(both).filter((b) => /checked/.test(b))).toHaveLength(2);
    expect(both).toContain(`<p class="oc-warn oc-warn-strong" role="alert">${COMBINED}</p>`);

    const bothNoWarning = section(offering({ combined_warning: null }), ['agent:respond', 'agent:owner']);
    expect(bothNoWarning).not.toContain('role="alert"');
    expect(bothNoWarning).not.toContain(COMBINED);
  });

  it('shows the warning prominently for an unverified app, and badges a scope the app asked for', () => {
    const html = decode(
      render(offering({ unverified_client: true, warning: UNVERIFIED_WARNING, offered: [{ ...RESPOND, requested_by_client: true }, OWNER] })),
    );
    expect(html).toContain(`<p class="oc-warn oc-warn-strong">${UNVERIFIED_WARNING}</p>`);
    expect(html.match(/Requested by the app/g)).toHaveLength(1);
  });

  it('keeps the custom-scheme warning next to the offer', () => {
    const cursor = { host: 'anysphere.cursor-retrieval', loopback: false, kind: 'custom_scheme' as const, scheme: 'cursor' };
    const html = decode(render({ ...offering(), redirect: cursor }));
    expect(html).toContain('This app will receive access through cursor:// on your computer.');
    expect(html).toContain(RESPOND.title);
  });

  it('builds the days note from connection_days', () => {
    expect(extraScopesOffer(offering({ connection_days: 1 }))?.daysNote).toBe('With either one, this connection ends after 1 day.');
    expect(extraScopesOffer(offering({ connection_days: null }))?.daysNote).toBeNull();
  });

  it('sends only the ticked scopes, and nothing extra when none is ticked', () => {
    const v = offering();
    const both = decisionBody(v, 'allow', { mode: 'new' }, 'chatgpt', 'ws1', ['agent:owner', 'agent:respond']);
    expect(both).toMatchObject({ decision: 'allow', grant_scopes: ['agent:respond', 'agent:owner'] });
    expect(JSON.parse(JSON.stringify(both)).grant_scopes).toEqual(['agent:respond', 'agent:owner']);
    expect(decisionBody(v, 'allow', { mode: 'new' }, 'chatgpt', 'ws1', ['agent:owner'])).toMatchObject({ grant_scopes: ['agent:owner'] });
    expect(extraScopeFields(v, ['agent:respond'])).toEqual({ grant_scopes: ['agent:respond'] });
    for (const body of [
      decisionBody(v, 'allow', { mode: 'new' }, 'chatgpt', 'ws1', []),
      decisionBody(v, 'allow', { mode: 'new' }, 'chatgpt', 'ws1'),
      decisionBody(v, 'deny', { mode: 'new' }, 'chatgpt', 'ws1', ['agent:respond']),
      decisionBody(view(), 'allow', { mode: 'new' }, 'chatgpt', 'ws1', ['agent:respond']),
      decisionBody(offering({ offered: [RESPOND] }), 'allow', { mode: 'new' }, 'chatgpt', 'ws1', ['agent:owner']),
    ]) {
      expect(body).not.toHaveProperty('grant_scopes');
      expect(body).not.toHaveProperty('grant_owner');
    }
  });
});

describe("the It can't heading", () => {
  const CANT_WITH_EXTRAS = "Without extra permissions, it can't";
  const withHeading = (v: ConsentView): ConsentView => ({ ...v, scope: { ...v.scope, cant_heading: CANT_WITH_EXTRAS } });

  it('uses scope.cant_heading from the server when it is sent', () => {
    const v = withHeading(offering());
    expect(cantHeading(v)).toBe(CANT_WITH_EXTRAS);
    const html = decode(render(v));
    expect(html).toContain(`<h2>${CANT_WITH_EXTRAS}</h2>`);
    expect(html).not.toContain(`<h2>${CANT_HEADING_DEFAULT}</h2>`);
  });

  it('keeps the page heading when cant_heading is absent or blank', () => {
    const plain = view();
    expect(plain.scope).not.toHaveProperty('cant_heading');
    expect(cantHeading(plain)).toBe(CANT_HEADING_DEFAULT);
    expect(render(plain)).toContain(`<h2>${CANT_HEADING_DEFAULT}</h2>`);
    expect(cantHeading({ scope: { ...plain.scope, cant_heading: '  ' } })).toBe(CANT_HEADING_DEFAULT);
  });
});
