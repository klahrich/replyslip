/**
 * The last branding this tab saw for each business, kept in sessionStorage. Pages that lose the session (the
 * sign-in gate, the signed-out page) can't load the business anymore, so they show its name and logo from here.
 * Tab-scoped on purpose: nothing outlives the tab, and another tab never sees it.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { Branding } from './types';

const KEY = 'valetto:brands';

function read(): Record<string, Branding> {
  try {
    const v: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, Branding>) : {};
  } catch {
    return {};
  }
}

export function rememberBranding(agentId: string, branding: Branding): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [agentId]: branding }));
  } catch {
    // Storage full or blocked: the pages fall back to plain Valetto branding.
  }
}

export function recallBranding(agentId: string | null | undefined): Branding | null {
  if (!agentId || typeof window === 'undefined') return null;
  const b = read()[agentId];
  return b && typeof b.display_name === 'string' ? b : null;
}

/** The business id in a /c/:agentId… path, or null on /c and /c/link. */
export function agentIdFromPath(path: string | null): string | null {
  const m = /^\/c\/([^/]+)/.exec(path ?? '');
  return m && m[1] !== 'link' ? decodeURIComponent(m[1]) : null;
}

const noSubscribe = () => () => {};
const snapshot = () => {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** recallBranding as a hook: null during server render and hydration, then the remembered branding. */
export function useRememberedBranding(agentId: string | null | undefined): Branding | null {
  const raw = useSyncExternalStore(noSubscribe, snapshot, () => null);
  return useMemo(() => (raw === null ? null : recallBranding(agentId)), [raw, agentId]);
}
