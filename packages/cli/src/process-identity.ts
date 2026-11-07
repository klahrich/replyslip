// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCb } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { PID_START_SKEW_MS } from './supervise-constants.ts';

const execFile = promisify(execFileCb);

export type ProcessIdentity = {
  cmdline: string;
  /** OS process start time. Null when it could not be read. A kill requires this. */
  startedAtMs: number | null;
};

export type LockIdentity = { pid: number; token: string; startedAt: string };

/**
 * True only for a detached per-agent watcher command, not for `supervise --once`.
 * `replyslip` must appear, and `watch` must be its own argument.
 */
export function isReplyslipWatchCommand(cmdline: string): boolean {
  const flat = cmdline.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/replyslip/i.test(flat)) return false;
  const parts = splitCommand(flat);
  return parts.some((part) => part === 'watch');
}

function splitCommand(flat: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|\S+/g;
  for (const match of flat.matchAll(pattern)) {
    parts.push(match[1] ?? match[2] ?? match[0]);
  }
  return parts;
}

export function killLockAllowed(input: {
  lock: LockIdentity | null;
  expected: LockIdentity;
  identity: ProcessIdentity | null;
  skewMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.lock) return { ok: false, reason: 'lock-gone' };
  if (
    input.lock.pid !== input.expected.pid ||
    input.lock.token !== input.expected.token ||
    input.lock.startedAt !== input.expected.startedAt
  ) {
    return { ok: false, reason: 'lock-changed' };
  }
  return identityAllows(input.identity, input.lock.startedAt, input.skewMs ?? PID_START_SKEW_MS);
}

/**
 * A spawn that never took the lock. The pid is ours only when the command line is a watcher
 * and the OS start time sits near the recorded spawn time. A reused pid fails that comparison.
 */
export function killSpawnAllowed(input: {
  identity: ProcessIdentity | null;
  spawnedAt: string;
  skewMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  return identityAllows(input.identity, input.spawnedAt, input.skewMs ?? PID_START_SKEW_MS);
}

function identityAllows(identity: ProcessIdentity | null, notAfterIso: string, skewMs: number): { ok: true } | { ok: false; reason: string } {
  if (!identity) return { ok: false, reason: 'unverified-process' };
  if (!isReplyslipWatchCommand(identity.cmdline)) return { ok: false, reason: 'not-watcher' };
  if (identity.startedAtMs == null) return { ok: false, reason: 'unverified-process' };
  const bound = Date.parse(notAfterIso);
  if (Number.isNaN(bound)) return { ok: false, reason: 'unverified-process' };
  if (identity.startedAtMs > bound + skewMs) return { ok: false, reason: 'pid-reused' };
  return { ok: true };
}

/** Linux `stat` line after the comm field. Field 22 (starttime) is index 19 of that remainder. */
export function linuxStartMs(statLine: string, btimeSec: number, clkTck = 100): number | null {
  const close = statLine.lastIndexOf(')');
  if (close < 0 || !Number.isFinite(btimeSec)) return null;
  const rest = statLine.slice(close + 2).trim().split(/\s+/);
  const ticks = Number(rest[19]);
  if (!Number.isFinite(ticks) || clkTck <= 0) return null;
  return Math.round(btimeSec * 1000 + (ticks / clkTck) * 1000);
}

export function parsePsIdentity(stdout: string): ProcessIdentity | null {
  const line = stdout.trim();
  if (!line) return null;
  const match = line.match(/^(\d+)\s+([\s\S]+)$/);
  if (!match) return null;
  const elapsed = Number(match[1]);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return { cmdline: match[2].trim(), startedAtMs: Date.now() - elapsed * 1000 };
}

export function parseWindowsIdentity(jsonText: string, now = Date.now()): ProcessIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!row || typeof row !== 'object') return null;
  const cmdline = (row as { CommandLine?: unknown }).CommandLine;
  const created = (row as { CreationDate?: unknown }).CreationDate;
  if (typeof cmdline !== 'string' || !cmdline.trim()) return null;
  const startedAtMs = windowsCreationMs(created, now);
  if (created != null && created !== '' && startedAtMs == null) return null;
  return { cmdline: cmdline.trim(), startedAtMs };
}

/**
 * CIM CreationDate is `yyyymmddHHMMSS.mmmmmm±UUU`. `UUU` is the offset in minutes.
 * `20261107100000.000000-480` is 10:00 at UTC−8, which is 18:00Z.
 * A stamp that looks like CIM but has no 3-digit offset, or an impossible date, is rejected.
 */
export function windowsCreationMs(value: unknown, now = Date.now()): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const dotted = text.match(/^\/Date\((-?\d+)\)\/$/);
  if (dotted) return Number(dotted[1]);
  if (/^\d{14}\./.test(text)) return cimCreationMs(text);
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed) || parsed > now + 24 * 60 * 60 * 1000) return null;
  return parsed;
}

function cimCreationMs(text: string): number | null {
  const wmi = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{1,6})([+-])(\d{3})$/);
  if (!wmi) return null;
  const year = Number(wmi[1]);
  const month = Number(wmi[2]);
  const day = Number(wmi[3]);
  const hour = Number(wmi[4]);
  const minute = Number(wmi[5]);
  const second = Number(wmi[6]);
  const millis = Number(wmi[7].slice(0, 3).padEnd(3, '0'));
  const offsetMin = Number(`${wmi[8]}${wmi[9]}`);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  if (!Number.isInteger(offsetMin) || Math.abs(offsetMin) > 14 * 60) return null;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (Number.isNaN(localAsUtc)) return null;
  const check = new Date(localAsUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  return localAsUtc - offsetMin * 60_000;
}

export async function identifyProcess(pid: number, platform: NodeJS.Platform = process.platform): Promise<ProcessIdentity | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (platform === 'linux') return identifyLinux(pid);
    if (platform === 'darwin') return identifyDarwin(pid);
    if (platform === 'win32') return identifyWindows(pid);
    return null;
  } catch {
    return null;
  }
}

function identifyLinux(pid: number): ProcessIdentity | null {
  const cmdline = readFileSync(`/proc/${pid}/cmdline`);
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const procStat = readFileSync('/proc/stat', 'utf8');
  const btime = Number(procStat.match(/^btime\s+(\d+)/m)?.[1]);
  const text = cmdline.toString('utf8');
  if (!text) return null;
  return { cmdline: text, startedAtMs: linuxStartMs(stat, btime) };
}

async function identifyDarwin(pid: number): Promise<ProcessIdentity | null> {
  const { stdout } = await execFile('ps', ['-p', String(pid), '-ww', '-o', 'etimes=,command='], { timeout: 5_000, windowsHide: true });
  return parsePsIdentity(String(stdout));
}

async function identifyWindows(pid: number): Promise<ProcessIdentity | null> {
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress`;
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 8_000,
    windowsHide: true,
  });
  return parseWindowsIdentity(String(stdout));
}
