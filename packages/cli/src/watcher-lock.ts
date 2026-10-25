// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { hostname, homedir, uptime } from 'node:os';
import path from 'node:path';
import { replyslipHome } from './register.ts';

export type WatcherLockInfo = {
  pid: number;
  startedAt: string;
  hostname: string;
  bootId: string;
  origin: string;
};

export type WatcherLockHold = {
  path: string;
  pid: number;
  startedAt: string;
  release: () => void;
};

export type AcquireWatcherLockResult =
  | { ok: true; hold: WatcherLockHold }
  | { ok: false; reason: 'running'; pid: number };

export type AcquireWatcherLockOptions = {
  home?: string;
  origin: string;
  /** Workspace from the poll response. When absent, the scope is origin plus the key hash. */
  workspaceId?: string | null;
  watcherKey: string;
  force?: boolean;
  pid?: number;
  now?: Date;
  hostname?: string;
  bootId?: string;
  isAlive?: (pid: number) => boolean;
  /** Test hook: runs after a stale lock is noticed and before this process replaces it. */
  onBeforeTakeover?: () => void;
  /** Test hook: runs after this process publishes the lock and before it re-reads it. */
  onAfterCreate?: () => void;
};

const LOCK_NAME = /^watcher-[0-9a-f]{16}\.lock$/;

export function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** `sha256(origin + newline + workspaceId)`, or origin plus the key hash when the workspace is unknown. */
export function watcherScopeId(origin: string, workspaceId: string | null | undefined, watcherKey: string): string {
  const normalized = normalizeOrigin(origin);
  const material = workspaceId
    ? `${normalized}\n${workspaceId}`
    : `${normalized}\n${createHash('sha256').update(watcherKey).digest('hex')}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

export function watcherLockPath(home: string, scopeId: string): string {
  if (!/^[0-9a-f]{16}$/.test(scopeId)) throw new Error('Invalid watcher lock scope.');
  return path.join(replyslipHome(home), `watcher-${scopeId}.lock`);
}

export function alreadyRunningMessage(pid: number): string {
  return `A ReplySlip watcher is already running for this workspace (pid ${pid}); it delivers every local agent in this workspace.`;
}

export function runningStatusMessage(pid: number, origin: string): string {
  return `A ReplySlip watcher is running for this workspace (pid ${pid}, origin ${origin}).`;
}

export const WATCHER_NOT_RUNNING_MESSAGE = 'No ReplySlip watcher is running for this workspace.';

/** Boot time rounded to the nearest minute, for hosts without `/proc/sys/kernel/random/boot_id`. */
export function roundedBootId(nowMs: number, uptimeSeconds: number): string {
  const bootMs = nowMs - uptimeSeconds * 1000;
  return String(Math.round(bootMs / 60_000) * 60_000);
}

/** Linux boot id, otherwise the boot time rounded to the nearest minute. */
export function machineBootId(now = Date.now()): string {
  try {
    const text = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (text) return text;
  } catch {
    // macOS and Windows have no boot_id file.
  }
  return roundedBootId(now, uptime());
}

export function readWatcherLock(file: string): WatcherLockInfo | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as {
      pid?: unknown;
      startedAt?: unknown;
      hostname?: unknown;
      bootId?: unknown;
      origin?: unknown;
    };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.startedAt !== 'string' || parsed.startedAt.trim() === '') return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : '',
      bootId: typeof parsed.bootId === 'string' ? parsed.bootId : '',
      origin: typeof parsed.origin === 'string' ? parsed.origin : '',
    };
  } catch {
    return null;
  }
}

/** `process.kill(pid, 0)` exists on macOS, Linux, and Windows. EPERM means the pid is alive. */
export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsCurrent(info: WatcherLockInfo, self: { hostname: string; bootId: string }, isAlive: (pid: number) => boolean): boolean {
  return info.hostname === self.hostname && info.bootId === self.bootId && isAlive(info.pid);
}

/** Live locks under ~/.replyslip. A different hostname, boot id, or a dead pid is left out. */
export function listLiveWatcherLocks(home = homedir(), self?: { hostname?: string; bootId?: string; isAlive?: (pid: number) => boolean }): WatcherLockInfo[] {
  const dir = replyslipHome(home);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const identity = {
    hostname: self?.hostname ?? hostname(),
    bootId: self?.bootId ?? machineBootId(),
  };
  const isAlive = self?.isAlive ?? pidIsAlive;
  const live: WatcherLockInfo[] = [];
  for (const name of names) {
    if (!LOCK_NAME.test(name)) continue;
    const info = readWatcherLock(path.join(dir, name));
    if (info && lockIsCurrent(info, identity, isAlive)) live.push(info);
  }
  live.sort((a, b) => a.origin.localeCompare(b.origin) || a.pid - b.pid);
  return live;
}

/**
 * One lock per server origin and workspace. A live pid on this host and boot wins.
 * A dead pid, a different hostname, or a different boot id is stale. Takeover publishes
 * with rename, then re-reads: if the file is no longer ours, back off and re-evaluate.
 * The watcher key is never written into the file name or the file.
 */
export function acquireWatcherLock(options: AcquireWatcherLockOptions): AcquireWatcherLockResult {
  const home = options.home ?? homedir();
  const origin = normalizeOrigin(options.origin);
  const scopeId = watcherScopeId(origin, options.workspaceId, options.watcherKey);
  const file = watcherLockPath(home, scopeId);
  const pid = options.pid ?? process.pid;
  const startedAt = (options.now ?? new Date()).toISOString();
  const self = {
    hostname: options.hostname ?? hostname(),
    bootId: options.bootId ?? machineBootId(),
  };
  const isAlive = options.isAlive ?? pidIsAlive;
  const identity: WatcherLockInfo = { pid, startedAt, hostname: self.hostname, bootId: self.bootId, origin };
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  const first = attempt(file, identity, self, isAlive, Boolean(options.force), true, options);
  if (first !== 'lost') return first;
  const seen = readWatcherLock(file);
  if (seen && lockIsCurrent(seen, self, isAlive) && !options.force) return { ok: false, reason: 'running', pid: seen.pid };
  const second = attempt(file, identity, self, isAlive, Boolean(options.force), false, options);
  if (second !== 'lost') return second;
  const last = readWatcherLock(file);
  if (last && lockIsCurrent(last, self, isAlive)) return { ok: false, reason: 'running', pid: last.pid };
  throw new Error('Could not acquire the ReplySlip watcher lock.');
}

/** Release on SIGINT, SIGTERM, and process exit. Returns a function that removes those listeners. */
export function bindWatcherLockLifecycle(release: () => void): () => void {
  const onSignal = () => {
    release();
    process.exit(0);
  };
  const onExit = () => release();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('exit', onExit);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', onExit);
  };
}

function attempt(
  file: string,
  identity: WatcherLockInfo,
  self: { hostname: string; bootId: string },
  isAlive: (pid: number) => boolean,
  force: boolean,
  hooks: boolean,
  options: AcquireWatcherLockOptions,
): AcquireWatcherLockResult | 'lost' {
  const existing = readWatcherLock(file);
  if (existing && lockIsCurrent(existing, self, isAlive) && !force) return { ok: false, reason: 'running', pid: existing.pid };
  if (hooks) options.onBeforeTakeover?.();
  const after = readWatcherLock(file);
  if (after && lockIsCurrent(after, self, isAlive) && !force) return { ok: false, reason: 'running', pid: after.pid };

  const temp = writeTemp(path.dirname(file), identity);
  try {
    const placed = publish(temp, file, self, isAlive, force);
    if (placed !== 'placed') {
      if (placed === 'lost') return 'lost';
      return { ok: false, reason: 'running', pid: placed.pid };
    }
    if (hooks) options.onAfterCreate?.();
    const confirmed = readWatcherLock(file);
    if (confirmed && confirmed.pid === identity.pid && confirmed.startedAt === identity.startedAt) {
      return { ok: true, hold: createHold(file, identity) };
    }
    return 'lost';
  } finally {
    removeLock(temp);
  }
}

function publish(
  temp: string,
  file: string,
  self: { hostname: string; bootId: string },
  isAlive: (pid: number) => boolean,
  force: boolean,
): 'placed' | 'lost' | { pid: number } {
  try {
    renameSync(temp, file);
    return 'placed';
  } catch (err) {
    if (!isRenameConflict(err)) throw err;
  }
  const held = readWatcherLock(file);
  if (held && lockIsCurrent(held, self, isAlive) && !force) return { pid: held.pid };
  removeLock(file);
  try {
    renameSync(temp, file);
    return 'placed';
  } catch (err) {
    if (!isRenameConflict(err)) throw err;
    return 'lost';
  }
}

function writeTemp(dir: string, identity: WatcherLockInfo): string {
  const temp = path.join(dir, `.lock-${identity.pid}-${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeSync(fd, `${JSON.stringify(identity)}\n`);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(temp, 0o600);
  } catch {
    // Windows ignores the Unix mode. The lock still holds the pid.
  }
  return temp;
}

function isRenameConflict(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'EPERM' || code === 'ENOTEMPTY';
}

function removeLock(file: string): void {
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function createHold(file: string, identity: WatcherLockInfo): WatcherLockHold {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const current = readWatcherLock(file);
    if (!current || current.pid !== identity.pid || current.startedAt !== identity.startedAt) return;
    if (current.hostname !== identity.hostname || current.bootId !== identity.bootId) return;
    removeLock(file);
  };
  return { path: file, pid: identity.pid, startedAt: identity.startedAt, release };
}
