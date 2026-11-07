// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, appendFileSync, chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';
import { agentKeyPath } from './register.ts';
import { redactSecrets } from './redact.ts';
import { identifyProcess, killLockAllowed, killSpawnAllowed, type ProcessIdentity } from './process-identity.ts';
import { decideSupervision, type SuperviseDecision } from './supervise-decide.ts';
import { buildInstallPlan, type InstallPlan, type InstallPlanInput, type PlannedCommand } from './supervise-os.ts';
import { listLiveWatcherLocks, pidIsAlive, type WatcherLockInfo } from './watcher-lock.ts';
import {
  clearHold,
  clearProgress,
  clearStopped,
  emptySuperviseState,
  enrollAgent,
  isStopped,
  readEnrolled,
  readHold,
  readProgress,
  readSuperviseState,
  superviseDir,
  unenrollAgent,
  writeEnrolled,
  writeHold,
  writeStopped,
  writeSuperviseState,
  type AgentSuperviseState,
} from './watcher-progress.ts';

export type CommandOutput = { code: number; stdout: string; stderr: string };
export type CommandRun = (command: string, args: string[]) => Promise<CommandOutput>;

export type SpawnRequest = {
  nodePath: string;
  scriptPath: string;
  name: string;
  home: string;
  pathEnv: string;
  orcaBin?: string;
  /**
   * Take over a lock whose pid is alive but is not this watcher (the pid was reused).
   * Never set for a process we could not identify.
   */
  force?: boolean;
};

export type SuperviseIo = {
  home?: string;
  platform?: NodeJS.Platform;
  uid?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  run?: CommandRun;
  spawnWatcher?: (request: SpawnRequest) => { pid: number };
  identify?: (pid: number) => Promise<ProcessIdentity | null>;
  alive?: (pid: number) => boolean;
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  sleep?: (ms: number) => Promise<void>;
  scriptPath?: string;
  nodePath?: string;
  log?: (line: string) => void;
  label?: string;
  taskName?: string;
  unitName?: string;
};

export type SuperviseResult = { ok: true; lines: string[] } | { ok: false; message: string };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function verifyDistributedScript(scriptPath: string): { ok: true } | { ok: false; message: string } {
  if (path.basename(scriptPath) !== 'replyslip.mjs') return { ok: true };
  const checksumPath = `${scriptPath}.sha256`;
  let text: string;
  try {
    text = readFileSync(checksumPath, 'utf8');
  } catch {
    return {
      ok: false,
      message: `Refusing to install: ${checksumPath} is missing. Download replyslip.mjs and replyslip.mjs.sha256 from the same host, check the file, then run supervise --install again.`,
    };
  }
  const expected = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    return { ok: false, message: `Refusing to install: ${checksumPath} is not a sha256 checksum line.` };
  }
  const actual = createHash('sha256').update(readFileSync(scriptPath)).digest('hex');
  if (actual !== expected) {
    return { ok: false, message: `Refusing to install: ${scriptPath} does not match ${checksumPath}. Download both files again.` };
  }
  return { ok: true };
}

export function supervisedEnv(request: SpawnRequest, base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: request.pathEnv,
    HOME: request.home,
    USERPROFILE: request.home,
    REPLYSLIP_SUPERVISED: '1',
  };
  if (request.orcaBin) env.REPLYSLIP_ORCA_BIN = request.orcaBin;
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LANG', 'TMPDIR'] as const) {
    const value = base[key];
    if (value) env[key] = value;
  }
  return env;
}

export function spawnDetachedWatcher(request: SpawnRequest): { pid: number } {
  const dir = superviseDir(request.home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logPath = path.join(dir, `${request.name}.log`);
  const fd = openSync(logPath, 'a', 0o600);
  try {
    chmodSync(logPath, 0o600);
  } catch {
    // Windows ignores the Unix mode.
  }
  const args = [request.scriptPath, 'watch', '--name', request.name];
  if (request.force) args.push('--force');
  const child = spawn(request.nodePath, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: supervisedEnv(request, process.env),
  });
  child.unref();
  closeSync(fd);
  if (!child.pid) throw new Error('Could not start the watcher.');
  return { pid: child.pid };
}

export async function installSupervision(name: string, io: SuperviseIo = {}): Promise<SuperviseResult> {
  const checked = checkName(name);
  if (checked) return { ok: false, message: checked };
  const home = io.home;
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  const nodePath = io.nodePath ?? process.execPath;
  const verified = verifyDistributedScript(scriptPath);
  if (!verified.ok) return verified;
  if (!agentKeyFileExists(name, home)) {
    return {
      ok: false,
      message: `No key file at ${agentKeyPath(name, home)}. Register this agent first. The key was not read.`,
    };
  }
  const plan = buildInstallPlan(planInput(io, scriptPath, nodePath));
  if ('error' in plan) return { ok: false, message: plan.error };
  const run = io.run ?? defaultRun;
  const preflight = await runPlan(plan.preflight, run);
  if (!preflight.ok) return { ok: false, message: preflightMessage(plan.platform, preflight.message) };
  try {
    writePlanFiles(plan);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not write the supervision files.' };
  }
  const applied = await runPlan(plan.commands, run);
  if (!applied.ok) {
    return {
      ok: false,
      message: `${preflightMessage(plan.platform, applied.message)} Unit files were written, but the timer is not confirmed. The watcher was not started.`,
    };
  }
  clearStopped(home, name);
  clearHold(home, name);
  clearProgress(home, name);
  writeSuperviseState(home, name, emptySuperviseState());
  enrollAgent(home, name);
  const lines = [...plan.notes, `Enrolled ${name}. The timer runs this same script: ${scriptPath}`];
  const started = await ensureWatcher(name, io, scriptPath, nodePath, true);
  if (!started.ok) return started;
  lines.push(...started.lines);
  return { ok: true, lines };
}

export async function stopSupervision(name: string, io: SuperviseIo = {}): Promise<SuperviseResult> {
  const checked = checkName(name);
  if (checked) return { ok: false, message: checked };
  writeStopped(io.home, name);
  const signal = await signalAgent(name, io);
  if (!signal.ok && signal.reason !== 'not-running') {
    return {
      ok: false,
      message: `Stop is recorded for ${name}, so it will not be restarted. The process was not signalled (${signal.reason}).`,
    };
  }
  const detail = signal.ok ? 'The watcher was signalled.' : 'No watcher process was running.';
  return { ok: true, lines: [`Deliberate stop recorded for ${name}. ${detail}`, 'Login, logout, and sleep do not set this stop. supervise --install clears it.'] };
}

export async function uninstallSupervision(options: { name?: string; all?: boolean }, io: SuperviseIo = {}): Promise<SuperviseResult> {
  const names = options.all ? readEnrolled(io.home) : options.name ? [options.name] : [];
  if (!options.all && !options.name) return { ok: false, message: 'Usage: replyslip supervise --uninstall --name <name> | --uninstall --all' };
  if (options.name) {
    const checked = checkName(options.name);
    if (checked) return { ok: false, message: checked };
  }
  const lines: string[] = [];
  for (const name of names) {
    const stopped = await stopSupervision(name, io);
    if (!stopped.ok) lines.push(stopped.message);
    else lines.push(...stopped.lines);
    unenrollAgent(io.home, name);
  }
  if (options.all) writeEnrolled(io.home, []);
  const remaining = readEnrolled(io.home);
  if (remaining.length > 0) {
    lines.push(`Timer left in place for ${remaining.join(', ')}.`);
    return { ok: true, lines };
  }
  const removed = await removeTimer(io);
  if (!removed.ok) return { ok: false, message: `${removed.message} Deliberate stops stay recorded, so a leftover timer will not start a watcher.` };
  lines.push(...removed.lines);
  return { ok: true, lines };
}

export async function runSupervisionTick(io: SuperviseIo = {}): Promise<SuperviseResult> {
  const lines: string[] = [];
  const names = readEnrolled(io.home);
  if (names.length === 0) return { ok: true, lines: ['No enrolled agents.'] };
  for (const name of names) {
    const outcome = await tickAgent(name, io);
    lines.push(`${name}: ${outcome}`);
  }
  return { ok: true, lines };
}

export function supervisionStatus(io: SuperviseIo = {}): string[] {
  const names = readEnrolled(io.home);
  if (names.length === 0) return ['No enrolled agents. Run supervise --install --name <name> after the checksummed script is in place.'];
  const lines = names.map((name) => statusLine(name, io.home));
  lines.push(`Tick interval is 120 seconds. Supported timers: macOS LaunchAgent, Linux systemd --user, Windows Task Scheduler.`);
  return lines;
}

async function tickAgent(name: string, io: SuperviseIo): Promise<string> {
  const now = (io.now ?? Date.now)();
  const alive = io.alive ?? pidIsAlive;
  const state = readSuperviseState(io.home, name);
  const lock = liveLock(io.home, name);
  const decision = decideSupervision({
    now,
    stopped: isStopped(io.home, name),
    hold: readHold(io.home, name),
    lockLive: !!lock,
    lock: lock ? { pid: lock.pid, token: lock.token ?? '', startedAt: lock.startedAt } : null,
    progress: readProgress(io.home, name),
    spawnAlive: !!state.lastSpawnPid && alive(state.lastSpawnPid),
    state,
  });
  writeSuperviseState(io.home, name, decision.state);
  if (decision.decision.action === 'skip') return decision.decision.reason === 'hold' ? `held (${decision.decision.hold})` : decision.decision.reason;
  if (decision.decision.action === 'start') {
    const started = await startWatcher(name, io, decision.state, false);
    return started.ok ? `started pid ${started.pid}` : `start failed: ${started.message}`;
  }
  const killed = await killDecision(name, decision.decision, io);
  if (!killed.ok) {
    const recovered = await recoverWithoutSignal(name, decision.decision, decision.state, killed.reason, io);
    if (recovered) return recovered;
    return `left in place (${killed.reason})`;
  }
  const started = await startWatcher(name, io, { ...decision.state, lastSpawnPid: null }, false);
  return started.ok ? `replaced with pid ${started.pid}` : `killed, then start failed: ${started.message}`;
}

const FOREIGN_PID = new Set(['pid-reused', 'not-watcher']);

/**
 * The pid we remembered is not our watcher. Do not signal it. Drop the stale spawn
 * record and start one watcher. A lock whose pid was reused is reclaimed with --force,
 * which only rewrites the lock file. An unidentified pid is not signalled and is not reclaimed.
 */
async function recoverWithoutSignal(
  name: string,
  decision: Extract<SuperviseDecision, { action: 'kill-lock' | 'kill-spawn' }>,
  state: AgentSuperviseState,
  reason: string,
  io: SuperviseIo,
): Promise<string | null> {
  const spawnWasNotOurs = decision.action === 'kill-spawn' && (FOREIGN_PID.has(reason) || reason === 'unverified-process');
  const lockWasNotOurs = decision.action === 'kill-lock' && FOREIGN_PID.has(reason);
  if (!spawnWasNotOurs && !lockWasNotOurs) return null;
  const cleared: AgentSuperviseState = { ...state, lastSpawnPid: null, lastSpawnAt: null };
  writeSuperviseState(io.home, name, cleared);
  const started = await startWatcher(name, io, cleared, lockWasNotOurs);
  if (!started.ok) return `start failed: ${started.message}`;
  return `started pid ${started.pid} without signalling ${decision.pid} (${reason})`;
}

async function ensureWatcher(
  name: string,
  io: SuperviseIo,
  scriptPath: string,
  nodePath: string,
  replace: boolean,
): Promise<SuperviseResult> {
  const bound: SuperviseIo = { ...io, scriptPath, nodePath };
  const lock = liveLock(io.home, name);
  if (lock && replace) {
    const killed = await killDecision(
      name,
      { action: 'kill-lock', reason: 'wedge', pid: lock.pid, token: lock.token ?? '', startedAt: lock.startedAt },
      bound,
    );
    if (!killed.ok) {
      return {
        ok: false,
        message: `A watcher for ${name} is already running (pid ${lock.pid}) and was not replaced (${killed.reason}). A second watcher was not started.`,
      };
    }
  } else if (lock) {
    return { ok: true, lines: [`Watcher already running for ${name} (pid ${lock.pid}).`] };
  }
  const started = await startWatcher(name, bound, readSuperviseState(io.home, name), false);
  if (!started.ok) return { ok: false, message: started.message };
  return { ok: true, lines: [`Watcher started for ${name} (pid ${started.pid}), detached from this terminal.`] };
}

async function startWatcher(
  name: string,
  io: SuperviseIo,
  state: AgentSuperviseState,
  force: boolean,
): Promise<{ ok: true; pid: number } | { ok: false; message: string }> {
  if (!agentKeyFileExists(name, io.home)) {
    writeHold(io.home, name, 'config');
    return { ok: false, message: `No key file for ${name}. Not started.` };
  }
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  const nodePath = io.nodePath ?? process.execPath;
  const request: SpawnRequest = {
    nodePath,
    scriptPath,
    name,
    home: io.home ?? '',
    pathEnv: io.env?.PATH ?? process.env.PATH ?? '',
    ...(io.env?.REPLYSLIP_ORCA_BIN ? { orcaBin: io.env.REPLYSLIP_ORCA_BIN } : {}),
    ...(force ? { force: true } : {}),
  };
  try {
    const spawnWatcher = io.spawnWatcher ?? spawnDetachedWatcher;
    const child = spawnWatcher(request);
    const now = (io.now ?? Date.now)();
    writeSuperviseState(io.home, name, {
      ...state,
      restarts: [...state.restarts, new Date(now).toISOString()],
      lastSpawnAt: new Date(now).toISOString(),
      lastSpawnPid: child.pid,
    });
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not start the watcher.' };
  }
}

async function killDecision(
  name: string,
  decision: Extract<SuperviseDecision, { action: 'kill-lock' | 'kill-spawn' }>,
  io: SuperviseIo,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const identify = io.identify ?? ((pid: number) => identifyProcess(pid, io.platform ?? process.platform));
  const identity = await identify(decision.pid);
  const allowed =
    decision.action === 'kill-lock'
      ? killLockAllowed({
          lock: currentLockIdentity(io.home, name),
          expected: { pid: decision.pid, token: decision.token, startedAt: decision.startedAt },
          identity,
        })
      : killSpawnAllowed({ identity, spawnedAt: decision.spawnedAt });
  if (!allowed.ok) return allowed;
  return signalPid(decision.pid, io, decision.action === 'kill-lock' ? 'graceful' : 'force', async () => {
    const again = await identify(decision.pid);
    if (decision.action === 'kill-lock') {
      return killLockAllowed({
        lock: currentLockIdentity(io.home, name),
        expected: { pid: decision.pid, token: decision.token, startedAt: decision.startedAt },
        identity: again,
      });
    }
    return killSpawnAllowed({ identity: again, spawnedAt: decision.spawnedAt });
  });
}

async function signalAgent(name: string, io: SuperviseIo): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lock = liveLock(io.home, name);
  if (!lock?.token) return { ok: false, reason: 'not-running' };
  // The stop file is already written. A failed identity check must not signal some other pid.
  return killDecision(name, { action: 'kill-lock', reason: 'wedge', pid: lock.pid, token: lock.token, startedAt: lock.startedAt }, io);
}

async function signalPid(
  pid: number,
  io: SuperviseIo,
  mode: 'graceful' | 'force',
  recheck: () => Promise<{ ok: true } | { ok: false; reason: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const platform = io.platform ?? process.platform;
  const kill = io.kill ?? ((target: number, signal: 'SIGTERM' | 'SIGKILL') => defaultKill(target, signal, platform));
  const alive = io.alive ?? pidIsAlive;
  const sleep = io.sleep ?? defaultSleep;
  const again = await recheck();
  if (!again.ok) return again;
  if (platform === 'win32' || mode === 'force') {
    kill(pid, 'SIGKILL');
    return { ok: true };
  }
  kill(pid, 'SIGTERM');
  await sleep(500);
  if (!alive(pid)) return { ok: true };
  const finalCheck = await recheck();
  if (!finalCheck.ok) return { ok: true };
  kill(pid, 'SIGKILL');
  return { ok: true };
}

function defaultKill(pid: number, signal: 'SIGTERM' | 'SIGKILL', platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    process.kill(pid);
    return;
  }
  process.kill(pid, signal);
}

function currentLockIdentity(home: string | undefined, name: string): { pid: number; token: string; startedAt: string } | null {
  const lock = liveLock(home, name);
  if (!lock?.token) return null;
  return { pid: lock.pid, token: lock.token, startedAt: lock.startedAt };
}

function liveLock(home: string | undefined, name: string): WatcherLockInfo | null {
  return listLiveWatcherLocks(home).find((lock) => lock.agentName === name) ?? null;
}

async function removeTimer(io: SuperviseIo): Promise<SuperviseResult> {
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  const nodePath = io.nodePath ?? process.execPath;
  const plan = buildInstallPlan(planInput(io, scriptPath, nodePath));
  if ('error' in plan) return { ok: true, lines: [plan.error] };
  const run = io.run ?? defaultRun;
  const applied = await runPlan(plan.uninstallCommands, run);
  for (const file of plan.files) {
    try {
      unlinkSync(file.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, message: `Could not remove ${file.path}.` };
      }
    }
  }
  if (!applied.ok) return { ok: false, message: applied.message };
  return { ok: true, lines: ['Supervision timer removed.'] };
}

function planInput(io: SuperviseIo, scriptPath: string, nodePath: string): InstallPlanInput {
  return {
    platform: io.platform ?? process.platform,
    home: io.home ?? '',
    nodePath,
    scriptPath,
    pathEnv: io.env?.PATH ?? process.env.PATH ?? '',
    ...(io.env?.REPLYSLIP_ORCA_BIN ? { orcaBin: io.env.REPLYSLIP_ORCA_BIN } : {}),
    ...(typeof (io.uid ?? process.getuid?.()) === 'number' ? { uid: io.uid ?? process.getuid?.() } : {}),
    ...(io.label ? { label: io.label } : {}),
    ...(io.taskName ? { taskName: io.taskName } : {}),
    ...(io.unitName ? { unitName: io.unitName } : {}),
  };
}

function writePlanFiles(plan: InstallPlan): void {
  for (const file of plan.files) {
    mkdirSync(path.dirname(file.path), { recursive: true, mode: 0o700 });
    writeFileSync(file.path, file.contents, { mode: file.mode });
    try {
      chmodSync(file.path, file.mode);
    } catch {
      // Windows ignores the Unix mode.
    }
  }
}

async function runPlan(commands: PlannedCommand[], run: CommandRun): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const step of commands) {
    let result: CommandOutput;
    try {
      result = await run(step.command, step.args);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      if (step.optional) continue;
      if (code === 'ENOENT') return { ok: false, message: `${step.command} was not found.` };
      return { ok: false, message: err instanceof Error ? err.message : `${step.command} failed.` };
    }
    if (result.code !== 0 && !step.optional) {
      const detail = redactSecrets(`${result.stderr}\n${result.stdout}`).trim().slice(0, 400);
      return { ok: false, message: `${step.command} ${step.args.join(' ')} exited ${result.code}${detail ? `: ${detail}` : ''}.` };
    }
  }
  return { ok: true };
}

function preflightMessage(platform: InstallPlan['platform'], detail: string): string {
  if (platform === 'linux' && /not found|systemctl/i.test(detail)) {
    return `No working systemd user session (${detail}). Log in on this machine and try again. Linger was not enabled. Supervision was not installed.`;
  }
  if (platform === 'darwin') {
    return `launchctl could not load the LaunchAgent (${detail}). Supervision was not installed.`;
  }
  if (platform === 'win32') {
    return `Task Scheduler could not install the task (${detail}). Supervision was not installed. The task is not configured to run while logged off.`;
  }
  return detail;
}

function statusLine(name: string, home: string | undefined): string {
  if (isStopped(home, name)) return `${name}: deliberate stop. supervise --install clears it.`;
  const hold = readHold(home, name);
  if (hold) return `${name}: held (${hold}). supervise --install clears it after the cause is fixed.`;
  const lock = liveLock(home, name);
  const progress = readProgress(home, name);
  if (!lock) return `${name}: watcher not running.`;
  if (!progress || progress.token !== lock.token) return `${name}: running pid ${lock.pid}, progress not matched yet.`;
  return `${name}: running pid ${lock.pid}, phase ${progress.phase}, deadline ${progress.deadlineAt}.`;
}

function agentKeyFileExists(name: string, home: string | undefined): boolean {
  try {
    accessSync(agentKeyPath(name, home));
    return true;
  } catch {
    return false;
  }
}

function checkName(name: string): string | null {
  if (!AGENT_NAME_PATTERN.test(name)) return 'Usage: replyslip supervise --install --name <name>';
  return null;
}

const defaultRun: CommandRun = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export function appendSuperviseLog(home: string | undefined, line: string): void {
  try {
    const dir = superviseDir(home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'supervise.log');
    appendFileSync(file, `${redactSecrets(line)}\n`, { mode: 0o600 });
  } catch {
    // Logging must not hide the supervision result.
  }
}

export function clearProgressOnExit(home: string | undefined, name: string): void {
  clearProgress(home, name);
}
