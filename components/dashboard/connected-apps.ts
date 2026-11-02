/**
 * Connected apps (ChatGPT, Claude, Cursor and other MCP apps) as GET /api/v1/connected-apps returns them
 * (lib/oauth/connected-apps.ts, docs/design/mcp-oauth.md §6.4). The type is the server's; these are the dashboard's helpers around it.
 */

import type { ConnectedApp } from '@/lib/oauth/connected-apps';

export type { ConnectedApp };

export type ConnectedAppStatus = ConnectedApp['status'];

export type ConnectedAppsResponse = { connected_apps: ConnectedApp[] };

export const CONNECTED_APPS_PATH = '/api/v1/connected-apps';
export const revokePath = (id: string) => `${CONNECTED_APPS_PATH}/${encodeURIComponent(id)}/revoke`;

/** The URL people paste into ChatGPT, Claude, Cursor or another MCP app. */
export const MCP_URL = 'https://valetto.tech/api/mcp';

/** The app's name as we show it: a name we can't confirm stays in quotes. */
export function appName(app: Pick<ConnectedApp, 'client'>): string {
  return app.client.verified ? app.client.client_name : `“${app.client.client_name}”`;
}

/** The host under the name: the verified app's own host, or where an unverified one sends people back. */
export function appHost(app: Pick<ConnectedApp, 'client' | 'redirect_host'>): string {
  return app.client.verified && app.client.kind === 'cimd' ? app.client.display_name : app.redirect_host;
}

/** What each scope lets a connected app do, in plain words (lib/oauth/consent.ts copy, §5.10). Unknown scopes are skipped. */
export const SCOPE_WORDS: Record<string, string> = {
  agent: 'send tasks and read its own tasks',
  'agent:respond': 'work on tasks sent to it',
  'agent:owner': 'manage your workspace settings and guests',
};

/** The badge on a connection that holds more than the normal access. */
export const ELEVATED_BADGE = 'Extra access';

function joinWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The app's access level in one sentence, from `scopes` ("Can send tasks and read its own tasks."), or null when the
 * API sent no `scopes` (an older server) or none we can name. Then the row looks as it did before.
 */
export function accessSummary(app: Partial<Pick<ConnectedApp, 'scopes'>>): string | null {
  if (!Array.isArray(app.scopes)) return null;
  const words = [...new Set(app.scopes)].map((scope) => SCOPE_WORDS[scope]).filter((w): w is string => !!w);
  return words.length ? `Can ${joinWords(words)}.` : null;
}

/** True only when the API says the connection holds a higher scope. A missing field counts as normal access. */
export function isElevated(app: Partial<Pick<ConnectedApp, 'elevated'>>): boolean {
  return app.elevated === true;
}

/** The badge, in place of ELEVATED_BADGE, while a connection's extra access is switched off on our side. */
export const PAUSED_BADGE = 'Extra access paused';

/** The line under a paused connection: what it can do right now, then that the extra part is on hold. */
export const PAUSED_NOTE = 'Its extra access is paused for now, so it has normal access only.';

const HIGHER_SCOPES = new Set(['agent:respond', 'agent:owner']);

/**
 * True only for an active connection the API marks `elevated_paused` (higher access stored, but switched off right now).
 * Revoked and expired connections never show as paused, and a missing field counts as not paused.
 */
export function isElevationPaused(app: Partial<Pick<ConnectedApp, 'elevated_paused' | 'status'>>): boolean {
  return app.status === 'active' && app.elevated_paused === true;
}

/** What the row says the app can do: everything in `scopes`, or only the normal part while its extra access is paused. */
export function currentAccess(app: Partial<Pick<ConnectedApp, 'scopes' | 'elevated_paused' | 'status'>>): string | null {
  if (!isElevationPaused(app) || !Array.isArray(app.scopes)) return accessSummary(app);
  return accessSummary({ scopes: app.scopes.filter((scope) => !HIGHER_SCOPES.has(scope)) });
}

/** Active connections first (the API already sorts newest first), then the past 30 days of revoked or expired ones. */
export function splitConnectedApps(list: ConnectedApp[]): { current: ConnectedApp[]; past: ConnectedApp[] } {
  return {
    current: list.filter((a) => a.status === 'active'),
    past: list.filter((a) => a.status !== 'active'),
  };
}

/** What revoking does, in the confirm step. The agent stays, so the copy says so. */
export function revokeQuestion(app: ConnectedApp): string {
  const name = appName(app);
  return `Revoke ${name}? It stops working right away. The agent ${app.agent.name} and its tasks stay.`;
}

export function pastLabel(status: ConnectedAppStatus): string {
  return status === 'expired' ? 'Expired' : status === 'revoked' ? 'Revoked' : 'Active';
}

/** When a past connection ended: when it was revoked, or its expiry date. */
export function endedAt(app: Pick<ConnectedApp, 'status' | 'revoked_at' | 'expires_at'>): string | null {
  return app.status === 'revoked' ? app.revoked_at : app.status === 'expired' ? app.expires_at : null;
}

/** Replace one row after a revoke, keeping the list order. */
export function replaceConnectedApp(list: ConnectedApp[], next: ConnectedApp): ConnectedApp[] {
  return list.map((a) => (a.id === next.id ? next : a));
}
