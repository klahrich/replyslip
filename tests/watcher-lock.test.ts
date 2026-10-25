// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplyslip } from '../packages/cli/src/cli';
import {
  WATCHER_NOT_RUNNING_MESSAGE,
  acquireWatcherLock,
  alreadyRunningMessage,
  bindWatcherLockLifecycle,
  pidIsAlive,
  readWatcherLock,
  runningStatusMessage,
  watcherLockPath,
  watcherStatus,
} from '../packages/cli/src/watcher-lock';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

function writeLock(home: string, pid: number, startedAt = '2020-01-01T00:00:00.000Z'): void {
  const file = watcherLockPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pid, startedAt })}\n`);
}

function liveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
}

describe('watcher lock', () => {
  it('acquires an exclusive lock with pid and start time', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const now = new Date('2026-10-25T12:00:00.000Z');
    const acquired = acquireWatcherLock({ home, now });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const onDisk = readWatcherLock(acquired.hold.path);
    expect(onDisk).toEqual({ pid: process.pid, startedAt: now.toISOString() });
    const info = await stat(acquired.hold.path);
    expect(info.mode & 0o077).toBe(0);

    const second = acquireWatcherLock({ home });
    expect(second).toEqual({ ok: false, reason: 'running', pid: process.pid });
    expect(readWatcherLock(acquired.hold.path)?.startedAt).toBe(now.toISOString());
    acquired.hold.release();
    expect(readWatcherLock(acquired.hold.path)).toBeNull();
  });

  it('leaves an already-held live lock in place', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const child = liveChild();
    try {
      expect(child.pid).toBeGreaterThan(0);
      writeLock(home, child.pid ?? 0, '2026-01-01T00:00:00.000Z');
      expect(pidIsAlive(child.pid ?? 0)).toBe(true);
      const acquired = acquireWatcherLock({ home });
      expect(acquired).toEqual({ ok: false, reason: 'running', pid: child.pid });
      expect(readWatcherLock(watcherLockPath(home))).toEqual({
        pid: child.pid,
        startedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(watcherStatus(home)).toEqual({
        running: true,
        lock: { pid: child.pid, startedAt: '2026-01-01T00:00:00.000Z' },
      });
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('takes over a stale lock and releases only its own file', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const child = liveChild();
    const deadPid = child.pid ?? 0;
    child.kill();
    await once(child, 'exit');
    const stalePid = pidIsAlive(deadPid) ? 2_147_483_646 : deadPid;
    expect(pidIsAlive(stalePid)).toBe(false);
    writeLock(home, stalePid, '2020-01-01T00:00:00.000Z');
    expect(watcherStatus(home).running).toBe(false);
    writeFileSync(watcherLockPath(home), '{not json');
    const corrupt = acquireWatcherLock({ home, now: new Date('2026-10-25T11:00:00.000Z') });
    expect(corrupt.ok).toBe(true);
    if (!corrupt.ok) return;
    corrupt.hold.release();
    writeLock(home, stalePid, '2020-01-01T00:00:00.000Z');

    const acquired = acquireWatcherLock({ home, now: new Date('2026-10-25T12:00:00.000Z') });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(readWatcherLock(acquired.hold.path)?.pid).toBe(process.pid);

    writeLock(home, stalePid, '1999-01-01T00:00:00.000Z');
    acquired.hold.release();
    expect(readFileSync(watcherLockPath(home), 'utf8')).toContain(`"pid":${stalePid}`);

    const again = acquireWatcherLock({ home });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    again.hold.release();
    expect(watcherStatus(home).running).toBe(false);
  });

  it('binds SIGINT, SIGTERM, and exit, then unbinds them', () => {
    const before = {
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
      exit: process.listenerCount('exit'),
    };
    const unbind = bindWatcherLockLifecycle(() => undefined);
    expect(process.listenerCount('SIGINT')).toBe(before.sigint + 1);
    expect(process.listenerCount('SIGTERM')).toBe(before.sigterm + 1);
    expect(process.listenerCount('exit')).toBe(before.exit + 1);
    unbind();
    expect(process.listenerCount('SIGINT')).toBe(before.sigint);
    expect(process.listenerCount('SIGTERM')).toBe(before.sigterm);
    expect(process.listenerCount('exit')).toBe(before.exit);
  });

  it('reports status, refuses a second watch, and lets --force through', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const idle = capture();
    expect(await runReplyslip(['watch', '--status'], { home, stdout: idle.stdout, stderr: idle.stderr })).toBe(0);
    expect(idle.out).toEqual([WATCHER_NOT_RUNNING_MESSAGE]);

    const child = liveChild();
    try {
      writeLock(home, child.pid ?? 0);
      const status = capture();
      expect(await runReplyslip(['watch', '--status'], { home, stdout: status.stdout, stderr: status.stderr })).toBe(0);
      expect(status.out).toEqual([runningStatusMessage(child.pid ?? 0)]);

      let fetched = false;
      const blocked = capture();
      const code = await runReplyslip(['watch', '--once', '--url', 'https://replyslip.com', '--key', 'rsw_test'], {
        home,
        stdout: blocked.stdout,
        stderr: blocked.stderr,
        fetchImpl: async () => {
          fetched = true;
          return new Response('{"wakes":[]}', { status: 200 });
        },
      });
      expect(code).toBe(0);
      expect(fetched).toBe(false);
      expect(blocked.out).toEqual([alreadyRunningMessage(child.pid ?? 0)]);
      expect(readWatcherLock(watcherLockPath(home))?.pid).toBe(child.pid);

      const forced = capture();
      const forcedCode = await runReplyslip(
        ['watch', '--once', '--force', '--url', 'https://replyslip.com', '--key', 'rsw_test'],
        {
          home,
          stdout: forced.stdout,
          stderr: forced.stderr,
          fetchImpl: async () => new Response('{"wakes":[]}', { status: 200 }),
        },
      );
      expect(forcedCode).toBe(0);
      expect(forced.out).toEqual([]);
      expect(readWatcherLock(watcherLockPath(home))).toBeNull();
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });
});
