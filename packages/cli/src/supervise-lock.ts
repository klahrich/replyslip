// SPDX-License-Identifier: Apache-2.0

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { pidIsAlive } from './watcher-lock.ts';
import { superviseDir } from './watcher-progress.ts';

const chains = new Map<string, Promise<void>>();

/**
 * One operation at a time per agent, in this process and across processes.
 * Stop, install, uninstall, and a supervision tick all take it, so a stop cannot
 * observe a half-finished spawn and a spawn cannot start after stop has committed.
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
  const fd = await lockOpFile(file);
  try {
    return await fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Already closed.
    }
    try {
      unlinkSync(file);
    } catch {
      // The next waiter retries.
    }
    releaseChain();
    if (chains.get(key) === tail) chains.delete(key);
  }
}

async function lockOpFile(file: string): Promise<number> {
  for (;;) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      writeSync(fd, `${process.pid}\n`);
      return fd;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let holder = 0;
      try {
        holder = Number(readFileSync(file, 'utf8'));
      } catch {
        holder = 0;
      }
      if (holder > 0 && holder !== process.pid && !pidIsAlive(holder)) {
        try {
          unlinkSync(file);
        } catch {
          // Another waiter took it.
        }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
