// SPDX-License-Identifier: Apache-2.0

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { acquireFileLock, FILE_LOCK_WAIT_MS, FileLockError, lockHeld, lockLoss, releaseFileLock, type HeldFileLock } from './file-lock.ts';
import { superviseDir } from './watcher-progress.ts';

const chains = new Map<string, Promise<void>>();

/** Checked after every await, before a spawn, signal, reap, or state write. */
export type OpGuard = {
  assertHeld(): void;
};

/**
 * One operation at a time per agent. Same-process callers queue so a stop still
 * runs after an in-flight tick and can reap that tick's child. Cross-process
 * ownership is the kernel lock, held for at most {@link FILE_LOCK_WAIT_MS} of
 * waiting. Release unlocks. It does not delete the lock path.
 */
export async function withAgentOp<T>(home: string | undefined, name: string, fn: (guard: OpGuard) => Promise<T>): Promise<T> {
  const key = `${home ?? ''}\0${name}`;
  const previous = chains.get(key) ?? Promise.resolve();
  let releaseChain = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseChain = resolve;
  });
  const tail = previous.then(() => current);
  chains.set(key, tail);
  await previous;
  mkdirSync(superviseDir(home), { recursive: true, mode: 0o700 });
  const file = path.join(superviseDir(home), `${name}.op`);
  let held: HeldFileLock;
  try {
    held = await acquireFileLock(file, { waitMs: FILE_LOCK_WAIT_MS });
  } catch (err) {
    releaseChain();
    if (chains.get(key) === tail) chains.delete(key);
    throw err;
  }
  const guard: OpGuard = {
    assertHeld() {
      if (!lockHeld(held)) {
        throw new FileLockError(`The lock helper for ${held.file} exited while the lock was held. The kernel lock is no longer held.`);
      }
    },
  };
  const lost = lockLoss(held);
  let primary: unknown;
  let result: T | undefined;
  try {
    result = await Promise.race([fn(guard), lost]);
    if (!lockHeld(held)) {
      primary = new FileLockError(`The lock helper for ${held.file} exited while the lock was held. The kernel lock is no longer held.`);
    }
  } catch (err) {
    primary = err;
  } finally {
    held.stopWatch();
  }
  let cleanupError: unknown;
  try {
    releaseFileLock(held);
  } catch (err) {
    cleanupError = err;
  }
  releaseChain();
  if (chains.get(key) === tail) chains.delete(key);
  if (primary) throw primary;
  if (cleanupError) throw cleanupError;
  return result as T;
}
