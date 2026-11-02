import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppCell } from '@/components/dashboard/ConnectedApps';
import {
  accessSummary,
  currentAccess,
  isElevated,
  isElevationPaused,
  PAUSED_BADGE,
  PAUSED_NOTE,
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
    elevated_paused: false,
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

  it('shows a paused note instead of the Extra access badge on an active paused connection', () => {
    const paused = app({ id: '4', ...elevated, elevated_paused: true });
    expect(isElevationPaused(paused)).toBe(true);
    expect(currentAccess(paused)).toBe('Can send tasks and read its own tasks.');
    const html = cell(paused);
    expect(html).toContain(`<span class="dash-app-paused">${PAUSED_BADGE}</span>`);
    expect(html).toContain(PAUSED_NOTE);
    expect(html).not.toContain('dash-app-elevated');
    expect(html).not.toContain('manage your workspace settings and guests');
  });

  it('never shows paused on revoked or expired connections, or when the flag is false or missing', () => {
    for (const status of ['revoked', 'expired'] as const) {
      const ended = app({ id: `5-${status}`, ...elevated, elevated_paused: true, status, revoked_at: status === 'revoked' ? '2026-10-20T15:00:00.000Z' : null });
      expect(isElevationPaused(ended)).toBe(false);
      const html = cell(ended);
      expect(html).not.toContain(PAUSED_BADGE);
      expect(html).not.toContain(PAUSED_NOTE);
      expect(html).toContain('<span class="dash-app-elevated">Extra access</span>');
    }
    const live = app({ id: '6', ...elevated, elevated_paused: false });
    expect(isElevationPaused(live)).toBe(false);
    expect(cell(live)).not.toContain(PAUSED_BADGE);
    const older: Partial<ConnectedApp> = app({ id: '7', ...elevated });
    delete older.elevated_paused;
    expect(isElevationPaused(older)).toBe(false);
    expect(cell(older as ConnectedApp)).toContain('<span class="dash-app-elevated">Extra access</span>');
  });

  it('looks as before when the API sends neither field', () => {
    const old: Partial<ConnectedApp> = app({ id: '3' });
    delete old.scopes;
    delete old.elevated;
    delete old.elevated_paused;
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
