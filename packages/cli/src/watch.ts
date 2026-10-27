// SPDX-License-Identifier: Apache-2.0

import { GUEST_WAKE_NOTICE, WAKE_NOTICE } from '../../../lib/wake-notice.ts';
import { defaultRegistry, type DriverRegistry } from './drivers/registry.ts';
import type { CommandRunner, DriverCheck, NudgeDriver } from './drivers/types.ts';
import { acquireWatcherLock, bindWatcherLockLifecycle, type WatcherLockHold } from './watcher-lock.ts';

export type DueWake = {
  id: string;
  driver?: string;
  target?: string;
  pane?: string;
  reason?: string;
  task_id?: string | null;
  agent_name?: string;
  /** Accepted only when it is the exact guest-task notice. Any other value is ignored. */
  notice?: string;
};

/** Poll text never replaces the fixed notice unless it is the guest-task constant. */
export function nudgeText(wake: DueWake): string {
  return wake.notice === GUEST_WAKE_NOTICE ? GUEST_WAKE_NOTICE : WAKE_NOTICE;
}

export type WakeNudge = { driver: string; target: string };

/** Prefer driver/target. `pane` alone is the deprecated herdr alias. */
export function resolveWake(wake: DueWake): WakeNudge | null {
  const driver = wake.driver?.trim() || (wake.pane ? 'herdr' : '');
  const target = wake.target?.trim() || wake.pane?.trim() || '';
  if (!driver || !target) return null;
  return { driver, target };
}

/** Runs a driver's check, caching a pass. A failed check is retried on the next wake that needs it. */
export async function ensureDriverCheck(
  driver: NudgeDriver,
  checks: Map<string, DriverCheck>,
  log: (message: string) => void = console.error,
): Promise<DriverCheck> {
  const cached = checks.get(driver.id);
  if (cached?.ok) return cached;
  const result = await driver.check();
  checks.set(driver.id, result);
  if (result.ok) log(`[replyslip] driver ${driver.id}: ok${result.version ? ` (${result.version})` : ''}`);
  return result;
}

/** `task 1a2b3c4d`, or the wake reason when the wake has no task. Never a key. */
export function wakeLabel(wake: DueWake): string {
  if (wake.task_id) return `task ${wake.task_id.slice(0, 8)}`;
  return wake.reason ? wake.reason : `wake ${wake.id.slice(0, 8)}`;
}

/**
 * Driver checks run lazily, the first time a wake needs that driver, so a herdr-only
 * machine never runs or warns about the Orca check.
 */
export async function nudgeWakes(options: {
  wakes: DueWake[];
  registry: DriverRegistry;
  checks: Map<string, DriverCheck>;
  warned: Set<string>;
  log?: (message: string) => void;
}): Promise<string[]> {
  const log = options.log ?? console.error;
  const acked: string[] = [];
  for (const wake of options.wakes) {
    const resolved = resolveWake(wake);
    if (!resolved) {
      warnOnce(options.warned, wake.id, 'missing', log, `[replyslip] wake ${wake.id}: missing driver and target; not acked`);
      continue;
    }
    const key = `${wake.id}:${resolved.driver}`;
    const driver = options.registry.get(resolved.driver);
    if (!driver) {
      warnOnce(
        options.warned,
        key,
        'unknown',
        log,
        `[replyslip] wake ${wake.id} driver ${resolved.driver}: unknown driver; not acked`,
      );
      continue;
    }
    const check = await ensureDriverCheck(driver, options.checks, log);
    if (!check.ok) {
      warnOnce(
        options.warned,
        key,
        'check',
        log,
        `[replyslip] wake ${wake.id} driver ${driver.id}: ${check.message ?? 'driver check failed'}; not acked`,
      );
      continue;
    }
    const result = await driver.nudge(resolved.target, nudgeText(wake));
    if (result.ok) {
      acked.push(wake.id);
      log(`[replyslip] woke ${wake.agent_name || resolved.target} via ${driver.id} (${wakeLabel(wake)})`);
      continue;
    }
    warnOnce(
      options.warned,
      key,
      'nudge',
      log,
      `[replyslip] wake ${wake.id} driver ${driver.id}: ${result.error ?? 'nudge failed'}; not acked`,
    );
  }
  return acked;
}

function warnOnce(warned: Set<string>, key: string, kind: string, log: (message: string) => void, message: string): void {
  const slot = `${key}:${kind}`;
  if (warned.has(slot)) return;
  warned.add(slot);
  log(message);
}

export const MAX_BACKOFF_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 30_000;

/** 401 or 403 from the relay: the key is invalid or revoked. The watcher stops. */
export class WatcherAuthError extends Error {
  constructor(origin: string) {
    super(`Watcher key rejected by ${origin}. Check the key in your dashboard.`);
    this.name = 'WatcherAuthError';
  }
}

/** A network error, timeout, or non-auth HTTP failure. The watcher backs off and polls again. */
export class WatcherPollError extends Error {
  constructor(
    public step: 'poll' | 'ack',
    public reason: string,
    detail?: string,
  ) {
    super(`Watcher ${step} failed (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'WatcherPollError';
  }
}

/** Starts at the poll interval, doubles per consecutive failure, capped at 60 seconds. */
export function backoffDelay(intervalMs: number, failures: number): number {
  const exponent = Math.max(0, failures - 1);
  return Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(exponent, 20));
}

export function formatDelay(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))}s`;
}

function networkReason(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0]?.slice(0, 80) || 'network error';
}

async function relayRequest(
  fetchImpl: typeof fetch,
  step: 'poll' | 'ack',
  url: string,
  origin: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
    response = await fetchImpl(url, { ...init, signal });
  } catch (err) {
    throw new WatcherPollError(step, networkReason(err));
  }
  if (response.ok) return response;
  if (response.status === 401 || response.status === 403) throw new WatcherAuthError(origin);
  const text = await response.text().catch(() => '');
  throw new WatcherPollError(step, String(response.status), text.slice(0, 200) || undefined);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function watch(options: {
  url: string;
  key: string;
  intervalMs: number;
  once?: boolean;
  fetchImpl?: typeof fetch;
  registry?: DriverRegistry;
  runCommand?: CommandRunner;
  log?: (message: string) => void;
  /** When set, the first poll's workspace_id scopes the lock before any nudge. */
  lock?: { home?: string; force?: boolean };
  /** Test hook for the wait between polls and retries. */
  sleep?: (ms: number) => Promise<void>;
  /** Stops the loop after the current poll. */
  signal?: AbortSignal;
}): Promise<{ blockedPid?: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.error;
  const sleep = options.sleep ?? defaultSleep;
  const registry = options.registry ?? defaultRegistry(options.runCommand);
  const base = options.url.replace(/\/$/, '');
  const checks = new Map<string, DriverCheck>();
  const warned = new Set<string>();
  const headers = { authorization: `Bearer ${options.key}` };
  let hold: WatcherLockHold | null = null;
  let unbind: (() => void) | null = null;
  let failures = 0;

  try {
    while (!options.signal?.aborted) {
      let delay = options.intervalMs;
      try {
        const response = await relayRequest(fetchImpl, 'poll', `${base}/api/v1/watcher/poll`, base, {
          method: 'POST',
          headers,
        });
        let payload: { wakes?: DueWake[]; workspace_id?: unknown };
        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          throw new WatcherPollError('poll', 'invalid JSON');
        }
        const workspaceId = typeof payload.workspace_id === 'string' && payload.workspace_id ? payload.workspace_id : null;
        if (options.lock && !hold) {
          const acquired = acquireWatcherLock({
            home: options.lock.home,
            force: options.lock.force,
            origin: base,
            workspaceId,
            watcherKey: options.key,
          });
          if (!acquired.ok) return { blockedPid: acquired.pid };
          hold = acquired.hold;
          unbind = bindWatcherLockLifecycle(hold.release);
          log(`[replyslip] watching ${base}${workspaceId ? ` (workspace ${workspaceId})` : ''}`);
        }
        const acked = await nudgeWakes({ wakes: payload.wakes ?? [], registry, checks, warned, log });
        if (acked.length > 0) {
          await relayRequest(fetchImpl, 'ack', `${base}/api/v1/watcher/ack`, base, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ wake_ids: acked }),
          });
        }
        if (failures > 0) log(`[replyslip] ${base} reachable again`);
        failures = 0;
      } catch (err) {
        if (!(err instanceof WatcherPollError) || options.once) throw err;
        failures += 1;
        delay = backoffDelay(options.intervalMs, failures);
        log(`[replyslip] ${err.step} failed (${err.reason}), retrying in ${formatDelay(delay)}`);
      }
      if (options.once) return {};
      await sleep(delay);
    }
    return {};
  } finally {
    unbind?.();
    hold?.release();
  }
}
