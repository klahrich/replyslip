// SPDX-License-Identifier: Apache-2.0

import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';
import { replyslipHome } from './register.ts';
import type { HoldReason, ProgressPhase } from './supervise-constants.ts';

export type WatcherProgress = {
  pid: number;
  token: string;
  startedAt: string;
  phase: ProgressPhase;
  at: string;
  deadlineAt: string;
};

export type AgentSuperviseState = {
  restarts: string[];
  lastCheckAt: string | null;
  wedgeDeferred: boolean;
  missingProgressStreak: number;
  lastSpawnAt: string | null;
  lastSpawnPid: number | null;
  /** Bumped when a deliberate stop or uninstall wins. In-flight starts abort when it changes. */
  epoch: number;
};

export function emptySuperviseState(): AgentSuperviseState {
  return {
    restarts: [],
    lastCheckAt: null,
    wedgeDeferred: false,
    missingProgressStreak: 0,
    lastSpawnAt: null,
    lastSpawnPid: null,
    epoch: 0,
  };
}

export function superviseDir(home?: string): string {
  return path.join(replyslipHome(home), 'supervise');
}

function agentFile(home: string | undefined, name: string, suffix: string): string {
  if (!AGENT_NAME_PATTERN.test(name)) throw new Error('Agent name is not valid.');
  return path.join(superviseDir(home), `${name}${suffix}`);
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows ignores the Unix mode.
  }
}

function writePrivate(file: string, body: string): void {
  ensureDir(path.dirname(file));
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeSync(fd, body.endsWith('\n') ? body : `${body}\n`);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(temp, 0o600);
  } catch {
    // Windows ignores the Unix mode.
  }
  renameSync(temp, file);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function writeProgress(home: string | undefined, name: string, progress: WatcherProgress): void {
  writePrivate(agentFile(home, name, '.progress.json'), JSON.stringify(progress));
}

export function readProgress(home: string | undefined, name: string): WatcherProgress | null {
  const parsed = readJson(agentFile(home, name, '.progress.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Partial<WatcherProgress>;
  if (typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid <= 0) return null;
  if (typeof row.token !== 'string' || !row.token) return null;
  if (typeof row.startedAt !== 'string' || !row.startedAt) return null;
  if (row.phase !== 'poll' && row.phase !== 'nudge' && row.phase !== 'ack' && row.phase !== 'sleep') return null;
  if (typeof row.at !== 'string' || typeof row.deadlineAt !== 'string') return null;
  return {
    pid: row.pid,
    token: row.token,
    startedAt: row.startedAt,
    phase: row.phase,
    at: row.at,
    deadlineAt: row.deadlineAt,
  };
}

export function clearProgress(home: string | undefined, name: string): void {
  removeFile(agentFile(home, name, '.progress.json'));
}

export function writeStopped(home: string | undefined, name: string, at = new Date()): void {
  writePrivate(agentFile(home, name, '.stopped'), JSON.stringify({ at: at.toISOString() }));
}

export function isStopped(home: string | undefined, name: string): boolean {
  try {
    readFileSync(agentFile(home, name, '.stopped'));
    return true;
  } catch {
    return false;
  }
}

export function clearStopped(home: string | undefined, name: string): void {
  removeFile(agentFile(home, name, '.stopped'));
}

export function writeHold(home: string | undefined, name: string, reason: HoldReason, at = new Date()): void {
  writePrivate(agentFile(home, name, '.hold.json'), JSON.stringify({ reason, at: at.toISOString() }));
}

export function readHold(home: string | undefined, name: string): HoldReason | null {
  const parsed = readJson(agentFile(home, name, '.hold.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const reason = (parsed as { reason?: unknown }).reason;
  if (reason === 'auth' || reason === 'legacy' || reason === 'config') return reason;
  return null;
}

export function clearHold(home: string | undefined, name: string): void {
  removeFile(agentFile(home, name, '.hold.json'));
}

export function readSuperviseState(home: string | undefined, name: string): AgentSuperviseState {
  const parsed = readJson(agentFile(home, name, '.state.json'));
  if (!parsed || typeof parsed !== 'object') return emptySuperviseState();
  const row = parsed as Partial<AgentSuperviseState>;
  return {
    restarts: Array.isArray(row.restarts) ? row.restarts.filter((item): item is string => typeof item === 'string') : [],
    lastCheckAt: typeof row.lastCheckAt === 'string' ? row.lastCheckAt : null,
    wedgeDeferred: row.wedgeDeferred === true,
    missingProgressStreak: typeof row.missingProgressStreak === 'number' && row.missingProgressStreak > 0 ? Math.floor(row.missingProgressStreak) : 0,
    lastSpawnAt: typeof row.lastSpawnAt === 'string' ? row.lastSpawnAt : null,
    lastSpawnPid: typeof row.lastSpawnPid === 'number' && Number.isInteger(row.lastSpawnPid) && row.lastSpawnPid > 0 ? row.lastSpawnPid : null,
    epoch: typeof row.epoch === 'number' && Number.isInteger(row.epoch) && row.epoch > 0 ? row.epoch : 0,
  };
}

export function writeSuperviseState(home: string | undefined, name: string, state: AgentSuperviseState): void {
  writePrivate(agentFile(home, name, '.state.json'), JSON.stringify(state));
}

export function readEnrolled(home: string | undefined): string[] {
  const parsed = readJson(path.join(superviseDir(home), 'agents.json'));
  if (!parsed || typeof parsed !== 'object') return [];
  const agents = (parsed as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return [];
  return [...new Set(agents.filter((name): name is string => typeof name === 'string' && AGENT_NAME_PATTERN.test(name)))].sort();
}

export function writeEnrolled(home: string | undefined, agents: string[]): void {
  const unique = [...new Set(agents.filter((name) => AGENT_NAME_PATTERN.test(name)))].sort();
  writePrivate(path.join(superviseDir(home), 'agents.json'), JSON.stringify({ agents: unique }));
}

export function enrollAgent(home: string | undefined, name: string): void {
  if (!AGENT_NAME_PATTERN.test(name)) throw new Error('Agent name is not valid.');
  const agents = new Set(readEnrolled(home));
  agents.add(name);
  writeEnrolled(home, [...agents]);
}

export function unenrollAgent(home: string | undefined, name: string): void {
  writeEnrolled(home, readEnrolled(home).filter((agent) => agent !== name));
}

function removeFile(file: string): void {
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function progressPaths(home: string | undefined, name: string): { progress: string; stopped: string; hold: string; state: string } {
  return {
    progress: agentFile(home, name, '.progress.json'),
    stopped: agentFile(home, name, '.stopped'),
    hold: agentFile(home, name, '.hold.json'),
    state: agentFile(home, name, '.state.json'),
  };
}
