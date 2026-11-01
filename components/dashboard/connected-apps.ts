/**
 * Connected apps (ChatGPT, Claude) as GET /api/v1/connected-apps returns them, per docs/design/mcp-oauth.md §6.4.
 * The route ships in PlumberBot's server PR; this file is the UI's side of that contract.
 */

export type ConnectedAppStatus = 'active' | 'revoked' | 'expired';

export type ConnectedApp = {
  /** Connection id. */
  id: string;
  client: { display_name: string; client_name: string; verified: boolean; kind: 'cimd' | 'dcr' };
  redirect_host: string;
  agent: { id: string; name: string; revoked: boolean };
  scope: string;
  approved_by_email: string;
  created_at: string;
  /** Null until the app first uses the connection; can be up to 5 minutes behind. */
  last_used_at: string | null;
  /** The connection ends on this date (at most a year after it was made). */
  expires_at: string;
  status: ConnectedAppStatus;
};

export type ConnectedAppsResponse = { connected_apps: ConnectedApp[] };

export const CONNECTED_APPS_PATH = '/api/v1/connected-apps';
export const revokePath = (id: string) => `${CONNECTED_APPS_PATH}/${encodeURIComponent(id)}/revoke`;

/** The URL people paste into ChatGPT or Claude. */
export const MCP_URL = 'https://valetto.tech/api/mcp';

/** The app's name as we show it: a name we can't confirm stays in quotes. */
export function appName(app: Pick<ConnectedApp, 'client'>): string {
  return app.client.verified ? app.client.client_name : `“${app.client.client_name}”`;
}

/** The host under the name: the verified app's own host, or where an unverified one sends people back. */
export function appHost(app: Pick<ConnectedApp, 'client' | 'redirect_host'>): string {
  return app.client.verified && app.client.kind === 'cimd' ? app.client.display_name : app.redirect_host;
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

/** Replace one row after a revoke, keeping the list order. */
export function replaceConnectedApp(list: ConnectedApp[], next: ConnectedApp): ConnectedApp[] {
  return list.map((a) => (a.id === next.id ? next : a));
}
