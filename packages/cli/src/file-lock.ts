// SPDX-License-Identifier: Apache-2.0

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync } from 'node:fs';
import path from 'node:path';

/**
 * Premise that does not hold: "path-based read/check then destructive operation can
 * safely reclaim/release shared ownership." Unlink or rename of the current path can
 * remove a successor, or leave the previous holder on the old inode while a new file
 * is locked at the same path. Ownership here is the kernel lock on one open file
 * (Unix flock(2), Windows LockFileEx). Release unlocks that descriptor. It does not
 * delete the path. A dead process drops the lock when the kernel closes its handles.
 */

/** A waiter gives up instead of sitting behind a live kernel lock. */
export const FILE_LOCK_WAIT_MS = 2_000;

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

export type LockHelper = 'perl' | 'flock' | 'powershell';

export type HeldFileLock = { file: string; child: ChildProcess; released: boolean };

export type FileLockOptions = {
  waitMs?: number;
  /** Test override. Production picks perl, then flock(1), then PowerShell. */
  helper?: LockHelper;
};

const tools = { perl: false, flock: false, powershell: false, known: false };

export function lockHelperFor(
  platform: NodeJS.Platform,
  available: { perl: boolean; flock: boolean; powershell: boolean },
): LockHelper | null {
  if (platform === 'win32') return available.powershell ? 'powershell' : null;
  if (available.perl) return 'perl';
  if (available.flock) return 'flock';
  return null;
}

export function acquireFileLockSync(file: string, options: FileLockOptions = {}): HeldFileLock {
  const waitMs = options.waitMs ?? FILE_LOCK_WAIT_MS;
  const helper = options.helper ?? detectHelper();
  if (!helper) {
    throw new FileLockError(
      `Could not acquire ${file}. No OS lock helper is available (perl, flock, or PowerShell). Nothing was deleted.`,
    );
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const created = openSync(file, 'a', 0o600);
  closeSync(created);
  const child = spawnHelper(helper, file, waitMs);
  child.stdout?.pause();
  child.on('error', () => undefined);
  const deadline = Date.now() + waitMs + 1_000;
  let line = '';
  try {
    line = readLine(pipeFd(child.stdout), deadline);
  } catch (err) {
    stopHelper(child);
    throw err;
  }
  if (line !== 'ok') {
    stopHelper(child);
    const why = line === 'busy' || line === '' ? `within ${waitMs}ms` : `(${line})`;
    throw new FileLockError(
      `Could not acquire ${file} ${why}. The operating system lock is held, or the helper could not lock it. The file was not removed. Retry after the holder exits.`,
    );
  }
  return { file, child, released: false };
}

export async function acquireFileLock(file: string, options: FileLockOptions = {}): Promise<HeldFileLock> {
  return acquireFileLockSync(file, options);
}

export function releaseFileLock(held: HeldFileLock): void {
  if (held.released) return;
  held.released = true;
  closePipe(held.child.stdin);
  const line = readLine(pipeFd(held.child.stdout), Date.now() + 2_000);
  if (line !== 'bye') stopHelper(held.child);
}

function detectHelper(): LockHelper | null {
  if (!tools.known) {
    tools.perl = toolExists('perl');
    tools.flock = toolExists('flock');
    tools.powershell = toolExists('powershell.exe');
    tools.known = true;
  }
  return lockHelperFor(process.platform, tools);
}

function toolExists(name: string): boolean {
  const result = spawnSync('which', [name], { stdio: 'ignore' });
  return result.status === 0;
}

function spawnHelper(helper: LockHelper, file: string, waitMs: number): ChildProcess {
  if (helper === 'perl') {
    return spawn('perl', ['-e', PERL_LOCK, file, String(waitMs)], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  }
  if (helper === 'flock') {
    const seconds = waitMs <= 0 ? '0' : String(Math.max(1, Math.ceil(waitMs / 1000)));
    return spawn('flock', ['-w', seconds, '-x', file, 'sh', '-c', 'printf "ok\\n"; IFS= read -r _; printf "bye\\n"'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
  }
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_LOCK], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, REPLYSLIP_LOCK_PATH: file, REPLYSLIP_LOCK_WAIT_MS: String(waitMs) },
  });
}

function closePipe(stream: NodeJS.WritableStream | null): void {
  const fd = (stream as { _handle?: { fd?: number } } | null)?._handle?.fd;
  if (typeof fd === 'number' && fd >= 0) {
    try {
      closeSync(fd);
    } catch {
      // Already closed.
    }
  }
}

function pipeFd(stream: NodeJS.ReadableStream | null): number {
  const fd = (stream as { _handle?: { fd?: number } } | null)?._handle?.fd;
  if (typeof fd !== 'number' || fd < 0) throw new FileLockError('The lock helper pipe is not readable.');
  return fd;
}

function readLine(fd: number, deadline: number): string {
  let text = '';
  const buf = Buffer.alloc(64);
  const gate = new Int32Array(new SharedArrayBuffer(4));
  while (!text.includes('\n') && text.length < 512) {
    if (Date.now() >= deadline) break;
    try {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      text += buf.toString('utf8', 0, n);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EAGAIN') throw err;
      Atomics.wait(gate, 0, 0, 5);
    }
  }
  const end = text.indexOf('\n');
  return (end === -1 ? text : text.slice(0, end)).trim();
}

function stopHelper(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch {
    // Already gone.
  }
}

const PERL_LOCK = `
use Fcntl qw(:flock O_RDWR O_CREAT);
use Time::HiRes qw(time sleep);
$| = 1;
my ($path, $wait_ms) = @ARGV;
sysopen(my $fh, $path, O_RDWR | O_CREAT, 0600) or do { print "error open\\n"; exit 1 };
my $deadline = time() + ($wait_ms / 1000);
while (1) {
  if (flock($fh, LOCK_EX | LOCK_NB)) {
    print "ok\\n";
    while (defined(my $line = <STDIN>)) {}
    flock($fh, LOCK_UN);
    close $fh;
    print "bye\\n";
    exit 0;
  }
  last if time() >= $deadline;
  sleep(0.01);
}
print "busy\\n";
exit 2;
`;

const POWERSHELL_LOCK = `
$ErrorActionPreference = 'Stop'
$path = $env:REPLYSLIP_LOCK_PATH
$wait = [int]$env:REPLYSLIP_LOCK_WAIT_MS
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ReplySlipLock {
  [StructLayout(LayoutKind.Sequential)]
  public struct OVERLAPPED {
    public IntPtr Internal;
    public IntPtr InternalHigh;
    public uint OffsetLow;
    public uint OffsetHigh;
    public IntPtr Event;
  }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool LockFileEx(IntPtr h, uint flags, uint reserved, uint low, uint high, ref OVERLAPPED ov);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool UnlockFileEx(IntPtr h, uint reserved, uint low, uint high, ref OVERLAPPED ov);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
}
"@
$handle = [ReplySlipLock]::CreateFileW($path, [uint32]3221225472, [uint32]7, [IntPtr]::Zero, [uint32]4, [uint32]0, [IntPtr]::Zero)
if ($handle.ToInt64() -eq -1) { Write-Output 'error open'; exit 1 }
$ov = New-Object ReplySlipLock+OVERLAPPED
$deadline = [DateTime]::UtcNow.AddMilliseconds($wait)
$locked = $false
while ($true) {
  if ([ReplySlipLock]::LockFileEx($handle, [uint32]3, [uint32]0, [uint32]1, [uint32]0, [ref]$ov)) { $locked = $true; break }
  if ([DateTime]::UtcNow -ge $deadline) { break }
  Start-Sleep -Milliseconds 10
}
if (-not $locked) { [ReplySlipLock]::CloseHandle($handle) | Out-Null; Write-Output 'busy'; exit 2 }
Write-Output 'ok'
[Console]::Out.Flush()
[Console]::In.ReadLine() | Out-Null
[ReplySlipLock]::UnlockFileEx($handle, [uint32]0, [uint32]1, [uint32]0, [ref]$ov) | Out-Null
[ReplySlipLock]::CloseHandle($handle) | Out-Null
Write-Output 'bye'
`;
