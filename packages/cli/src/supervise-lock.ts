// SPDX-License-Identifier: Apache-2.0

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { acquireFileLock, FILE_LOCK_WAIT_MS, releaseFileLock, type HeldFileLock } from './file-lock.ts';
import { superviseDir } from './watcher-progress.ts';

const chains = new Map<string, Promise<void>>();

/**
 * One operation at a time per agent. Same-process callers queue so a stop still
 * runs after an in-flight tick and can reap that tick's child. Cross-process
 * ownership is the kernel lock, held for at most {@link FILE_LOCK_WAIT_MS} of
 * waiting. Release unlocks. It does not delete the lock path.
 */
export async function withAgentOp<T>(home: string | undefined, name: string, fn: () => Promise<T>): Promise<T> {
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
  try {
    return await fn();
  } finally {
    releaseFileLock(held);
    releaseChain();
    if (chains.get(key) === tail) chains.delete(key);
  }
}
