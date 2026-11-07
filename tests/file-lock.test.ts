import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireFileLockSync, FileLockError, lockHelperFor, releaseFileLock } from '../packages/cli/src/file-lock';

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
  });

  it('premise is false: path-based read/check then destructive operation can safely reclaim/release shared ownership', async () => {
    const file = await lockPath('premise.op');
    mkdirSync(path.dirname(file), { recursive: true });
    const holder = acquireFileLockSync(file, { waitMs: 1_000 });
    const before = statSync(file).ino;
    readFileSync(file);
    unlinkSync(file);
    const successor = acquireFileLockSync(file, { waitMs: 1_000 });
    expect(holder.child.exitCode).toBeNull();
    expect(successor.child.exitCode).toBeNull();
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
});
