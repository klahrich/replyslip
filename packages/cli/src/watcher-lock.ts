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
  /** Workspace id from the first poll. Not a secret. Older locks omit it. */
  workspaceId?: string;
  /** A copy under a pre-0.1.2 lock name, so older watchers see this one. Not listed by --status. */
  alias?: boolean;
};

export type WatcherLockHold = {
  path: string;
  pid: number;
  startedAt: string;
  release: () => void;
};

export type AcquireWatcherLockResult =
  | { ok: true; hold: WatcherLockHold }
  | { ok: false; reason: 'running'; pid: number; origin: string };

export type AcquireWatcherLockOptions = {
  home?: string;
  origin: string;
  /** Workspace from the poll response. When absent, the scope is the key hash. */
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

function keyHash(watcherKey: string): string {
  return createHash('sha256').update(watcherKey).digest('hex');
}

function scopeHash(material: string): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * The lock scope ignores the server address: one workspace gets one watcher on this machine whichever
 * origin it polls (replyslip.com and valetto.tech are one backend). `sha256("workspace" + newline + id)`,
 * or `sha256("key" + newline + sha256(key))` when the poll did not return a workspace id.
 */
export function watcherScopeId(workspaceId: string | null | undefined, watcherKey: string): string {
  return workspaceId ? scopeHash(`workspace\n${workspaceId}`) : scopeHash(`key\n${keyHash(watcherKey)}`);
}

/** The pre-0.1.2 scope: `sha256(origin + newline + workspaceId)`, or origin plus the key hash. */
export function legacyWatcherScopeId(origin: string, workspaceId: string | null | undefined, watcherKey: string): string {
  const normalized = normalizeOrigin(origin);
  return scopeHash(workspaceId ? `${normalized}\n${workspaceId}` : `${normalized}\n${keyHash(watcherKey)}`);
}

/** Addresses of the hosted service. They share one backend, so pre-0.1.2 watchers on any of them get an alias lock. */
export const HOSTED_ORIGINS = [
  'https://valetto.tech',
  'https://www.valetto.tech',
  'https://replyslip.com',
  'https://www.replyslip.com',
] as const;

export function watcherLockPath(home: string, scopeId: string): string {
  if (!/^[0-9a-f]{16}$/.test(scopeId)) throw new Error('Invalid watcher lock scope.');
  return path.join(replyslipHome(home), `watcher-${scopeId}.lock`);
}

export function alreadyRunningMessage(pid: number, origin: string): string {
  return `A ReplySlip watcher is already running for this workspace (pid ${pid}, origin ${origin}); it delivers every local agent in this workspace.`;
}

export function runningStatusMessage(pid: number, origin: string, workspaceId?: string): string {
  const scope = workspaceId ? `workspace ${workspaceId}` : 'this workspace';
  return `A ReplySlip watcher is running for ${scope} (pid ${pid}, origin ${origin}).`;
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
      workspaceId?: unknown;
      alias?: unknown;
    };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.startedAt !== 'string' || parsed.startedAt.trim() === '') return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : '',
      bootId: typeof parsed.bootId === 'string' ? parsed.bootId : '',
      origin: typeof parsed.origin === 'string' ? parsed.origin : '',
      ...(typeof parsed.workspaceId === 'string' && parsed.workspaceId ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.alias === true ? { alias: true } : {}),
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
    if (info && !info.alias && lockIsCurrent(info, identity, isAlive)) live.push(info);
  }
  live.sort((a, b) => a.origin.localeCompare(b.origin) || a.pid - b.pid);
  return live;
}

/**
 * One lock per workspace, whatever the server address. A live pid on this host and boot wins.
 * Before taking the lock, a live lock from any version for the same workspace (or, without a
 * workspace id, the same key) blocks, including a pre-0.1.2 lock named from another address.
 * After taking it, alias copies under the pre-0.1.2 names for the hosted addresses make older
 * watchers refuse to start too.
 * A dead pid, a different hostname, or a different boot id is stale. Takeover publishes
 * with rename, then re-reads: if the file is no longer ours, back off and re-evaluate.
 * The watcher key is never written into the file name or the file.
 */
export function acquireWatcherLock(options: AcquireWatcherLockOptions): AcquireWatcherLockResult {
  const home = options.home ?? homedir();
  const origin = normalizeOrigin(options.origin);
  const scopeId = watcherScopeId(options.workspaceId, options.watcherKey);
  const file = watcherLockPath(home, scopeId);
  const pid = options.pid ?? process.pid;
  const startedAt = (options.now ?? new Date()).toISOString();
  const self = {
    hostname: options.hostname ?? hostname(),
    bootId: options.bootId ?? machineBootId(),
  };
  const isAlive = options.isAlive ?? pidIsAlive;
  const identity: WatcherLockInfo = {
    pid,
    startedAt,
    hostname: self.hostname,
    bootId: self.bootId,
    origin,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  };
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  if (!options.force) {
    const other = sameWorkspaceLock(home, file, options.workspaceId, options.watcherKey, self, isAlive);
    if (other) return running(other);
  }
  const acquired = acquireMain(file, identity, self, isAlive, options);
  if (!acquired.ok) return acquired;
  const aliases = writeAliases(home, file, identity, options, self, isAlive);
  const release = acquired.hold.release;
  acquired.hold.release = () => {
    for (const alias of aliases) releaseIfOurs(alias, identity);
    release();
  };
  return acquired;
}

function running(info: WatcherLockInfo): AcquireWatcherLockResult {
  return { ok: false, reason: 'running', pid: info.pid, origin: info.origin };
}

function acquireMain(
  file: string,
  identity: WatcherLockInfo,
  self: { hostname: string; bootId: string },
  isAlive: (pid: number) => boolean,
  options: AcquireWatcherLockOptions,
): AcquireWatcherLockResult {
  const first = attempt(file, identity, self, isAlive, Boolean(options.force), true, options);
  if (first !== 'lost') return first;
  const seen = readWatcherLock(file);
  if (seen && lockIsCurrent(seen, self, isAlive) && !options.force) return running(seen);
  const second = attempt(file, identity, self, isAlive, Boolean(options.force), false, options);
  if (second !== 'lost') return second;
  const last = readWatcherLock(file);
  if (last && lockIsCurrent(last, self, isAlive)) return running(last);
  throw new Error('Could not acquire the ReplySlip watcher lock.');
}

/** A live lock, other than `file`, that covers the same workspace: same workspace id, or a pre-0.1.2 name for it. */
function sameWorkspaceLock(
  home: string,
  file: string,
  workspaceId: string | null | undefined,
  watcherKey: string,
  self: { hostname: string; bootId: string },
  isAlive: (pid: number) => boolean,
): WatcherLockInfo | null {
  const dir = replyslipHome(home);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (!LOCK_NAME.test(name) || full === file) continue;
    const info = readWatcherLock(full);
    if (!info || !lockIsCurrent(info, self, isAlive)) continue;
    const sameId = Boolean(workspaceId) && info.workspaceId === workspaceId;
    const legacyName = `watcher-${legacyWatcherScopeId(info.origin, workspaceId, watcherKey)}.lock`;
    if (sameId || name === legacyName) return info;
  }
  return null;
}

/**
 * Copies of the lock under the names a pre-0.1.2 watcher checks for the hosted addresses and this origin.
 * Best effort: a name already held by a live process is left alone unless force is set. Returns the paths written.
 */
function writeAliases(
  home: string,
  file: string,
  identity: WatcherLockInfo,
  options: AcquireWatcherLockOptions,
  self: { hostname: string; bootId: string },
  isAlive: (pid: number) => boolean,
): string[] {
  const origins = new Set<string>([identity.origin, ...HOSTED_ORIGINS]);
  const written: string[] = [];
  const alias: WatcherLockInfo = { ...identity, alias: true };
  for (const origin of origins) {
    const target = watcherLockPath(home, legacyWatcherScopeId(origin, options.workspaceId, options.watcherKey));
    if (target === file) continue;
    const held = readWatcherLock(target);
    const ours = held?.pid === identity.pid && held.startedAt === identity.startedAt;
    if (held && !options.force && !ours && lockIsCurrent(held, self, isAlive)) continue;
    const temp = writeTemp(path.dirname(target), alias);
    try {
      renameSync(temp, target);
      written.push(target);
    } catch {
      // Another process won the name. Its own lock covers it.
    } finally {
      removeLock(temp);
    }
  }
  return written;
}

function releaseIfOurs(file: string, identity: WatcherLockInfo): void {
  const current = readWatcherLock(file);
  if (!current || current.pid !== identity.pid || current.startedAt !== identity.startedAt) return;
  if (current.hostname !== identity.hostname || current.bootId !== identity.bootId) return;
  try {
    removeLock(file);
  } catch {
    // Leave it: a dead pid makes it stale for the next watcher.
  }
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
  if (existing && lockIsCurrent(existing, self, isAlive) && !force) return running(existing);
  if (hooks) options.onBeforeTakeover?.();
  const after = readWatcherLock(file);
  if (after && lockIsCurrent(after, self, isAlive) && !force) return running(after);

  const temp = writeTemp(path.dirname(file), identity);
  try {
    const placed = publish(temp, file, self, isAlive, force);
    if (placed !== 'placed') {
      if (placed === 'lost') return 'lost';
      return { ok: false, reason: 'running', pid: placed.pid, origin: placed.origin };
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
): 'placed' | 'lost' | { pid: number; origin: string } {
  try {
    renameSync(temp, file);
    return 'placed';
  } catch (err) {
    if (!isRenameConflict(err)) throw err;
  }
  const held = readWatcherLock(file);
  if (held && lockIsCurrent(held, self, isAlive) && !force) return { pid: held.pid, origin: held.origin };
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
