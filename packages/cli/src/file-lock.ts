// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { ownProcessStartedAtMs, processStartedAtMs } from './process-identity.ts';

/** A waiter gives up instead of sitting behind an unproved or still-live owner. */
export const FILE_LOCK_WAIT_MS = 2_000;

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

export type HeldFileLock = { fd: number; file: string; token: string };

type OwnerRecord = { pid: number; token: string; startedAtMs: number | null };

type Draft = { fd: number; temp: string; token: string; body: string; closed: boolean };

export type FileLockOptions = {
  waitMs?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  processStart?: (pid: number) => number | null;
  self?: { pid: number; startedAtMs: number | null };
  /**
   * Runs after the owner record is on a private file and before `link` publishes the lock name.
   * The lock name does not exist yet. A throw or a partial rewrite aborts the publish.
   */
  beforePublish?: (temp: string) => void | Promise<void>;
  /** Runs after a record is judged stale and before the rename that claims that directory entry. */
  beforeReclaim?: (snapshot: string) => void;
};

const heldTokens = new Set<string>();

export function acquireFileLockSync(file: string, options: FileLockOptions = {}): HeldFileLock {
  const held = runLock(file, options, (ms) => {
    if (ms <= 0) return;
    const gate = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(gate, 0, 0, ms);
  });
  if (held instanceof Promise) throw new FileLockError(`Could not acquire ${file}.`);
  return held;
}

export async function acquireFileLock(file: string, options: FileLockOptions = {}): Promise<HeldFileLock> {
  const held = runLock(file, options, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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

function runLock(file: string, options: FileLockOptions, sleep: (ms: number) => void | Promise<void>): HeldFileLock | Promise<HeldFileLock> {
  const waitMs = options.waitMs ?? FILE_LOCK_WAIT_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + waitMs;
  const processStart = startReader(options);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const turn = (): HeldFileLock | Promise<HeldFileLock> => {
    const draft = beginPublish(file, options);
    const finish = (): HeldFileLock | Promise<HeldFileLock> | null => {
      const held = commitPublish(draft, file);
      if (held) return held;
      const seen = observe(file, options, processStart);
      if (seen.kind === 'stale') {
        options.beforeReclaim?.(seen.text);
        if (reclaimSnapshot(file, seen.text)) return null;
      }
      if (now() >= deadline) throw new FileLockError(busyMessage(file, seen.text, waitMs));
      return pause(Math.min(10, Math.max(0, deadline - now())));
    };
    const pause = (ms: number): HeldFileLock | Promise<HeldFileLock> => {
      const slept = sleep(ms);
      if (slept && typeof (slept as Promise<void>).then === 'function') return (slept as Promise<void>).then(turn);
      return turn();
    };
    if (!options.beforePublish) return finish() ?? turn();
    let hooked: void | Promise<void>;
    try {
      hooked = options.beforePublish(draft.temp);
    } catch (err) {
      abortPublish(draft);
      throw err;
    }
    if (hooked && typeof (hooked as Promise<void>).then === 'function') {
      return (hooked as Promise<void>).then(
        () => finish() ?? turn(),
        (err: unknown) => {
          abortPublish(draft);
          throw err;
        },
      );
    }
    return finish() ?? turn();
  };
  return turn();
}

/**
 * The lock name is created by `link`, which does not overwrite. The private file already
 * holds the complete owner record, so the name never appears empty or partial.
 * `link` failure means someone else owns the name. This attempt is not a holder.
 */
function beginPublish(file: string, options: FileLockOptions): Draft {
  const self = options.self ?? { pid: process.pid, startedAtMs: ownProcessStartedAtMs() };
  const token = randomBytes(8).toString('hex');
  const temp = `${file}.${token}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  const body = `${JSON.stringify({ pid: self.pid, token, startedAtMs: self.startedAtMs })}\n`;
  const draft: Draft = { fd, temp, token, body, closed: false };
  try {
    const written = writeSync(fd, body);
    if (written !== Buffer.byteLength(body)) throw new FileLockError(`Could not write the owner record for ${file}.`);
    fsyncSync(fd);
  } catch (err) {
    abortPublish(draft);
    throw err;
  }
  return draft;
}

function commitPublish(draft: Draft, file: string): HeldFileLock | null {
  let onDisk = '';
  try {
    onDisk = readFileSync(draft.temp, 'utf8');
  } catch (err) {
    abortPublish(draft);
    throw err;
  }
  if (onDisk !== draft.body) {
    abortPublish(draft);
    return null;
  }
  try {
    linkSync(draft.temp, file);
  } catch (err) {
    abortPublish(draft);
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
  const mine = fstatSync(draft.fd);
  let linked: { ino: number; dev: number };
  try {
    linked = statSync(file);
  } catch {
    abortPublish(draft);
    return null;
  }
  if (mine.ino !== linked.ino || mine.dev !== linked.dev) {
    abortPublish(draft);
    return null;
  }
  try {
    unlinkSync(draft.temp);
  } catch {
    // The lock name still refers to this inode.
  }
  heldTokens.add(draft.token);
  draft.closed = true;
  return { fd: draft.fd, file, token: draft.token };
}

function abortPublish(draft: Draft): void {
  closeDraft(draft);
  try {
    unlinkSync(draft.temp);
  } catch {
    // Already gone.
  }
}

function closeDraft(draft: Draft): void {
  if (draft.closed) return;
  draft.closed = true;
  try {
    closeSync(draft.fd);
  } catch {
    // Already closed.
  }
}

function observe(
  file: string,
  options: FileLockOptions,
  processStart: (pid: number) => number | null,
): { kind: 'absent' | 'live' | 'stale' | 'unproven'; text: string } {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { kind: 'absent', text: '' };
  }
  return { kind: classify(text, options, processStart), text };
}

/**
 * Rename is the claim on the current directory entry. Only one caller can rename it.
 * The renamed inode is deleted only when its bytes are still the stale snapshot.
 * Anything else is linked back under the lock name when that name is free.
 */
function reclaimSnapshot(file: string, snapshot: string): boolean {
  const aside = `${file}.${randomBytes(8).toString('hex')}.aside`;
  try {
    renameSync(file, aside);
  } catch {
    return false;
  }
  let text = '';
  try {
    text = readFileSync(aside, 'utf8');
  } catch {
    return false;
  }
  if (text !== snapshot) {
    try {
      linkSync(aside, file);
      unlinkSync(aside);
    } catch {
      // The lock name was taken. Leave the displaced inode beside it.
    }
    return false;
  }
  try {
    unlinkSync(aside);
  } catch {
    // The name is already gone.
  }
  return true;
}

export function classifyFileLock(text: string, options: FileLockOptions = {}): 'live' | 'stale' | 'unproven' {
  return classify(text, options, options.processStart ?? processStartedAtMs);
}

function classify(text: string, options: FileLockOptions, processStart: (pid: number) => number | null): 'live' | 'stale' | 'unproven' {
  const owner = parseOwner(text);
  if (!owner) return 'stale';
  if (heldTokens.has(owner.token)) return 'live';
  const self = options.self ?? { pid: process.pid, startedAtMs: ownProcessStartedAtMs() };
  const alive = options.isAlive ?? pidIsAlive;
  if (owner.pid === self.pid && owner.startedAtMs === self.startedAtMs) return 'stale';
  if (!alive(owner.pid)) return 'stale';
  if (owner.startedAtMs == null) return 'unproven';
  const start = processStart(owner.pid);
  if (start == null) return 'unproven';
  if (start !== owner.startedAtMs) return 'stale';
  return 'live';
}

function startReader(options: FileLockOptions): (pid: number) => number | null {
  if (options.processStart) return options.processStart;
  const cache = new Map<number, number | null>();
  return (pid) => {
    if (cache.has(pid)) return cache.get(pid) ?? null;
    const value = processStartedAtMs(pid);
    cache.set(pid, value);
    return value;
  };
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
