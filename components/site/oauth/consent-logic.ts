import { isForbiddenScheme } from '@/lib/oauth/redirect';
import type { ConsentDecisionBody, ConsentProblem, ConsentView } from './consent-types';

/** The fallback when the server's pattern can't be compiled: AGENT_NAME_PATTERN in lib/constants.ts. */
const AGENT_NAME_FALLBACK = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export type Selection = { mode: 'new' } | { mode: 'reconnect'; agentId: string };

/** New agent by default. At the plan's agent limit a new agent can't be made, so start on the newest reconnect choice. */
export function initialSelection(view: ConsentView): Selection {
  const first = view.agent.reconnect_options[0];
  if (view.plan.at_agent_limit && first) return { mode: 'reconnect', agentId: first.id };
  return { mode: 'new' };
}

function namePattern(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch {
    return AGENT_NAME_FALLBACK;
  }
}

/** A short message when the agent name won't pass the server's check, or null when it looks fine. */
export function nameProblem(name: string, patternSource: string): string | null {
  const value = name.trim();
  if (!value) return 'Give the agent a name.';
  if (!namePattern(patternSource).test(value)) {
    return 'Use letters, numbers, - or _, starting with a letter. Up to 64 characters.';
  }
  return null;
}

/** Allow is possible for a valid new name under the limit, or for a listed reconnect choice. */
export function canAllow(view: ConsentView, selection: Selection, name: string): boolean {
  if (selection.mode === 'reconnect') return view.agent.reconnect_options.some((o) => o.id === selection.agentId);
  return !view.plan.at_agent_limit && nameProblem(name, view.agent.name_pattern) === null;
}

/**
 * The extra-permission field of the Allow POST (`extra_scopes.opt_in_field`, §5.10), from the boxes the user
 * ticked, in the server's order. The one place that knows the field. Nothing ticked, or nothing offered, adds nothing,
 * so the app gets the normal access only.
 */
export function extraScopeFields(view: ConsentView, ticked: readonly string[]): Pick<AllowBody, 'grant_scopes'> {
  const granted = (extraScopesOffer(view)?.items ?? []).map((i) => i.name).filter((name) => ticked.includes(name));
  return granted.length ? { grant_scopes: granted } : {};
}

/** The POST body. `ticked` lists the extra scopes whose box is ticked; Cancel never sends them. */
export function decisionBody(
  view: ConsentView,
  decision: 'allow' | 'deny',
  selection: Selection,
  name: string,
  workspaceId: string,
  ticked: readonly string[] = [],
): ConsentDecisionBody {
  const base = { request_id: view.request_id, csrf_token: view.csrf_token, workspace_id: workspaceId };
  if (decision === 'deny') return { ...base, decision: 'deny' };
  const agent =
    selection.mode === 'reconnect'
      ? { mode: 'reconnect' as const, agent_id: selection.agentId }
      : { mode: 'new' as const, name: name.trim() };
  return { ...base, decision: 'allow', agent, ...extraScopeFields(view, ticked) };
}

type AllowBody = Extract<ConsentDecisionBody, { decision: 'allow' }>;
type ExtraScopeName = NonNullable<AllowBody['grant_scopes']>[number];
/** `extra_scopes` as the page reads it: tolerant of an older server that sends less, or no field at all. */
type ExtraScopesWire = Partial<ConsentView['extra_scopes']>;

export type ExtraScopesOffer = {
  /** One unticked checkbox each, in the server's order, with what the scope allows. */
  items: Array<{ name: ExtraScopeName; title: string; allows: string[]; requestedByClient: boolean }>;
  /** How long the connection lasts with any box ticked, or null when the server sent no days. */
  daysNote: string | null;
  /** The server's warning (e.g. for an unverified app), or null. */
  warning: string | null;
  /** Show `warning` prominently: the app is unverified. */
  urgent: boolean;
  /** The server's warning for ticking every box at once, or null. Shown only while all of them are ticked. */
  combinedWarning: string | null;
};

/** Shown next to a scope the app asked for itself. */
export const REQUESTED_BY_APP = 'Requested by the app';

export function extraScopesDaysNote(days: number | null): string | null {
  if (!days) return null;
  // Copy from #153: "With either one, this connection ends after {connection_days} days."
  return `With either one, this connection ends after ${days === 1 ? '1 day' : `${days} days`}.`;
}

/**
 * The optional extra permissions, one unticked checkbox each, or null when the server offers none
 * (MCP_OAUTH_OWNER_SCOPE off, or an older server without `extra_scopes`). Then the page shows nothing new.
 */
export function extraScopesOffer(view: ConsentView): ExtraScopesOffer | null {
  const extra = (view as { extra_scopes?: ExtraScopesWire }).extra_scopes;
  const offered = extra?.offered ?? [];
  if (!extra || offered.length === 0) return null;
  const days = typeof extra.connection_days === 'number' && extra.connection_days > 0 ? extra.connection_days : null;
  return {
    items: offered.map((o) => ({ name: o.name, title: o.title, allows: o.allows, requestedByClient: o.requested_by_client === true })),
    daysNote: extraScopesDaysNote(days),
    warning: extra.warning || null,
    urgent: extra.unverified_client === true,
    combinedWarning: offered.length > 1 ? extra.combined_warning || null : null,
  };
}

/** The combined warning applies only while every offered box is ticked (and more than one is offered). */
export function showCombinedWarning(offer: ExtraScopesOffer, ticked: readonly string[]): boolean {
  return !!offer.combinedWarning && offer.items.every((i) => ticked.includes(i.name));
}

export type AppLabel = {
  /** What to call the app in sentences: its own name, in quotes when we can't confirm it. */
  name: string;
  /** The host shown under the name. */
  host: string;
  verified: boolean;
  /** Where the browser goes back to, when that differs from `host`. */
  returnsTo: string | null;
  /** The letter on the tile (no remote logos). */
  initial: string;
};

export function appLabel(view: ConsentView): AppLabel {
  const { client, redirect } = view;
  const host = client.verified && client.kind === 'cimd' ? client.display_name : redirect.host;
  const name = client.verified ? client.client_name : `“${client.client_name}”`;
  const initial = (client.client_name.trim().match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
  return { name, host, verified: client.verified, returnsTo: redirect.host !== host ? redirect.host : null, initial };
}

type Redirect = ConsentView['redirect'];

/** Does the browser go back to an app on this device (cursor://, vscode://, com.example.app:/) rather than a website? */
export function opensApp(redirect: Redirect): boolean {
  return redirect.kind === 'custom_scheme';
}

/** How the page names an app scheme: cursor:// for a URI with a host, com.example.app:/ for a reverse-domain one. */
export function schemeLabel(redirect: Redirect): string | null {
  if (!opensApp(redirect) || !redirect.scheme) return null;
  return redirect.host === redirect.scheme ? `${redirect.scheme}:/` : `${redirect.scheme}://`;
}

/** The warning under the app name for a redirect that stays on this computer, or null for a website. */
export function redirectWarning(redirect: Redirect): string | null {
  const label = schemeLabel(redirect);
  if (label) {
    return `This app will receive access through ${label} on your computer. Only continue if you just started this from an app you trust.`;
  }
  if (redirect.loopback) {
    return 'This app will receive access on your own computer (localhost). Only continue if you just started this from a program you trust.';
  }
  return null;
}

/** Said near the buttons when Allow hands off to a desktop app. */
export const OPENS_APP_NOTE = 'Pressing Allow opens the app on your computer. Your browser may ask first whether to open it.';

/** "Returning to ChatGPT…", "Opening the app…", or a neutral line for an app we can't confirm. */
export function returningText(view: ConsentView): string {
  const name = view.client.verified ? view.client.client_name : 'the app';
  return opensApp(view.redirect) ? `Opening ${name}…` : `Returning to ${name}…`;
}

/** Shown under "Opening the app…" in case the browser blocked or missed the hand-off. */
export const OPENS_APP_FALLBACK = {
  before: 'Nothing happened? ',
  link: 'Open the app again',
  after: ', or go back to it and connect from there.',
} as const;

/**
 * Schemes the page never navigates to, whatever the server answers: script and inline content, local files, and
 * browser-internal or extension pages. The server's list (lib/oauth/redirect.ts) plus a local floor, so this check
 * stands on its own.
 */
const NEVER_FOLLOW = new Set(['javascript', 'vbscript', 'data', 'file', 'blob', 'about', 'view-source', 'filesystem']);

function schemeOf(url: string): string | null {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * Is `url` a place the page may send the browser after Allow or Cancel? A website (http or https), or, when the
 * consent view said the app lives on this computer, a URL in exactly that app scheme. Never a script, file or
 * browser-internal scheme.
 */
export function isFollowableRedirect(url: string, redirect?: Redirect): boolean {
  const scheme = schemeOf(url);
  if (!scheme) return false;
  if (scheme === 'https' || scheme === 'http') return /^https?:\/\/[^/?#\s]/i.test(url);
  if (NEVER_FOLLOW.has(scheme) || isForbiddenScheme(scheme)) return false;
  if (!redirect || !opensApp(redirect) || !redirect.scheme) return false;
  return scheme === redirect.scheme.toLowerCase() && !/[\s\u0000-\u001f\u007f]/.test(url);
}

export type PostOutcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'problem'; problem: ConsentProblem }
  | { kind: 'error'; code: string; message: string; suggestedName?: string };

const PROBLEM_CODES: ConsentProblem[] = ['request_not_found', 'request_expired', 'request_completed', 'workspace_required'];

export function problemFromCode(code: string): ConsentProblem | null {
  return (PROBLEM_CODES as string[]).includes(code) ? (code as ConsentProblem) : null;
}

/** Turns the POST /api/oauth/consent answer into what the page does next. Pass the view's redirect so an app scheme is followed. */
export function outcomeFromResponse(status: number, data: unknown, redirect?: Redirect): PostOutcome {
  if (status === 200) {
    const url = (data as { redirect_to?: unknown } | null)?.redirect_to;
    if (typeof url === 'string' && isFollowableRedirect(url, redirect)) return { kind: 'redirect', url };
    return { kind: 'error', code: 'bad_response', message: 'Something went wrong. Try again.' };
  }
  const err = (data as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  const code = typeof err?.code === 'string' ? err.code : status === 429 ? 'rate_limited' : status === 401 ? 'unauthorized' : 'error';
  const problem = problemFromCode(code);
  if (problem) return { kind: 'problem', problem };
  switch (code) {
    case 'name_taken': {
      const suggested = (err?.details as { suggested_name?: unknown } | undefined)?.suggested_name;
      const suggestedName = typeof suggested === 'string' ? suggested : undefined;
      return {
        kind: 'error',
        code,
        message: suggestedName ? `That name is taken. We changed it to ${suggestedName}.` : 'That name is taken. Pick another.',
        suggestedName,
      };
    }
    case 'invalid_name':
      return { kind: 'error', code, message: 'Use letters, numbers, - or _, starting with a letter. Up to 64 characters.' };
    case 'validation_error': {
      const path = (err?.details as { issues?: Array<{ path?: unknown }> } | undefined)?.issues?.[0]?.path;
      if (path === 'agent.name') {
        return { kind: 'error', code, message: 'Use letters, numbers, - or _, starting with a letter. Up to 64 characters.' };
      }
      if (path === 'agent.agent_id') {
        return { kind: 'error', code, message: 'That agent can’t be reconnected any more. Reload this page and pick again.' };
      }
      return { kind: 'error', code, message: 'This page is out of date. Reload it and try again.' };
    }
    case 'agent_revoked':
      return { kind: 'error', code, message: 'That agent was removed. Reload this page and pick another, or make a new one.' };
    case 'plan_limit':
      return {
        kind: 'error',
        code,
        message: 'Your workspace is at its agent limit. Reconnect an existing agent, or remove one in your dashboard.',
      };
    case 'csrf_failed':
      return { kind: 'error', code, message: 'This page is out of date. Reload it and try again.' };
    case 'bad_origin':
    case 'binding_failed':
      return {
        kind: 'error',
        code,
        message: 'Finish connecting in the browser where you started. Go back to the app and connect again from there.',
      };
    case 'unauthorized':
      return { kind: 'error', code, message: 'You were signed out. Reload this page to sign in again.' };
    case 'rate_limited':
      return { kind: 'error', code, message: 'Too many tries. Wait a few minutes and try again.' };
    default:
      return { kind: 'error', code, message: 'Something went wrong. Try again.' };
  }
}

export type ProblemCopy = { title: string; body: string; dashboard: boolean };

export function problemCopy(problem: ConsentProblem): ProblemCopy {
  switch (problem) {
    case 'request_expired':
      return {
        title: 'This request has expired',
        body: 'Requests last 20 minutes. Go back to the app and connect again.',
        dashboard: false,
      };
    case 'request_completed':
      return {
        title: 'This request is already answered',
        body: 'You already allowed or cancelled it. To connect again, start over from the app.',
        dashboard: false,
      };
    case 'workspace_required':
      return {
        title: 'You need a workspace first',
        body: 'Open your dashboard to finish setting up, then connect the app again.',
        dashboard: true,
      };
    default:
      return {
        title: 'This link doesn’t work',
        body: 'It may be incomplete, or it was opened in a different account. Go back to the app and connect again.',
        dashboard: false,
      };
  }
}
