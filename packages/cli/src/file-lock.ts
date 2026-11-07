// SPDX-License-Identifier: Apache-2.0

import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/**
 * Premise that does not hold: "path-based read/check then destructive operation can
 * safely reclaim/release shared ownership." Ownership is the kernel lock held by a
 * helper process (Unix flock(2), Windows LockFileEx). The helper's streams stay on
 * the public child-process lifecycle in a worker thread. This process never closes
 * those file descriptors itself. If the helper exits, the kernel lock is gone and
 * the hold is lost: later work must not proceed as if exclusion remained.
 */

/** A waiter gives up instead of sitting behind a live kernel lock. */
export const FILE_LOCK_WAIT_MS = 2_000;

const PENDING = 0;
const HELD = 1;
const BUSY = 2;
const LOST = 3;
const RELEASED = 4;
const FAILED = 5;
const CMD_RELEASE = 1;
const CMD_ABORT = 2;

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

export type LockHelper = 'perl' | 'flock' | 'powershell';

export type HeldFileLock = {
  file: string;
  helperPid: number;
  view: Int32Array;
  worker: Worker;
  released: boolean;
  stopWatch: () => void;
};

export type FileLockOptions = {
  waitMs?: number;
  /** Test override. Production picks perl, then flock(1), then PowerShell. */
  helper?: LockHelper;
};

export function lockHelperFor(
  platform: NodeJS.Platform,
  available: { perl: boolean; flock: boolean; powershell: boolean },
): LockHelper | null {
  if (platform === 'win32') return available.powershell ? 'powershell' : null;
  if (available.perl) return 'perl';
  if (available.flock) return 'flock';
  return null;
}

/** Walk PATH with the platform delimiter. Does not shell out to which or where. */
export function lookupExecutable(
  names: string[],
  pathEnv: string | undefined,
  exists: (candidate: string) => boolean,
  platform: NodeJS.Platform,
): string | null {
  const delimiter = platform === 'win32' ? ';' : ':';
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const entry of (pathEnv ?? '').split(delimiter)) {
    const dir = entry.trim().replaceAll(/^"|"$/g, '');
    if (!dir) continue;
    for (const name of names) {
      const fileNames = platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? [`${name}.exe`, name] : [name];
      for (const fileName of fileNames) {
        const candidate = join(dir, fileName);
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function lockHeld(held: HeldFileLock): boolean {
  return !held.released && Atomics.load(held.view, 0) === HELD;
}

/** Rejects if the helper exits before release. Attach this only while the operation is in flight. */
export function lockLoss(held: HeldFileLock): Promise<never> {
  const fail = () => lossError(held.file);
  if (Atomics.load(held.view, 0) === LOST) return Promise.reject(fail());
  return new Promise((_, reject) => {
    const timer = setInterval(() => {
      if (Atomics.load(held.view, 0) === LOST) {
        clearInterval(timer);
        reject(fail());
      }
    }, 10);
    const previous = held.stopWatch;
    held.stopWatch = () => {
      clearInterval(timer);
      previous();
    };
  });
}

export function acquireFileLockSync(file: string, options: FileLockOptions = {}): HeldFileLock {
  const waitMs = options.waitMs ?? FILE_LOCK_WAIT_MS;
  const resolved = resolveHelper(options.helper);
  if (!resolved) {
    throw new FileLockError(
      `Could not acquire ${file}. No OS lock helper is available (perl, flock, or PowerShell). Nothing was deleted.`,
    );
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const created = openSync(file, 'a', 0o600);
  closeSync(created);
  const sab = new SharedArrayBuffer(16);
  const view = new Int32Array(sab);
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { sab, helper: resolved.helper, bin: resolved.bin, file, waitMs, perlScript: PERL_LOCK, psScript: POWERSHELL_LOCK },
  });
  worker.on('error', () => {
    if (Atomics.load(view, 0) === PENDING) {
      Atomics.store(view, 0, FAILED);
      Atomics.notify(view, 0);
    }
  });
  const deadline = Date.now() + waitMs + 1_500;
  while (Atomics.load(view, 0) === PENDING) {
    if (Date.now() >= deadline) break;
    Atomics.wait(view, 0, PENDING, 20);
  }
  const state = Atomics.load(view, 0);
  if (state !== HELD) {
    abandon(worker, view);
    const why = state === BUSY || state === PENDING || state === FAILED ? `within ${waitMs}ms` : 'because the helper failed';
    throw new FileLockError(
      `Could not acquire ${file} ${why}. The operating system lock is held, or the helper could not lock it. The file was not removed. Retry after the holder exits.`,
    );
  }
  return { file, helperPid: Atomics.load(view, 2), view, worker, released: false, stopWatch: () => undefined };
}

export async function acquireFileLock(file: string, options: FileLockOptions = {}): Promise<HeldFileLock> {
  return acquireFileLockSync(file, options);
}

export function releaseFileLock(held: HeldFileLock): void {
  if (held.released) return;
  held.released = true;
  held.stopWatch();
  const current = Atomics.load(held.view, 0);
  if (current === LOST) {
    void held.worker.terminate();
    throw lossError(held.file);
  }
  Atomics.store(held.view, 1, CMD_RELEASE);
  const deadline = Date.now() + 2_000;
  while (true) {
    const state = Atomics.load(held.view, 0);
    if (state === RELEASED) {
      void held.worker.terminate();
      return;
    }
    if (state === LOST) {
      void held.worker.terminate();
      throw lossError(held.file);
    }
    if (Date.now() >= deadline) {
      if (held.helperPid > 0) {
        try {
          process.kill(held.helperPid, 'SIGTERM');
        } catch {
          // The helper is already gone.
        }
      }
      void held.worker.terminate();
      throw new FileLockError(`Could not release ${held.file}. The helper did not confirm unlock. The kernel lock is no longer held.`);
    }
    Atomics.wait(held.view, 0, state, 20);
  }
}

function lossError(file: string): FileLockError {
  return new FileLockError(`The lock helper for ${file} exited while the lock was held. The kernel lock is no longer held.`);
}

function abandon(worker: Worker, view: Int32Array): void {
  Atomics.store(view, 1, CMD_ABORT);
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const state = Atomics.load(view, 0);
    if (state !== PENDING) break;
    Atomics.wait(view, 0, PENDING, 20);
  }
  const pid = Atomics.load(view, 2);
  if (pid > 0) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  void worker.terminate();
}

function resolveHelper(requested?: LockHelper): { helper: LockHelper; bin: string } | null {
  const pathEnv = process.env.PATH ?? process.env.Path;
  if (requested === 'powershell' || (!requested && process.platform === 'win32')) {
    const bin = lookupExecutable(['powershell.exe', 'pwsh.exe'], pathEnv, existsSync, 'win32');
    return bin ? { helper: 'powershell', bin } : null;
  }
  if (requested === 'flock') {
    const bin = lookupExecutable(['flock'], pathEnv, existsSync, process.platform);
    return bin ? { helper: 'flock', bin } : null;
  }
  if (requested === 'perl' || !requested) {
    const perl = lookupExecutable(['perl'], pathEnv, existsSync, process.platform);
    if (perl) return { helper: 'perl', bin: perl };
    if (requested === 'perl') return null;
  }
  const flock = lookupExecutable(['flock'], pathEnv, existsSync, process.platform);
  return flock ? { helper: 'flock', bin: flock } : null;
}

const PERL_LOCK = String.raw`
use Fcntl qw(:flock O_RDWR O_CREAT);
use Time::HiRes qw(time sleep);
$| = 1;
my ($path, $wait_ms) = @ARGV;
sysopen(my $fh, $path, O_RDWR | O_CREAT, 0600) or do { print "error open\n"; exit 1 };
my $deadline = time() + ($wait_ms / 1000);
while (1) {
  if (flock($fh, LOCK_EX | LOCK_NB)) {
    print "ok\n";
    while (defined(my $line = <STDIN>)) {}
    flock($fh, LOCK_UN);
    close $fh;
    print "bye\n";
    exit 0;
  }
  last if time() >= $deadline;
  sleep(0.01);
}
print "busy\n";
exit 2;
`;

const POWERSHELL_LOCK = String.raw`
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

const WORKER_SOURCE = `
import { workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
const { sab, helper, bin, file, waitMs, perlScript, psScript } = workerData;
const view = new Int32Array(sab);
const HELD = 1, BUSY = 2, LOST = 3, RELEASED = 4, FAILED = 5;
const CMD_RELEASE = 1, CMD_ABORT = 2;
let settled = false;
let timer;
function setState(value) {
  Atomics.store(view, 0, value);
  Atomics.notify(view, 0);
}
function settle(value) {
  if (settled) return;
  settled = true;
  clearInterval(timer);
  setState(value);
}
timer = setInterval(() => {
  const cmd = Atomics.load(view, 1);
  if (!child) return;
  if (cmd === CMD_RELEASE && !releaseRequested) {
    releaseRequested = true;
    try {
      child.stdin.end();
    } catch {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  } else if (cmd === CMD_ABORT) {
    clearInterval(timer);
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}, 10);
let child;
if (helper === 'perl') {
  child = spawn(bin, ['-e', perlScript, file, String(waitMs)], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
} else if (helper === 'flock') {
  const seconds = waitMs <= 0 ? '0' : String(Math.max(1, Math.ceil(waitMs / 1000)));
  child = spawn(bin, ['-w', seconds, '-x', file, 'sh', '-c', 'printf "ok\\n"; IFS= read -r _; printf "bye\\n"'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
} else {
  child = spawn(bin, ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, REPLYSLIP_LOCK_PATH: file, REPLYSLIP_LOCK_WAIT_MS: String(waitMs) },
  });
}
Atomics.store(view, 2, child.pid ?? 0);
let releaseRequested = false;
let buf = '';
child.stdout?.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl = buf.indexOf('\\n');
  while (nl !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === 'ok' && Atomics.load(view, 0) === 0) setState(HELD);
    else if (line === 'busy') settle(BUSY);
    else if (line.startsWith('error')) settle(FAILED);
    else if (line === 'bye') settle(releaseRequested ? RELEASED : LOST);
    nl = buf.indexOf('\\n');
  }
});
child.on('error', () => settle(Atomics.load(view, 0) === HELD ? LOST : FAILED));
child.on('exit', () => {
  const current = Atomics.load(view, 0);
  if (current === RELEASED || current === LOST || current === BUSY || current === FAILED) return;
  if (current === HELD) settle(releaseRequested ? RELEASED : LOST);
  else settle(BUSY);
});
`;
