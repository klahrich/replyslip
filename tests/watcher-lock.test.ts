// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, stat } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplyslip } from '../packages/cli/src/cli';
import {
  WATCHER_NOT_RUNNING_MESSAGE,
  acquireWatcherLock,
  alreadyRunningMessage,
  bindWatcherLockLifecycle,
  listLiveWatcherLocks,
  machineBootId,
  normalizeOrigin,
  pidIsAlive,
  readWatcherLock,
  roundedBootId,
  runningStatusMessage,
  watcherLockPath,
  watcherScopeId,
} from '../packages/cli/src/watcher-lock';

const ORIGIN = 'https://replyslip.com';
const KEY = 'rsw_test_secret';

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

function liveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
}

function writeLock(
  home: string,
  fields: {
    pid: number;
    origin?: string;
    workspaceId?: string | null;
    watcherKey?: string;
    startedAt?: string;
    hostname?: string;
    bootId?: string;
  },
): string {
  const origin = normalizeOrigin(fields.origin ?? ORIGIN);
  const workspaceId = fields.workspaceId === undefined ? 'ws-1' : fields.workspaceId;
  const watcherKey = fields.watcherKey ?? KEY;
  const file = watcherLockPath(home, watcherScopeId(origin, workspaceId, watcherKey));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      pid: fields.pid,
      startedAt: fields.startedAt ?? '2026-01-01T00:00:00.000Z',
      hostname: fields.hostname ?? hostname(),
      bootId: fields.bootId ?? machineBootId(),
      origin,
    })}\n`,
  );
  return file;
}

describe('watcher lock', () => {
  it('names the lock from the origin and workspace, never the key', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const scope = createHash('sha256').update(`${ORIGIN}\nws-1`).digest('hex').slice(0, 16);
    expect(watcherScopeId(`${ORIGIN}/`, 'ws-1', KEY)).toBe(scope);
    const keyHash = createHash('sha256').update(KEY).digest('hex');
    expect(watcherScopeId(ORIGIN, null, KEY)).toBe(
      createHash('sha256').update(`${ORIGIN}\n${keyHash}`).digest('hex').slice(0, 16),
    );

    const now = new Date('2026-10-25T12:00:00.000Z');
    const acquired = acquireWatcherLock({ home, origin: `${ORIGIN}/`, workspaceId: 'ws-1', watcherKey: KEY, now });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(path.basename(acquired.hold.path)).toBe(`watcher-${scope}.lock`);
    expect(acquired.hold.path).not.toContain(KEY);
    const text = readFileSync(acquired.hold.path, 'utf8');
    expect(text).not.toContain(KEY);
    expect(readWatcherLock(acquired.hold.path)).toEqual({
      pid: process.pid,
      startedAt: now.toISOString(),
      hostname: hostname(),
      bootId: machineBootId(),
      origin: ORIGIN,
      workspaceId: 'ws-1',
    });
    const info = await stat(acquired.hold.path);
    expect(info.mode & 0o077).toBe(0);

    const second = acquireWatcherLock({ home, origin: ORIGIN, workspaceId: 'ws-1', watcherKey: KEY });
    expect(second).toEqual({ ok: false, reason: 'running', pid: process.pid });
    expect(readWatcherLock(acquired.hold.path)?.startedAt).toBe(now.toISOString());
    acquired.hold.release();
    expect(readWatcherLock(acquired.hold.path)).toBeNull();
  });

  it('lets two workspaces and two servers each hold a lock in one home', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const host = hostname();
    const bootId = 'boot-shared';
    const isAlive = (pid: number) => pid === 11 || pid === 22 || pid === 33;
    const first = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-a',
      watcherKey: 'rsw_workspace_a',
      pid: 11,
      hostname: host,
      bootId,
      isAlive,
    });
    const second = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-b',
      watcherKey: 'rsw_workspace_b',
      pid: 22,
      hostname: host,
      bootId,
      isAlive,
    });
    const otherServer = acquireWatcherLock({
      home,
      origin: 'https://other.example',
      workspaceId: 'ws-a',
      watcherKey: 'rsw_workspace_a',
      pid: 33,
      hostname: host,
      bootId,
      isAlive,
    });
    expect(first.ok && second.ok && otherServer.ok).toBe(true);
    if (!first.ok || !second.ok || !otherServer.ok) return;
    expect(new Set([first.hold.path, second.hold.path, otherServer.hold.path]).size).toBe(3);
    for (const hold of [first.hold, second.hold, otherServer.hold]) {
      expect(readFileSync(hold.path, 'utf8')).not.toContain('rsw_');
    }
    const again = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-a',
      watcherKey: 'rsw_other_key_same_workspace',
      pid: 44,
      hostname: host,
      bootId,
      isAlive: () => true,
    });
    expect(again).toEqual({ ok: false, reason: 'running', pid: 11 });
    expect(readWatcherLock(first.hold.path)?.pid).toBe(11);

    const fallbackA = acquireWatcherLock({
      home,
      origin: 'https://legacy.example',
      workspaceId: null,
      watcherKey: 'rsw_key_a',
      pid: 11,
      hostname: host,
      bootId,
      isAlive,
    });
    const fallbackB = acquireWatcherLock({
      home,
      origin: 'https://legacy.example',
      workspaceId: null,
      watcherKey: 'rsw_key_b',
      pid: 22,
      hostname: host,
      bootId,
      isAlive,
    });
    expect(fallbackA.ok && fallbackB.ok).toBe(true);
    if (!fallbackA.ok || !fallbackB.ok) return;
    expect(fallbackA.hold.path).not.toBe(fallbackB.hold.path);
    expect(readFileSync(fallbackA.hold.path, 'utf8')).not.toContain('rsw_key_a');
  });

  it('treats a different boot id as stale even when the pid is alive', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const child = liveChild();
    try {
      const pid = child.pid ?? 0;
      expect(pidIsAlive(pid)).toBe(true);
      const file = writeLock(home, { pid, bootId: 'previous-boot' });
      expect(listLiveWatcherLocks(home)).toEqual([]);
      const acquired = acquireWatcherLock({ home, origin: ORIGIN, workspaceId: 'ws-1', watcherKey: KEY });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      expect(readWatcherLock(file)).toMatchObject({ pid: process.pid, bootId: machineBootId(), hostname: hostname() });
      expect(listLiveWatcherLocks(home)).toEqual([
        expect.objectContaining({ pid: process.pid, origin: ORIGIN, bootId: machineBootId() }),
      ]);
      acquired.hold.release();
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('reads the linux boot id and rounds the fallback to the minute', () => {
    const bootFile = '/proc/sys/kernel/random/boot_id';
    try {
      const text = readFileSync(bootFile, 'utf8').trim();
      if (text) expect(machineBootId()).toBe(text);
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
    expect(roundedBootId(1_700_000_000_000, 90)).toBe('1699999920000');
    expect(roundedBootId(120_000, 0)).toBe('120000');
  });

  it('backs off when another process replaces the lock during takeover', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const host = hostname();
    const bootId = 'boot-current';
    const alive = new Set([111, 222]);
    const isAlive = (pid: number) => alive.has(pid);
    writeLock(home, { pid: 50, bootId: 'boot-old', hostname: host, startedAt: '2020-01-01T00:00:00.000Z' });
    const file = watcherLockPath(home, watcherScopeId(ORIGIN, 'ws-1', KEY));

    const nested = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-1',
      watcherKey: KEY,
      pid: 111,
      now: new Date('2026-10-25T12:00:00.000Z'),
      hostname: host,
      bootId,
      isAlive,
      onBeforeTakeover: () => {
        const winner = acquireWatcherLock({
          home,
          origin: ORIGIN,
          workspaceId: 'ws-1',
          watcherKey: KEY,
          pid: 222,
          now: new Date('2026-10-25T12:00:01.000Z'),
          hostname: host,
          bootId,
          isAlive,
        });
        expect(winner.ok).toBe(true);
      },
    });
    expect(nested).toEqual({ ok: false, reason: 'running', pid: 222 });
    expect(readWatcherLock(file)?.pid).toBe(222);

    writeLock(home, { pid: 50, bootId: 'boot-old', hostname: host, startedAt: '2020-01-01T00:00:00.000Z' });
    const replaced = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-1',
      watcherKey: KEY,
      pid: 111,
      now: new Date('2026-10-25T12:00:02.000Z'),
      hostname: host,
      bootId,
      isAlive,
      onAfterCreate: () => {
        writeFileSync(
          file,
          `${JSON.stringify({
            pid: 222,
            startedAt: '2026-10-25T12:00:03.000Z',
            hostname: host,
            bootId,
            origin: ORIGIN,
          })}\n`,
        );
      },
    });
    expect(replaced).toEqual({ ok: false, reason: 'running', pid: 222 });
    expect(readWatcherLock(file)).toMatchObject({ pid: 222, startedAt: '2026-10-25T12:00:03.000Z' });
  });

  it('leaves an already-held live lock in place', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const child = liveChild();
    try {
      const pid = child.pid ?? 0;
      const file = writeLock(home, { pid, startedAt: '2026-01-01T00:00:00.000Z' });
      const acquired = acquireWatcherLock({ home, origin: ORIGIN, workspaceId: 'ws-1', watcherKey: KEY });
      expect(acquired).toEqual({ ok: false, reason: 'running', pid });
      expect(readWatcherLock(file)).toMatchObject({ pid, startedAt: '2026-01-01T00:00:00.000Z' });
      expect(listLiveWatcherLocks(home)).toEqual([
        expect.objectContaining({ pid, origin: ORIGIN, startedAt: '2026-01-01T00:00:00.000Z' }),
      ]);
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
    const file = writeLock(home, { pid: stalePid, startedAt: '2020-01-01T00:00:00.000Z' });
    expect(listLiveWatcherLocks(home)).toEqual([]);
    writeFileSync(file, '{not json');
    const corrupt = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-1',
      watcherKey: KEY,
      now: new Date('2026-10-25T11:00:00.000Z'),
    });
    expect(corrupt.ok).toBe(true);
    if (!corrupt.ok) return;
    corrupt.hold.release();
    writeLock(home, { pid: stalePid, startedAt: '2020-01-01T00:00:00.000Z' });

    const acquired = acquireWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-1',
      watcherKey: KEY,
      now: new Date('2026-10-25T12:00:00.000Z'),
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(readWatcherLock(file)?.pid).toBe(process.pid);

    writeLock(home, { pid: stalePid, startedAt: '1999-01-01T00:00:00.000Z' });
    acquired.hold.release();
    expect(readFileSync(file, 'utf8')).toContain(`"pid":${stalePid}`);

    const again = acquireWatcherLock({ home, origin: ORIGIN, workspaceId: 'ws-1', watcherKey: KEY });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    again.hold.release();
    expect(listLiveWatcherLocks(home)).toEqual([]);
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

  it('lists every live lock and refuses a second watch for the same workspace', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
    const idle = capture();
    expect(await runReplyslip(['watch', '--status'], { home, stdout: idle.stdout, stderr: idle.stderr })).toBe(0);
    expect(idle.out).toEqual([WATCHER_NOT_RUNNING_MESSAGE]);

    const childA = liveChild();
    const childB = liveChild();
    try {
      writeLock(home, { pid: childA.pid ?? 0, origin: 'https://a.example', workspaceId: 'ws-a' });
      writeLock(home, { pid: childB.pid ?? 0, origin: 'https://b.example', workspaceId: 'ws-b' });
      writeFileSync(path.join(home, '.replyslip', 'watcher.lock'), '{"pid":1}\n');
      const status = capture();
      expect(await runReplyslip(['watch', '--status'], { home, stdout: status.stdout, stderr: status.stderr })).toBe(0);
      expect(status.out).toEqual([
        runningStatusMessage(childA.pid ?? 0, 'https://a.example'),
        runningStatusMessage(childB.pid ?? 0, 'https://b.example'),
      ]);

      const blockedHome = await mkdtemp(path.join(tmpdir(), 'replyslip-lock-'));
      const blockedFile = writeLock(blockedHome, { pid: childA.pid ?? 0, origin: ORIGIN, workspaceId: 'ws-1' });
      let fetches = 0;
      const blocked = capture();
      const code = await runReplyslip(['watch', '--once', '--url', ORIGIN, '--key', KEY], {
        home: blockedHome,
        stdout: blocked.stdout,
        stderr: blocked.stderr,
        fetchImpl: async () => {
          fetches += 1;
          return new Response(JSON.stringify({ wakes: [], workspace_id: 'ws-1' }), { status: 200 });
        },
      });
      expect(code).toBe(0);
      expect(fetches).toBe(1);
      expect(blocked.out).toEqual([alreadyRunningMessage(childA.pid ?? 0)]);
      expect(readWatcherLock(blockedFile)?.pid).toBe(childA.pid);
      expect(readFileSync(blockedFile, 'utf8')).not.toContain(KEY);

      const forced = capture();
      const forcedCode = await runReplyslip(['watch', '--once', '--force', '--url', ORIGIN, '--key', KEY], {
        home: blockedHome,
        stdout: forced.stdout,
        stderr: forced.stderr,
        fetchImpl: async () => new Response(JSON.stringify({ wakes: [], workspace_id: 'ws-1' }), { status: 200 }),
      });
      expect(forcedCode).toBe(0);
      expect(forced.out).toEqual([]);
      expect(readWatcherLock(blockedFile)).toBeNull();
    } finally {
      childA.kill();
      childB.kill();
      await Promise.all([once(childA, 'exit'), once(childB, 'exit')]);
    }
  });
});
