import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireFileLock, acquireFileLockSync, FileLockError, lockHeld, lockHelperFor, lookupExecutable, releaseFileLock } from '../packages/cli/src/file-lock';
import { withAgentOp } from '../packages/cli/src/supervise-lock';

async function lockPath(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'replyslip-flock-'));
  return path.join(dir, name);
}

describe('file lock ownership', () => {
  it('selects a kernel helper and fails closed when none exists', () => {
    expect(lockHelperFor('win32', { perl: true, flock: true, powershell: true })).toBe('powershell');
    expect(lockHelperFor('darwin', { perl: true, flock: false, powershell: false })).toBe('perl');
    expect(lockHelperFor('linux', { perl: false, flock: true, powershell: false })).toBe('flock');
    expect(lockHelperFor('linux', { perl: false, flock: false, powershell: false })).toBeNull();
    expect(lockHelperFor('freebsd', { perl: true, flock: false, powershell: false })).toBe('perl');
    const powershell = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
    expect(
      lookupExecutable(
        ['powershell.exe', 'pwsh.exe'],
        String.raw`C:\missing;C:\Windows\System32\WindowsPowerShell\v1.0`,
        (candidate) => candidate === powershell,
        'win32',
      ),
    ).toBe(powershell);
    expect(lookupExecutable(['pwsh'], String.raw`C:\Program Files\PowerShell\7`, (candidate) => candidate.endsWith(`${path.win32.sep}pwsh.exe`), 'win32')).toMatch(/pwsh\.exe$/);
    expect(lookupExecutable(['perl'], '/missing:/usr/bin', (candidate) => candidate === '/usr/bin/perl', 'linux')).toBe('/usr/bin/perl');
    expect(lookupExecutable(['perl'], '', () => true, 'linux')).toBeNull();
    expect(lookupExecutable(['flock'], '/bin', () => false, 'darwin')).toBeNull();
  });

  it('premise is false: path-based read/check then destructive operation can safely reclaim/release shared ownership', async () => {
    const file = await lockPath('premise.op');
    mkdirSync(path.dirname(file), { recursive: true });
    const holder = acquireFileLockSync(file, { waitMs: 1_000 });
    const before = statSync(file).ino;
    readFileSync(file);
    unlinkSync(file);
    const successor = acquireFileLockSync(file, { waitMs: 1_000 });
    expect(lockHeld(holder)).toBe(true);
    expect(lockHeld(successor)).toBe(true);
    expect(() => process.kill(holder.helperPid, 0)).not.toThrow();
    expect(() => process.kill(successor.helperPid, 0)).not.toThrow();
    expect(statSync(file).ino).not.toBe(before);
    releaseFileLock(holder);
    releaseFileLock(successor);
  });

  it('one holder excludes a competing publisher until release', async () => {
    const file = await lockPath('compete.op');
    const holder = acquireFileLockSync(file, { waitMs: 1_000 });
    const inode = statSync(file).ino;
    const started = Date.now();
    expect(() => acquireFileLockSync(file, { waitMs: 80 })).toThrow(FileLockError);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(statSync(file).ino).toBe(inode);
    releaseFileLock(holder);
    const next = acquireFileLockSync(file, { waitMs: 1_000 });
    expect(statSync(file).ino).toBe(inode);
    expect(() => acquireFileLockSync(file, { waitMs: 80 })).toThrow(FileLockError);
    releaseFileLock(next);
  });

  it('release does not unlink a successor that acquired the same inode', async () => {
    const file = await lockPath('successor.op');
    writeFileSync(file, 'stale-owner\n');
    const first = acquireFileLockSync(file, { waitMs: 1_000 });
    const inode = statSync(file).ino;
    releaseFileLock(first);
    expect(statSync(file).ino).toBe(inode);
    expect(readFileSync(file, 'utf8')).toBe('stale-owner\n');
    const successor = acquireFileLockSync(file, { waitMs: 1_000 });
    expect(statSync(file).ino).toBe(inode);
    expect(() => acquireFileLockSync(file, { waitMs: 0, helper: 'flock' })).toThrow(FileLockError);
    releaseFileLock(successor);
    expect(statSync(file).ino).toBe(inode);
  });

  it('a killed holder drops the kernel lock without deleting the path', async () => {
    const file = await lockPath('crash.op');
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        `import { acquireFileLockSync } from './packages/cli/src/file-lock.ts';
         acquireFileLockSync(process.env.REPLYSLIP_LOCK_FILE, { waitMs: 2000 });
         process.stdout.write('held\\n');
         setInterval(() => {}, 1e9);`,
      ],
      { cwd: process.cwd(), env: { ...process.env, REPLYSLIP_LOCK_FILE: file }, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('holder did not start')), 5_000);
      child.stdout.setEncoding('utf8');
      let text = '';
      child.stdout.on('data', (chunk: string) => {
        text += chunk;
        if (text.includes('held')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    process.kill(child.pid ?? 0, 'SIGKILL');
    const started = Date.now();
    const recovered = acquireFileLockSync(file, { waitMs: 2_000 });
    expect(Date.now() - started).toBeLessThan(2_000);
    releaseFileLock(recovered);
  });

  it('locks pid 1 and empty bytes in place', async () => {
    for (const body of ['', '1\n', '{']) {
      const file = await lockPath('bytes.op');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
      const held = acquireFileLockSync(file, { waitMs: 1_000 });
      expect(readFileSync(file, 'utf8')).toBe(body);
      releaseFileLock(held);
    }
  });

  it('keeps exclusion across 40 sync and 40 async acquire/release cycles', async () => {
    const file = await lockPath('stress.op');
    for (let i = 0; i < 40; i += 1) {
      const syncHold = acquireFileLockSync(file, { waitMs: 1_000 });
      expect(lockHeld(syncHold)).toBe(true);
      expect(() => acquireFileLockSync(file, { waitMs: 0 })).toThrow(FileLockError);
      releaseFileLock(syncHold);
      expect(lockHeld(syncHold)).toBe(false);
      const asyncHold = await acquireFileLock(file, { waitMs: 1_000 });
      expect(lockHeld(asyncHold)).toBe(true);
      expect(() => acquireFileLockSync(file, { waitMs: 0 })).toThrow(FileLockError);
      releaseFileLock(asyncHold);
    }
  });

  it('a helper killed during the hold is not still owned, and a contender can take the kernel lock', async () => {
    const file = await lockPath('killed.op');
    const holder = acquireFileLockSync(file, { waitMs: 1_000 });
    process.kill(holder.helperPid, 'SIGKILL');
    const deadline = Date.now() + 1_000;
    while (lockHeld(holder) && Date.now() < deadline) {
      const gate = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(gate, 0, 0, 10);
    }
    expect(lockHeld(holder)).toBe(false);
    const contender = acquireFileLockSync(file, { waitMs: 1_000 });
    expect(lockHeld(contender)).toBe(true);
    expect(() => releaseFileLock(holder)).toThrow(/no longer held/);
    releaseFileLock(contender);
  });

  it('releases the agent queue when helper cleanup fails', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-queue-'));
    const file = path.join(home, '.replyslip', 'supervise', 'QueueBot.op');
    const first = withAgentOp(home, 'QueueBot', async () => {
      const listed = execFileSync('ps', ['-ww', '-eo', 'pid,args'], { encoding: 'utf8' });
      const line = listed.split('\n').find((row) => row.includes(file));
      if (!line) throw new Error('helper not found');
      process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 150));
      return 'kept';
    });
    const second = withAgentOp(home, 'QueueBot', async () => 'next');
    await expect(first).rejects.toThrow(/no longer held/);
    await expect(second).resolves.toBe('next');
  });
});
