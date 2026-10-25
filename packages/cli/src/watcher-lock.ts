// SPDX-License-Identifier: Apache-2.0

import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { replyslipHome } from './register.ts';

export type WatcherLockInfo = {
  pid: number;
  startedAt: string;
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

export function watcherLockPath(home = homedir()): string {
  return path.join(replyslipHome(home), 'watcher.lock');
}

export function alreadyRunningMessage(pid: number): string {
  return `A ReplySlip watcher is already running on this machine (pid ${pid}); it delivers every local agent in this workspace.`;
}

export function runningStatusMessage(pid: number): string {
  return `A ReplySlip watcher is running on this machine (pid ${pid}); it delivers every local agent in this workspace.`;
}

export const WATCHER_NOT_RUNNING_MESSAGE = 'No ReplySlip watcher is running on this machine.';

export function readWatcherLock(file: string): WatcherLockInfo | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { pid?: unknown; startedAt?: unknown };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.startedAt !== 'string' || parsed.startedAt.trim() === '') return null;
    return { pid: parsed.pid, startedAt: parsed.startedAt };
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

export function watcherStatus(home = homedir()): { running: boolean; lock: WatcherLockInfo | null } {
  const lock = readWatcherLock(watcherLockPath(home));
  if (!lock || !pidIsAlive(lock.pid)) return { running: false, lock };
  return { running: true, lock };
}

/**
 * Exclusive lock via O_EXCL (`'wx'`). A live pid wins. A dead pid, or an unreadable file, is stale:
 * unlink it and retry the create once. `--force` replaces the file even when the pid is live.
 */
export function acquireWatcherLock(options?: { home?: string; force?: boolean; pid?: number; now?: Date }): AcquireWatcherLockResult {
  const home = options?.home ?? homedir();
  const file = watcherLockPath(home);
  const pid = options?.pid ?? process.pid;
  const startedAt = (options?.now ?? new Date()).toISOString();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  if (options?.force) removeLock(file);
  if (tryCreate(file, pid, startedAt)) return { ok: true, hold: createHold(file, pid, startedAt) };

  const existing = readWatcherLock(file);
  if (existing && pidIsAlive(existing.pid)) {
    if (!options?.force) return { ok: false, reason: 'running', pid: existing.pid };
    removeLock(file);
    if (tryCreate(file, pid, startedAt)) return { ok: true, hold: createHold(file, pid, startedAt) };
    const replaced = readWatcherLock(file);
    if (replaced && pidIsAlive(replaced.pid)) return { ok: false, reason: 'running', pid: replaced.pid };
    throw new Error('Could not acquire the ReplySlip watcher lock.');
  }

  removeLock(file);
  if (tryCreate(file, pid, startedAt)) return { ok: true, hold: createHold(file, pid, startedAt) };

  const raced = readWatcherLock(file);
  if (raced && pidIsAlive(raced.pid)) return { ok: false, reason: 'running', pid: raced.pid };
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

function tryCreate(file: string, pid: number, startedAt: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    writeSync(fd, `${JSON.stringify({ pid, startedAt })}\n`);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores the Unix mode. The lock still holds the pid.
  }
  return true;
}

function removeLock(file: string): void {
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function createHold(file: string, pid: number, startedAt: string): WatcherLockHold {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const current = readWatcherLock(file);
    if (!current || current.pid !== pid || current.startedAt !== startedAt) return;
    removeLock(file);
  };
  return { path: file, pid, startedAt, release };
}
