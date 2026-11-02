import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppCell } from '@/components/dashboard/ConnectedApps';
import {
  accessSummary,
  isElevated,
  appHost,
  appName,
  endedAt,
  pastLabel,
  replaceConnectedApp,
  revokePath,
  revokeQuestion,
  splitConnectedApps,
  type ConnectedApp,
} from '@/components/dashboard/connected-apps';

function app(over: Partial<ConnectedApp> & { id: string }): ConnectedApp {
  return {
    client: { display_name: 'chatgpt.com', client_name: 'ChatGPT', verified: true, kind: 'cimd' },
    redirect_host: 'chatgpt.com',
    agent: { id: `agent-${over.id}`, name: 'chatgpt', revoked: false },
    scope: 'agent',
    scopes: ['agent'],
    elevated: false,
    approved_by_email: 'owner@example.com',
    created_at: '2026-10-01T15:00:00.000Z',
    last_used_at: null,
    expires_at: '2027-10-01T15:00:00.000Z',
    revoked_at: null,
    status: 'active',
    ...over,
  };
}

describe('connected apps list', () => {
  it('names a verified app plainly and an unverified one in quotes', () => {
    expect(appName(app({ id: 'a' }))).toBe('ChatGPT');
    const dcr = app({
      id: 'b',
      client: { display_name: 'Notes Helper', client_name: 'Notes Helper', verified: false, kind: 'dcr' },
      redirect_host: 'notes-helper.app',
    });
    expect(appName(dcr)).toBe('“Notes Helper”');
    expect(appHost(dcr)).toBe('notes-helper.app');
    expect(appHost(app({ id: 'c' }))).toBe('chatgpt.com');
  });

  it('keeps active connections apart from ended ones, in API order', () => {
    const list = [
      app({ id: '1' }),
      app({ id: '2', status: 'revoked' }),
      app({ id: '3' }),
      app({ id: '4', status: 'expired' }),
    ];
    const { current, past } = splitConnectedApps(list);
    expect(current.map((a) => a.id)).toEqual(['1', '3']);
    expect(past.map((a) => a.id)).toEqual(['2', '4']);
    expect(past.map((a) => pastLabel(a.status))).toEqual(['Revoked', 'Expired']);
  });

  it('says the agent stays when a connection is revoked', () => {
    expect(revokeQuestion(app({ id: '1', agent: { id: 'x', name: 'chatgpt-sales', revoked: false } }))).toBe(
      'Revoke ChatGPT? It stops working right away. The agent chatgpt-sales and its tasks stay.',
    );
  });

  it('swaps in the revoked row without moving it', () => {
    const list = [app({ id: '1' }), app({ id: '2' })];
    const next = replaceConnectedApp(list, app({ id: '1', status: 'revoked' }));
    expect(next.map((a) => [a.id, a.status])).toEqual([
      ['1', 'revoked'],
      ['2', 'active'],
    ]);
  });

  it('builds the revoke route from the id', () => {
    expect(revokePath('6f1c0f3e-0000-4000-8000-000000000001')).toBe(
      '/api/v1/connected-apps/6f1c0f3e-0000-4000-8000-000000000001/revoke',
    );
  });

  it('dates a past connection by when it was revoked, or when it expired', () => {
    expect(endedAt(app({ id: '7', status: 'revoked', revoked_at: '2026-10-20T14:00:00.000Z' }))).toBe('2026-10-20T14:00:00.000Z');
    expect(endedAt(app({ id: '8', status: 'expired' }))).toBe('2027-10-01T15:00:00.000Z');
    expect(endedAt(app({ id: '9' }))).toBeNull();
  });
});

describe('connected app access level (§5.10)', () => {
  const elevated = { scope: 'agent agent:respond agent:owner', scopes: ['agent', 'agent:respond', 'agent:owner'], elevated: true };
  const cell = (a: ConnectedApp) => renderToStaticMarkup(createElement(AppCell, { app: a }));

  it('says what the app can do in plain words, from scopes', () => {
    expect(accessSummary(app({ id: '1' }))).toBe('Can send tasks and read its own tasks.');
    expect(accessSummary(app({ id: '2', ...elevated }))).toBe(
      'Can send tasks and read its own tasks, work on tasks sent to it and manage your workspace settings and guests.',
    );
    expect(accessSummary({ scopes: ['agent', 'agent:respond'] })).toBe('Can send tasks and read its own tasks and work on tasks sent to it.');
    expect(accessSummary({ scopes: ['agent', 'something:new'] })).toBe('Can send tasks and read its own tasks.');
    expect(accessSummary({ scopes: [] })).toBeNull();
  });

  it('badges an elevated connection only', () => {
    expect(isElevated(app({ id: '1' }))).toBe(false);
    expect(isElevated(app({ id: '2', ...elevated }))).toBe(true);
    const normal = cell(app({ id: '1' }));
    expect(normal).toContain('Can send tasks and read its own tasks.');
    expect(normal).not.toContain('Extra access');
    const high = cell(app({ id: '2', ...elevated }));
    expect(high).toContain('<span class="dash-app-elevated">Extra access</span>');
    expect(high).toContain('manage your workspace settings and guests');
  });

  it('looks as before when the API sends neither field', () => {
    const old: Partial<ConnectedApp> = app({ id: '3' });
    delete old.scopes;
    delete old.elevated;
    expect(accessSummary(old)).toBeNull();
    expect(isElevated(old)).toBe(false);
    const html = cell(old as ConnectedApp);
    expect(html).not.toContain('dash-app-access');
    expect(html).not.toContain('Extra access');
    expect(html).toBe(
      '<div class="dash-app"><span class="dash-app-name">ChatGPT</span><span class="dash-muted" translate="no">chatgpt.com</span></div>',
    );
  });
});
