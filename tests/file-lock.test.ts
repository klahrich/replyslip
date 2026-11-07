import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireFileLock, FileLockError, releaseFileLock } from '../packages/cli/src/file-lock';
import { ownProcessStartedAtMs, processStartedAtMs } from '../packages/cli/src/process-identity';

async function fileInTemp(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'replyslip-flock-'));
  return path.join(dir, name);
}

function age(file: string): void {
  const old = new Date(Date.now() - 60_000);
  utimesSync(file, old, old);
}

function owner(pid: number, startedAtMs: number | null, token = '0123456789abcdef'): string {
  return `${JSON.stringify({ pid, token, startedAtMs })}\n`;
}

describe('file lock owner identity', () => {
  it('reclaims empty, partial, pid 1, and this process without hanging', async () => {
    const self = ownProcessStartedAtMs();
    const bodies = ['', '1\n', `${process.pid}\n`, '{', owner(process.pid, self, 'aaaaaaaaaaaaaaaa')];
    for (const body of bodies) {
      const file = await fileInTemp('bot.op');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
      age(file);
      const started = Date.now();
      const held = await acquireFileLock(file, { waitMs: 200 });
      expect(Date.now() - started).toBeLessThan(500);
      releaseFileLock(held);
    }
  });

  it('reclaims a dead pid and a live pid whose start time does not match', async () => {
    const dead = await fileInTemp('dead.op');
    mkdirSync(path.dirname(dead), { recursive: true });
    writeFileSync(dead, owner(1_000_000_001, 1));
    age(dead);
    const deadHeld = await acquireFileLock(dead, { waitMs: 200 });
    releaseFileLock(deadHeld);

    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
    try {
      const startedAt = processStartedAtMs(child.pid ?? 0);
      expect(startedAt).toEqual(expect.any(Number));
      const file = await fileInTemp('reused.op');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, owner(child.pid ?? 0, 1));
      age(file);
      const held = await acquireFileLock(file, { waitMs: 200 });
      releaseFileLock(held);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('does not take a lock whose live owner start time matches, and reports that', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
    try {
      const startedAt = processStartedAtMs(child.pid ?? 0);
      const file = await fileInTemp('live.op');
      mkdirSync(path.dirname(file), { recursive: true });
      const body = owner(child.pid ?? 0, startedAt);
      writeFileSync(file, body);
      const started = Date.now();
      await expect(acquireFileLock(file, { waitMs: 80 })).rejects.toBeInstanceOf(FileLockError);
      expect(Date.now() - started).toBeLessThan(500);
      expect(readFileSync(file, 'utf8')).toBe(body);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('does not delete a new owner that appears before reclaim', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
    try {
      const startedAt = processStartedAtMs(child.pid ?? 0);
      const file = await fileInTemp('swap.op');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, owner(1_000_000_002, 1, 'aaaaaaaaaaaaaaaa'));
      age(file);
      const replacement = owner(child.pid ?? 0, startedAt, 'bbbbbbbbbbbbbbbb');
      await expect(
        acquireFileLock(file, {
          waitMs: 80,
          beforeReclaim: () => {
            writeFileSync(file, replacement);
          },
        }),
      ).rejects.toThrow(/not removed/);
      expect(readFileSync(file, 'utf8')).toBe(replacement);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('lets the next waiter take the lock after the holder releases it', async () => {
    const file = await fileInTemp('hand.op');
    const first = await acquireFileLock(file, { waitMs: 200 });
    const pending = acquireFileLock(file, { waitMs: 500 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFileLock(first);
    const second = await pending;
    releaseFileLock(second);
    expect(second.token).not.toBe(first.token);
  });
});
