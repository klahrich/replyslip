// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { hostname, homedir, uptime } from 'node:os';
import path from 'node:path';
import { acquireFileLockSync, FILE_LOCK_WAIT_MS, FileLockError, lockHeld, releaseFileLock, type HeldFileLock } from './file-lock.ts';
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
  /** Random per-acquire value. With pid and startedAt it says whether a file is this hold's. Older locks omit it. */
  token?: string;
  /** Set on a per-agent watcher's lock (`replyslip watch` with the agent's own key). Absent on a legacy machine-wide lock. */
  agentId?: string;
  agentName?: string;
};

export type WatcherLockHold = {
  path: string;
  pid: number;
  startedAt: string;
  /** Random per-acquire value. A supervisor may signal this pid only while the lock still carries it. */
  token: string;
  release: () => void;
  /** Re-reads the main lock. `held` is false once another process rewrote or removed it. */
  stillHeld: () => { held: boolean; current: WatcherLockInfo | null };
};

export type AcquireWatcherLockResult =
  | { ok: true; hold: WatcherLockHold }
  | { ok: false; reason: 'running'; pid: number; origin: string; path: string; agentName?: string }
  /** Per-agent watcher only: a legacy machine-wide watcher (rsw_ key) for this workspace is live on this machine. */
  | { ok: false; reason: 'legacy'; pid: number; origin: string; path: string };

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
  /**
   * Replace the main lock only when it still has this exact pid, token, and start time
   * at the moment of the rename. A newer lock is left in place.
   */
  reclaim?: ReclaimLock;
};

export type ReclaimLock = { pid: number; token: string; startedAt: string };

const LOCK_NAME = /^watcher-[0-9a-f]{16}\.lock$/;
const TEMP_NAME = /^\.lock-(\d+)-[0-9a-f]{16}\.tmp$/;
/** A temp file lives for one synchronous write and rename. One older than this was left by a crash. */
export const STALE_TEMP_MS = 60_000;

type Self = { hostname: string; bootId: string; pid: number };

/** Locks this process holds right now, as `pid|startedAt|token`. Only these count as live when the pid is ours. */
const heldHere = new Set<string>();

function holdKey(info: Pick<WatcherLockInfo, 'pid' | 'startedAt' | 'token'>): string {
  return `${info.pid}|${info.startedAt}|${info.token ?? ''}`;
}

/** Same pid, start time, token, hostname, and boot id: the file was written by this hold. */
export function sameHolder(info: WatcherLockInfo | null, identity: WatcherLockInfo): boolean {
  return (
    !!info &&
    info.pid === identity.pid &&
    info.startedAt === identity.startedAt &&
    (info.token ?? '') === (identity.token ?? '') &&
    info.hostname === identity.hostname &&
    info.bootId === identity.bootId
  );
}

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

/** A per-agent watcher's lock scope: `sha256("agent" + newline + agent id)`. One watcher per agent per machine. */
export function agentWatcherScopeId(agentId: string): string {
  return scopeHash(`agent\n${agentId}`);
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

export function alreadyRunningMessage(pid: number, origin: string, lockPath: string): string {
  return `A ReplySlip watcher is already running for this workspace (pid ${pid}, origin ${origin}, lock ${lockPath}); it delivers every local agent in this workspace. If pid ${pid} is not a ReplySlip watcher, rerun with --force.`;
}

/** A second per-agent watcher for the same agent on this machine. */
export function agentAlreadyRunningMessage(agentName: string, pid: number, origin: string, lockPath: string): string {
  return `A ReplySlip watcher is already running for agent ${agentName} (pid ${pid}, origin ${origin}, lock ${lockPath}). If pid ${pid} is not a ReplySlip watcher, rerun with --force.`;
}

/** A legacy `watch --key-file` started while per-agent watchers run for the same workspace. */
export function agentWatchersRunningMessage(agentName: string, pid: number, lockPath: string): string {
  return `A per-agent ReplySlip watcher is running for agent ${agentName} in this workspace (pid ${pid}, lock ${lockPath}). Each agent now runs its own watcher, so a machine-wide watcher beside it could deliver the same wake twice. Stop the per-agent watchers first, or keep them and do not start this one. If pid ${pid} is not a ReplySlip watcher, rerun with --force.`;
}

/** The per-agent watcher refuses to start, or stops, while a legacy machine-wide watcher for the workspace runs here. */
export function legacyWatcherRunningMessage(pid: number, origin: string, lockPath: string): string {
  return `A legacy machine-wide ReplySlip watcher (workspace watcher key) is running for this workspace on this machine (pid ${pid}, origin ${origin}, lock ${lockPath}). It already types into every local agent's pane, so this per-agent watcher will not start beside it on this machine, to avoid delivering a wake twice. Ask the human to stop that watcher first (Ctrl-C in its pane, or kill ${pid}), then start one \`replyslip watch\` per agent, and revoke the old watcher key in the dashboard under Watchers. If pid ${pid} is not a ReplySlip watcher, delete ${lockPath} and retry.`;
}

/** Printed when the poll loop finds its main lock rewritten by another watcher (for example one started with --force). */
export function lockLostMessage(lockPath: string, holder: WatcherLockInfo | null): string {
  const by = holder ? `pid ${holder.pid}, origin ${holder.origin}` : 'the file was removed';
  return `[replyslip] lock ${lockPath} is no longer held by this watcher (${by}); stopping so only one watcher delivers this workspace.`;
}

export function agentRunningStatusMessage(pid: number, origin: string, agentName: string, workspaceId?: string): string {
  const scope = workspaceId ? ` in workspace ${workspaceId}` : '';
  return `A ReplySlip watcher is running for agent ${agentName}${scope} (pid ${pid}, origin ${origin}).`;
}

/** One `watch --status` line: per-agent locks name the agent, legacy machine-wide locks keep the old wording. */
export function statusLine(lock: WatcherLockInfo): string {
  if (lock.agentName) return agentRunningStatusMessage(lock.pid, lock.origin, lock.agentName, lock.workspaceId);
  return runningStatusMessage(lock.pid, lock.origin, lock.workspaceId);
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
      token?: unknown;
      agentId?: unknown;
      agentName?: unknown;
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
      ...(typeof parsed.token === 'string' && parsed.token ? { token: parsed.token } : {}),
      ...(typeof parsed.agentId === 'string' && parsed.agentId ? { agentId: parsed.agentId } : {}),
      ...(typeof parsed.agentName === 'string' && parsed.agentName ? { agentName: parsed.agentName } : {}),
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

/**
 * Live means this hostname, this boot id, and a live pid. A lock carrying our own pid is live only when this
 * process holds it now: otherwise it was left by an earlier process that had the same pid (a container
 * restarted as pid 1 with a persistent ~/.replyslip has the same hostname and boot id).
 */
function lockIsCurrent(info: WatcherLockInfo, self: Self, isAlive: (pid: number) => boolean): boolean {
  if (info.hostname !== self.hostname || info.bootId !== self.bootId) return false;
  if (info.pid === self.pid) return heldHere.has(holdKey(info));
  return isAlive(info.pid);
}

/** Live locks under ~/.replyslip. A different hostname, boot id, or a dead pid is left out. */
export function listLiveWatcherLocks(
  home = homedir(),
  self?: { hostname?: string; bootId?: string; pid?: number; isAlive?: (pid: number) => boolean },
): WatcherLockInfo[] {
  const dir = replyslipHome(home);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const identity: Self = {
    hostname: self?.hostname ?? hostname(),
    bootId: self?.bootId ?? machineBootId(),
    pid: self?.pid ?? process.pid,
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
 * A dead pid, a different hostname, a different boot id, or our own pid on a lock this process does not
 * hold is stale. `--force` skips the live check for the main lock only. Takeover publishes
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
  const self: Self = {
    hostname: options.hostname ?? hostname(),
    bootId: options.bootId ?? machineBootId(),
    pid,
  };
  const isAlive = options.isAlive ?? pidIsAlive;
  const identity: WatcherLockInfo = {
    pid,
    startedAt,
    hostname: self.hostname,
    bootId: self.bootId,
    origin,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    token: randomBytes(8).toString('hex'),
  };
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  removeStaleTemps(path.dirname(file), isAlive);

  return withAcquireMutex(home, () => {
  if (!options.force && !options.reclaim) {
    const other = sameWorkspaceLock(home, file, options.workspaceId, options.watcherKey, self, isAlive);
    if (other) return running(other.info, other.path);
  }
  const acquired = acquireMain(file, identity, self, isAlive, options);
  if (!acquired.ok) return acquired;
  const aliases = writeAliases(home, file, identity, options, self, isAlive);
  const release = acquired.hold.release;
  acquired.hold.release = () => {
    for (const alias of aliases) releaseAliasIfOurs(alias, identity);
    release();
  };
  return acquired;
  });
}

function running(info: WatcherLockInfo, file: string): AcquireWatcherLockResult {
  return { ok: false, reason: 'running', pid: info.pid, origin: info.origin, path: file, ...(info.agentName ? { agentName: info.agentName } : {}) };
}

/**
 * Removes `.lock-<pid>-<hex>.tmp` files a crash left between write and rename: the writer pid is dead,
 * or the file is older than STALE_TEMP_MS (a write and rename take milliseconds, so the pid was reused).
 * Our own pid's temps are removed too: acquire is synchronous, so none of ours is in flight here.
 * Only regular files matching the exact temp name are touched.
 */
function removeStaleTemps(dir: string, isAlive: (pid: number) => boolean, nowMs = Date.now()): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const match = TEMP_NAME.exec(name);
    if (!match) continue;
    const full = path.join(dir, name);
    try {
      const info = lstatSync(full);
      if (!info.isFile()) continue;
      const writer = Number(match[1]);
      const old = nowMs - info.mtimeMs > STALE_TEMP_MS;
      if (writer === process.pid || old || !isAlive(writer)) removeLock(full);
    } catch {
      // Gone already, or not ours to remove. The next acquire tries again.
    }
  }
}

function acquireMain(
  file: string,
  identity: WatcherLockInfo,
  self: Self,
  isAlive: (pid: number) => boolean,
  options: AcquireWatcherLockOptions,
): AcquireWatcherLockResult {
  const first = attempt(file, identity, self, isAlive, Boolean(options.force), true, options);
  if (first !== 'lost') return first;
  const seen = readWatcherLock(file);
  if (seen && lockIsCurrent(seen, self, isAlive) && !options.force) return running(seen, file);
  const second = attempt(file, identity, self, isAlive, Boolean(options.force), false, options);
  if (second !== 'lost') return second;
  const last = readWatcherLock(file);
  if (last && lockIsCurrent(last, self, isAlive)) return running(last, file);
  throw new Error('Could not acquire the ReplySlip watcher lock.');
}

/** A live lock, other than `file`, that covers the same workspace: same workspace id, or a pre-0.1.2 name for it. */
function sameWorkspaceLock(
  home: string,
  file: string,
  workspaceId: string | null | undefined,
  watcherKey: string,
  self: Self,
  isAlive: (pid: number) => boolean,
): { info: WatcherLockInfo; path: string } | null {
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
    // An alias copy's holder keeps its main lock under this workspace's scope, which is `file`.
    if (sameId || name === legacyName) return { info, path: info.alias && sameId ? file : full };
  }
  return null;
}

/**
 * Copies of the lock under the names a pre-0.1.2 watcher checks for the hosted addresses and this origin.
 * Planned for removal in 0.2. Best effort. `--force` applies to the main lock only: a name held by a live
 * lock without the `alias` marker is a real pre-0.1.2 watcher's own lock and is never overwritten. A live
 * alias copy from another 0.1.2 watcher is replaced only under force. Returns the paths written.
 */
function writeAliases(
  home: string,
  file: string,
  identity: WatcherLockInfo,
  options: AcquireWatcherLockOptions,
  self: Self,
  isAlive: (pid: number) => boolean,
): string[] {
  const origins = new Set<string>([identity.origin, ...HOSTED_ORIGINS]);
  const written: string[] = [];
  const alias: WatcherLockInfo = { ...identity, alias: true };
  for (const origin of origins) {
    const target = watcherLockPath(home, legacyWatcherScopeId(origin, options.workspaceId, options.watcherKey));
    if (target === file) continue;
    const held = readWatcherLock(target);
    if (held && !sameHolder(held, identity) && lockIsCurrent(held, self, isAlive)) {
      if (!held.alias || !options.force) continue;
    }
    const temp = writeTemp(path.dirname(target), alias);
    try {
      assertMutex();
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

/** Unlinks `file` only when it is still this hold's alias copy. */
function releaseAliasIfOurs(file: string, identity: WatcherLockInfo): void {
  const current = readWatcherLock(file);
  if (!current?.alias || !sameHolder(current, identity)) return;
  try {
    removeLock(file);
  } catch {
    // Leave it: a dead pid makes it stale for the next watcher.
  }
}

export type AcquireAgentWatcherLockOptions = {
  home?: string;
  origin: string;
  /** From the identifying poll (`{"lease": false}`). Written into the lock so 0.1.2 machine-wide watchers refuse to start beside it. */
  workspaceId: string;
  agentId: string;
  agentName: string;
  /** Skips the live check on this agent's own lock only. A legacy machine-wide watcher always blocks. */
  force?: boolean;
  pid?: number;
  now?: Date;
  hostname?: string;
  bootId?: string;
  isAlive?: (pid: number) => boolean;
  /** Replace this agent's lock only when it still has this exact identity at rename time. */
  reclaim?: ReclaimLock;
  /** Test hook. Runs after the first identity check and before the check that guards the rename. */
  onBeforeTakeover?: () => void;
};

function selfOf(options: { hostname?: string; bootId?: string; pid?: number }): Self {
  return {
    hostname: options.hostname ?? hostname(),
    bootId: options.bootId ?? machineBootId(),
    pid: options.pid ?? process.pid,
  };
}

/**
 * A live legacy machine-wide watcher lock on this machine that covers `workspaceId`: a lock without an agent id
 * that names the workspace, or a pre-0.1.2 lock under the origin-scoped name for this origin or a hosted address.
 * Per-agent locks never count.
 */
export function findLegacyWatcherLock(options: {
  home?: string;
  origin: string;
  workspaceId: string;
  hostname?: string;
  bootId?: string;
  pid?: number;
  isAlive?: (pid: number) => boolean;
}): { info: WatcherLockInfo; path: string } | null {
  const home = options.home ?? homedir();
  const dir = replyslipHome(home);
  const self = selfOf(options);
  const isAlive = options.isAlive ?? pidIsAlive;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const legacyNames = new Set(
    [normalizeOrigin(options.origin), ...HOSTED_ORIGINS].map((origin) => `watcher-${legacyWatcherScopeId(origin, options.workspaceId, '')}.lock`),
  );
  legacyNames.add(`watcher-${watcherScopeId(options.workspaceId, '')}.lock`);
  for (const name of names) {
    if (!LOCK_NAME.test(name)) continue;
    const full = path.join(dir, name);
    const info = readWatcherLock(full);
    if (!info || info.agentId || !lockIsCurrent(info, self, isAlive)) continue;
    if (info.workspaceId === options.workspaceId || legacyNames.has(name)) return { info, path: full };
  }
  return null;
}

/**
 * One per-agent watcher per agent on this machine. Refuses while a legacy machine-wide watcher for the same
 * workspace is live here (lock files on this machine only; a legacy watcher elsewhere is not detected). The agent key is never written to the lock.
 */
export function acquireAgentWatcherLock(options: AcquireAgentWatcherLockOptions): AcquireWatcherLockResult {
  const home = options.home ?? homedir();
  const origin = normalizeOrigin(options.origin);
  const file = watcherLockPath(home, agentWatcherScopeId(options.agentId));
  const self = selfOf(options);
  const isAlive = options.isAlive ?? pidIsAlive;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  removeStaleTemps(path.dirname(file), isAlive);
  return withAcquireMutex(home, () => {
  const legacy = findLegacyWatcherLock({ ...options, home, origin });
  if (legacy) return { ok: false, reason: 'legacy', pid: legacy.info.pid, origin: legacy.info.origin, path: legacy.path };
  const identity: WatcherLockInfo = {
    pid: self.pid,
    startedAt: (options.now ?? new Date()).toISOString(),
    hostname: self.hostname,
    bootId: self.bootId,
    origin,
    workspaceId: options.workspaceId,
    token: randomBytes(8).toString('hex'),
    agentId: options.agentId,
    agentName: options.agentName,
  };
  return acquireMain(file, identity, self, isAlive, {
    origin,
    watcherKey: '',
    force: options.reclaim ? false : options.force,
    reclaim: options.reclaim,
    onBeforeTakeover: options.onBeforeTakeover,
  });
  });
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
  self: Self,
  isAlive: (pid: number) => boolean,
  force: boolean,
  hooks: boolean,
  options: AcquireWatcherLockOptions,
): AcquireWatcherLockResult | 'lost' {
  const reclaim = options.reclaim;
  const existing = readWatcherLock(file);
  if (reclaim) {
    if (!matchesReclaim(existing, reclaim)) return refuseReclaim(existing, self, isAlive, file);
  } else if (existing && lockIsCurrent(existing, self, isAlive) && !force) return running(existing, file);
  if (hooks) options.onBeforeTakeover?.();
  const after = readWatcherLock(file);
  if (reclaim) {
    if (!matchesReclaim(after, reclaim)) return refuseReclaim(after, self, isAlive, file);
  } else if (after && lockIsCurrent(after, self, isAlive) && !force) return running(after, file);

  const temp = writeTemp(path.dirname(file), identity);
  try {
    const placed = publish(temp, file, self, isAlive, force, reclaim);
    if (placed !== 'placed') {
      if (placed === 'lost') return 'lost';
      return { ok: false, reason: 'running', pid: placed.pid, origin: placed.origin, path: file };
    }
    if (hooks) options.onAfterCreate?.();
    const confirmed = readWatcherLock(file);
    if (sameHolder(confirmed, identity)) {
      return { ok: true, hold: createHold(file, identity) };
    }
    return 'lost';
  } finally {
    removeLock(temp);
  }
}

function matchesReclaim(info: WatcherLockInfo | null, reclaim: ReclaimLock): boolean {
  return !!info && info.pid === reclaim.pid && (info.token ?? '') === reclaim.token && info.startedAt === reclaim.startedAt;
}

function refuseReclaim(
  info: WatcherLockInfo | null,
  self: Self,
  isAlive: (pid: number) => boolean,
  file: string,
): AcquireWatcherLockResult | 'lost' {
  if (info && lockIsCurrent(info, self, isAlive)) return running(info, file);
  return 'lost';
}

function publish(
  temp: string,
  file: string,
  self: Self,
  isAlive: (pid: number) => boolean,
  force: boolean,
  reclaim?: ReclaimLock,
): 'placed' | 'lost' | { pid: number; origin: string } {
  assertMutex();
  try {
    renameSync(temp, file);
    return 'placed';
  } catch (err) {
    if (!isRenameConflict(err)) throw err;
  }
  const held = readWatcherLock(file);
  if (reclaim) {
    if (!matchesReclaim(held, reclaim)) {
      if (held && lockIsCurrent(held, self, isAlive)) return { pid: held.pid, origin: held.origin };
      return 'lost';
    }
  } else if (held && lockIsCurrent(held, self, isAlive) && !force) return { pid: held.pid, origin: held.origin };
  assertMutex();
  removeLock(file);
  assertMutex();
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

const acquireDepth = new Map<string, number>();
let mutexHold: HeldFileLock | null = null;

function assertMutex(): void {
  if (!mutexHold) return;
  if (!lockHeld(mutexHold)) {
    throw new FileLockError(`The lock helper for ${mutexHold.file} exited while the lock was held. The kernel lock is no longer held.`);
  }
}

function withAcquireMutex<T>(home: string, fn: () => T): T {
  const file = path.join(replyslipHome(home), 'acquire.mutex');
  const depth = acquireDepth.get(file) ?? 0;
  if (depth > 0) {
    acquireDepth.set(file, depth + 1);
    try {
      return fn();
    } finally {
      const next = (acquireDepth.get(file) ?? 1) - 1;
      if (next <= 0) acquireDepth.delete(file);
      else acquireDepth.set(file, next);
    }
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  acquireDepth.set(file, 1);
  let held: HeldFileLock;
  try {
    held = acquireFileLockSync(file, { waitMs: FILE_LOCK_WAIT_MS });
  } catch (err) {
    acquireDepth.delete(file);
    throw err;
  }
  mutexHold = held;
  try {
    return fn();
  } finally {
    acquireDepth.delete(file);
    mutexHold = null;
    releaseFileLock(held);
  }
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
  const key = holdKey(identity);
  heldHere.add(key);
  const release = () => {
    if (released) return;
    released = true;
    heldHere.delete(key);
    if (!sameHolder(readWatcherLock(file), identity)) return;
    removeLock(file);
  };
  const stillHeld = () => {
    const current = readWatcherLock(file);
    return { held: !released && sameHolder(current, identity), current };
  };
  return { path: file, pid: identity.pid, startedAt: identity.startedAt, token: identity.token ?? '', release, stillHeld };
}
