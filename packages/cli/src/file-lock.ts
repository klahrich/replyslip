// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { ownProcessStartedAtMs, processStartedAtMs } from './process-identity.ts';

/** A waiter gives up instead of sitting behind an unproved or still-live owner. */
export const FILE_LOCK_WAIT_MS = 2_000;
/** An empty file younger than this may still be the owner's first write. */
export const FILE_LOCK_PUBLISH_GRACE_MS = 50;

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

export type HeldFileLock = { fd: number; file: string; token: string };

type OwnerRecord = { pid: number; token: string; startedAtMs: number | null };

export type FileLockOptions = {
  waitMs?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  processStart?: (pid: number) => number | null;
  self?: { pid: number; startedAtMs: number | null };
  /** Test hook. Runs after a record is judged stale and before the compare-and-unlink. */
  beforeReclaim?: (snapshot: string) => void;
};

const heldTokens = new Set<string>();

export function acquireFileLockSync(file: string, options: FileLockOptions = {}): HeldFileLock {
  const held = acquireFileLockLoop(file, options, (ms) => {
    if (ms <= 0) return;
    const gate = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(gate, 0, 0, ms);
  });
  if (held instanceof Promise) throw new FileLockError(`Could not acquire ${file}.`);
  return held;
}

export async function acquireFileLock(file: string, options: FileLockOptions = {}): Promise<HeldFileLock> {
  const held = acquireFileLockLoop(file, options, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  return held instanceof Promise ? held : held;
}

export function releaseFileLock(held: HeldFileLock): void {
  heldTokens.delete(held.token);
  try {
    closeSync(held.fd);
  } catch {
    // Already closed.
  }
  try {
    const current = readFileSync(held.file, 'utf8');
    const owner = parseOwner(current);
    if (owner?.token === held.token) unlinkSync(held.file);
  } catch {
    // Already gone, or replaced by a newer owner. Leave that file alone.
  }
}

function acquireFileLockLoop(
  file: string,
  options: FileLockOptions,
  sleep: (ms: number) => void | Promise<void>,
): HeldFileLock | Promise<HeldFileLock> {
  const waitMs = options.waitMs ?? FILE_LOCK_WAIT_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + waitMs;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const run = (): HeldFileLock | Promise<HeldFileLock> => {
    const step = oneAttempt(file, options, now());
    if (step.held) return step.held;
    if (now() >= deadline) throw new FileLockError(busyMessage(file, step.text, waitMs));
    const pause = Math.min(10, Math.max(0, deadline - now()));
    const slept = sleep(pause);
    if (slept && typeof (slept as Promise<void>).then === 'function') {
      return (slept as Promise<void>).then(run);
    }
    return run();
  };
  return run();
}

function oneAttempt(file: string, options: FileLockOptions, nowMs: number): { held: HeldFileLock; text?: undefined } | { held?: undefined; text: string } {
  const created = tryCreate(file, options);
  if (created) return { held: created };
  let text = '';
  let mtime = 0;
  try {
    const info = statSync(file);
    mtime = info.mtimeMs;
    text = readFileSync(file, 'utf8');
  } catch {
    return { text: '' };
  }
  const kind = classify(text, mtime, nowMs, options);
  if (kind !== 'stale') return { text };
  options.beforeReclaim?.(text);
  unlinkIfUnchanged(file, text);
  return { text };
}

function tryCreate(file: string, options: FileLockOptions): HeldFileLock | null {
  const self = options.self ?? { pid: process.pid, startedAtMs: ownProcessStartedAtMs() };
  let fd: number;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
  const token = randomBytes(8).toString('hex');
  const body = `${JSON.stringify({ pid: self.pid, token, startedAtMs: self.startedAtMs })}\n`;
  try {
    writeSync(fd, body);
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      // Ignore.
    }
    try {
      unlinkSync(file);
    } catch {
      // Ignore.
    }
    throw err;
  }
  heldTokens.add(token);
  return { fd, file, token };
}

export function classifyFileLock(text: string, mtimeMs: number, nowMs: number, options: FileLockOptions = {}): 'live' | 'stale' | 'unproven' | 'publishing' {
  return classify(text, mtimeMs, nowMs, options);
}

function classify(text: string, mtimeMs: number, nowMs: number, options: FileLockOptions): 'live' | 'stale' | 'unproven' | 'publishing' {
  const owner = parseOwner(text);
  if (!owner) return nowMs - mtimeMs < FILE_LOCK_PUBLISH_GRACE_MS ? 'publishing' : 'stale';
  if (heldTokens.has(owner.token)) return 'live';
  const self = options.self ?? { pid: process.pid, startedAtMs: ownProcessStartedAtMs() };
  const alive = options.isAlive ?? pidIsAlive;
  if (owner.pid === self.pid && owner.startedAtMs === self.startedAtMs) return 'stale';
  if (!alive(owner.pid)) return 'stale';
  if (owner.startedAtMs == null) return 'unproven';
  const start = (options.processStart ?? processStartedAtMs)(owner.pid);
  if (start == null) return 'unproven';
  if (start !== owner.startedAtMs) return 'stale';
  return 'live';
}

function unlinkIfUnchanged(file: string, snapshot: string): boolean {
  let text = '';
  let first: { ino: number; dev: number; size: number };
  try {
    const opened = statSync(file);
    text = readFileSync(file, 'utf8');
    first = opened;
  } catch {
    return false;
  }
  if (text !== snapshot) return false;
  try {
    const again = statSync(file);
    if (again.ino !== first.ino || again.dev !== first.dev || again.size !== first.size) return false;
  } catch {
    return false;
  }
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function parseOwner(text: string): OwnerRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as { pid?: unknown; token?: unknown; startedAtMs?: unknown };
  if (typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid <= 0) return null;
  if (typeof row.token !== 'string' || !/^[0-9a-f]{16}$/.test(row.token)) return null;
  if (row.startedAtMs == null) return { pid: row.pid, token: row.token, startedAtMs: null };
  if (typeof row.startedAtMs !== 'number' || !Number.isFinite(row.startedAtMs)) return null;
  return { pid: row.pid, token: row.token, startedAtMs: row.startedAtMs };
}

function busyMessage(file: string, text: string, waitMs: number): string {
  const owner = parseOwner(text);
  const who = owner ? `pid ${owner.pid}` : 'an unreadable owner record';
  return `Could not acquire ${file} within ${waitMs}ms (${who}). The file was not removed because a live owner could not be ruled out. Retry after that process finishes. If replyslip is not running, delete the file.`;
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
