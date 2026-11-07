// SPDX-License-Identifier: Apache-2.0

import { homedir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';
import { agentKeyPath, joinCodeEnvName, listRegisteredAgents, readAgentCredentials, registerAgent, resolveJoinCode } from './register.ts';
import {
  appendSuperviseLog,
  installSupervision,
  runSupervisionTick,
  stopSupervision,
  supervisionStatus,
  uninstallSupervision,
  type SuperviseIo,
} from './supervise.ts';
import { AgentWatchUnsupportedError, WatcherAuthError, WatcherNotFoundError, watch, type WatchResult } from './watch.ts';
import {
  WATCHER_NOT_RUNNING_MESSAGE,
  agentAlreadyRunningMessage,
  agentWatchersRunningMessage,
  alreadyRunningMessage,
  listLiveWatcherLocks,
  statusLine,
} from './watcher-lock.ts';
import { clearProgress, writeHold, writeProgress, type WatcherProgress } from './watcher-progress.ts';

/** Set by scripts/bundle-replyslip.mjs from packages/cli/package.json. Undefined under tsx. */
declare const __REPLYSLIP_VERSION__: string | undefined;

export const REPLYSLIP_VERSION = typeof __REPLYSLIP_VERSION__ === 'string' ? __REPLYSLIP_VERSION__ : 'dev';

const HELP = `replyslip ${REPLYSLIP_VERSION}: watcher and register CLI for Valetto (https://valetto.tech)

Usage:
  replyslip register --join-code <code> --name <name> [--url <origin>] [--description <text>] [--force]
  replyslip watch [--name <name>] [--url <origin>] [--interval <ms>] [--once] [--force]
  replyslip watch --status
  replyslip watch --stop --name <name>
  replyslip supervise --install --name <name>
  replyslip supervise --once
  replyslip supervise --status
  replyslip supervise --stop --name <name>
  replyslip supervise --uninstall (--name <name> | --all)
  replyslip key-path <name>
  replyslip --help | --version

watch runs one agent's own watcher with the key register saved in ~/.replyslip/agents/<name>.json.
It wakes only that agent's pane. --name is needed only when more than one agent is registered here.
Each agent starts its own watcher. Delivery (herdr or Orca, and the pane) is set by the human on the dashboard.
supervise --install uses this same script. It checks replyslip.mjs.sha256 beside it, installs an OS timer
(macOS LaunchAgent, Linux systemd --user, or Windows Task Scheduler) that runs supervise --once every 120 seconds,
and starts the watcher detached. It does not type into a herdr or Orca pane.
supervise --stop records a deliberate stop. Logout, sleep, and shutdown do not. --install clears that stop.

Legacy, machine-wide (one workspace watcher key for every local agent in the workspace):
  replyslip watch (--key-file <file> | --key <watcher-key>) [--url <origin>] [--interval <ms>] [--once] [--force]
A per-agent watcher refuses to start while a legacy watcher for the same workspace runs on this machine.

--url defaults to REPLYSLIP_URL, then the server the agent registered with, then https://valetto.tech.
Environment: REPLYSLIP_URL, REPLYSLIP_WATCHER_KEY (legacy), REPLYSLIP_POLL_INTERVAL_MS, REPLYSLIP_ORCA_BIN.
Agent setup guide: https://valetto.tech/skill.md`;

export type CliIo = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetchImpl?: typeof fetch;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Injected by tests. Production uses launchctl, systemctl, or schtasks. */
  supervise?: SuperviseIo;
};

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) return undefined;
  return value;
}

export const DEFAULT_RELAY_URL = 'https://valetto.tech';

export const URL_MISSING_MESSAGE = '--url needs a value, for example --url https://valetto.tech. Leave --url off to use REPLYSLIP_URL or https://valetto.tech.';

/** `--url` given as the last argument or followed by another flag. A blank value (`--url ""`) still falls back. */
export function urlFlagMissingValue(argv: string[]): boolean {
  const index = argv.indexOf('--url');
  if (index === -1) return false;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('-');
}

/** --url, then REPLYSLIP_URL, then valetto.tech. Empty or whitespace-only values fall through. Shared by register and watch. */
export function relayOrigin(argv: string[], env: NodeJS.ProcessEnv): string {
  return flag(argv, '--url')?.trim() || env.REPLYSLIP_URL?.trim() || DEFAULT_RELAY_URL;
}

function positionals(argv: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--force' || arg === '--once') continue;
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value && !value.startsWith('-')) i += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

export async function runReplyslip(argv: string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  const env = io.env ?? process.env;
  const [command, ...rest] = positionals(argv);

  if (argv.includes('--version') || argv.includes('-v') || command === 'version') {
    stdout(REPLYSLIP_VERSION);
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h') || command === 'help') {
    stdout(HELP);
    return 0;
  }

  if (command === 'key-path') {
    const name = rest[0] ?? flag(argv, '--name');
    if (!name || !AGENT_NAME_PATTERN.test(name)) {
      stderr('Usage: replyslip key-path <name>');
      return 1;
    }
    stdout(agentKeyPath(name, io.home));
    return 0;
  }

  if ((command === 'register' || command === 'watch') && !argv.includes('--status') && urlFlagMissingValue(argv)) {
    stderr(URL_MISSING_MESSAGE);
    return 1;
  }

  if (command === 'register') {
    const name = flag(argv, '--name');
    if (!name || !AGENT_NAME_PATTERN.test(name)) {
      stderr('Usage: replyslip register --join-code <code> --name <name> [--url <origin>] [--description <text>] [--force]');
      return 1;
    }
    const joinCode = resolveJoinCode(name, flag(argv, '--join-code'), env);
    if (!joinCode) {
      stderr(
        `Pass --join-code or set ${joinCodeEnvName(name)}. A shared REPLYSLIP_JOIN_CODE is ignored: one name on a shared machine burned single-use join codes when the wrong process registered first.`,
      );
      return 1;
    }
    const relayUrl = relayOrigin(argv, env);
    try {
      const saved = await registerAgent({
        name,
        description: flag(argv, '--description'),
        joinCode,
        relayUrl,
        home: io.home,
        force: argv.includes('--force'),
        fetchImpl: io.fetchImpl,
      });
      stdout(saved.name);
      stdout(saved.mcpUrl);
      stdout(`key saved to ${saved.path}`);
      return 0;
    } catch (err) {
      stderr(err instanceof Error ? err.message : 'Registration failed.');
      return 1;
    }
  }

  if (command === 'supervise') return runSupervise(argv, io, stdout, stderr);

  if (command !== 'watch') {
    stderr('Usage: replyslip watch | register | key-path | supervise');
    return 1;
  }

  if (argv.includes('--stop')) {
    const name = flag(argv, '--name');
    if (!name || !AGENT_NAME_PATTERN.test(name)) {
      stderr('Usage: replyslip watch --stop --name <name>');
      return 1;
    }
    return finishSupervise(await stopSupervision(name, superviseIo(io)), stdout, stderr);
  }

  if (argv.includes('--status')) {
    const live = listLiveWatcherLocks(io.home);
    if (live.length === 0) stdout(WATCHER_NOT_RUNNING_MESSAGE);
    else for (const lock of live) stdout(statusLine(lock));
    return 0;
  }

  const keyFile = flag(argv, '--key-file');
  const legacyKey = flag(argv, '--key') ?? env.REPLYSLIP_WATCHER_KEY;
  const intervalMs = Number(flag(argv, '--interval') ?? env.REPLYSLIP_POLL_INTERVAL_MS ?? '3000');
  if (!Number.isFinite(intervalMs) || intervalMs < 500) {
    stderr('--interval must be at least 500 milliseconds.');
    return 1;
  }
  if (keyFile || legacyKey) return watchLegacy(argv, env, io, stdout, stderr, intervalMs, keyFile, legacyKey);

  // Per-agent watcher: this agent's own key from the file register wrote. It wakes only this agent's pane.
  let name = flag(argv, '--name');
  if (name !== undefined && !AGENT_NAME_PATTERN.test(name)) {
    stderr('Usage: replyslip watch [--name <name>]');
    return 1;
  }
  if (!name) {
    const registered = await listRegisteredAgents(io.home);
    if (registered.length === 0) {
      stderr(
        `No agent is registered on this machine (${agentKeyPath('<name>', io.home)}). Register first: replyslip register --join-code <code> --name <name>. A legacy watcher key still works with --key-file.`,
      );
      return 1;
    }
    if (registered.length > 1) {
      stderr(`More than one agent is registered on this machine (${registered.join(', ')}). Pass --name <name>: each agent runs its own watcher.`);
      return 1;
    }
    name = registered[0]!;
  }
  let credentials;
  try {
    credentials = await readAgentCredentials(name, { home: io.home, warn: stderr });
  } catch (err) {
    stderr(err instanceof Error ? err.message : 'Could not read the agent key file.');
    return 1;
  }
  const url = flag(argv, '--url')?.trim() || env.REPLYSLIP_URL?.trim() || credentials.relayUrl || DEFAULT_RELAY_URL;
  const reclaimArgs = readReclaim(argv);
  if (reclaimArgs === 'invalid') {
    stderr('Reclaim needs --reclaim-pid, --reclaim-token, and --reclaim-started-at for the exact lock being replaced.');
    return 1;
  }
  const progress = createProgressRecorder(io.home, name);
  const unhang = ignoreHangup(env);
  let result: WatchResult;
  try {
    result = await watch({
      url,
      key: credentials.apiKey,
      intervalMs,
      once: argv.includes('--once'),
      fetchImpl: io.fetchImpl,
      log: supervisedLog(io.home, name, env, stderr),
      lock: { home: io.home, force: argv.includes('--force'), reclaim: reclaimArgs ?? undefined },
      agent: { name },
      progress,
    });
  } catch (err) {
    rememberHold(io.home, name, err);
    stderr(err instanceof Error ? err.message : 'Watcher stopped.');
    return 1;
  } finally {
    unhang();
    progress.clear();
  }
  if (result.legacyBlocked) {
    writeHold(io.home, name, 'legacy');
    stderr(result.legacyBlocked);
    return 1;
  }
  if (result.blockedPid !== undefined) {
    stdout(agentAlreadyRunningMessage(result.blockedAgent ?? name, result.blockedPid, result.blockedOrigin ?? url, result.blockedPath ?? ''));
  }
  return 0;
}

/** Legacy machine-wide watcher (`--key-file`, `--key`, or REPLYSLIP_WATCHER_KEY): unchanged behaviour. */
async function watchLegacy(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
  intervalMs: number,
  keyFile: string | undefined,
  legacyKey: string | undefined,
): Promise<number> {
  const url = relayOrigin(argv, env);
  let key = legacyKey;
  if (keyFile) {
    try {
      key = await readWatcherKeyFile(keyFile, stderr);
    } catch (err) {
      stderr(err instanceof Error ? err.message : 'Could not read watcher key file.');
      return 1;
    }
  }
  if (!key) {
    stderr('Set one of --key-file, --key, or REPLYSLIP_WATCHER_KEY.');
    return 1;
  }
  let result: WatchResult;
  try {
    result = await watch({
      url,
      key,
      intervalMs,
      once: argv.includes('--once'),
      fetchImpl: io.fetchImpl,
      log: io.stderr,
      lock: { home: io.home, force: argv.includes('--force') },
    });
  } catch (err) {
    stderr(err instanceof Error ? err.message : 'Watcher stopped.');
    return 1;
  }
  if (result.blockedPid !== undefined) {
    if (result.blockedAgent) stdout(agentWatchersRunningMessage(result.blockedAgent, result.blockedPid, result.blockedPath ?? ''));
    else stdout(alreadyRunningMessage(result.blockedPid, result.blockedOrigin ?? url, result.blockedPath ?? ''));
  }
  return 0;
}

function readReclaim(argv: string[]): { pid: number; token: string; startedAt: string } | undefined | 'invalid' {
  const pidText = flag(argv, '--reclaim-pid');
  const token = flag(argv, '--reclaim-token');
  const startedAt = flag(argv, '--reclaim-started-at');
  if (pidText === undefined && token === undefined && startedAt === undefined) return undefined;
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0 || !token || !/^[0-9a-f]{16}$/.test(token) || !startedAt || /[\r\n\0]/.test(startedAt)) return 'invalid';
  return { pid, token, startedAt };
}

function superviseIo(io: CliIo): SuperviseIo {
  return {
    home: io.home ?? homedir(),
    env: io.env ?? process.env,
    scriptPath: io.supervise?.scriptPath,
    nodePath: io.supervise?.nodePath,
    platform: io.supervise?.platform,
    uid: io.supervise?.uid,
    run: io.supervise?.run,
    spawnWatcher: io.supervise?.spawnWatcher,
    identify: io.supervise?.identify,
    alive: io.supervise?.alive,
    kill: io.supervise?.kill,
    sleep: io.supervise?.sleep,
    beforeSpawn: io.supervise?.beforeSpawn,
    now: io.supervise?.now,
    label: io.supervise?.label,
    taskName: io.supervise?.taskName,
    unitName: io.supervise?.unitName,
  };
}

async function runSupervise(
  argv: string[],
  io: CliIo,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  const sup = superviseIo(io);
  if (argv.includes('--once')) return finishSupervise(await runSupervisionTick(sup), stdout, stderr);
  if (argv.includes('--status')) {
    for (const line of supervisionStatus(sup)) stdout(line);
    return 0;
  }
  if (argv.includes('--install')) {
    const name = flag(argv, '--name');
    if (!name) {
      stderr('Usage: replyslip supervise --install --name <name>');
      return 1;
    }
    return finishSupervise(await installSupervision(name, sup), stdout, stderr);
  }
  if (argv.includes('--stop')) {
    const name = flag(argv, '--name');
    if (!name) {
      stderr('Usage: replyslip supervise --stop --name <name>');
      return 1;
    }
    return finishSupervise(await stopSupervision(name, sup), stdout, stderr);
  }
  if (argv.includes('--uninstall')) {
    return finishSupervise(await uninstallSupervision({ name: flag(argv, '--name'), all: argv.includes('--all') }, sup), stdout, stderr);
  }
  stderr('Usage: replyslip supervise --install --name <name> | --once | --status | --stop --name <name> | --uninstall (--name <name> | --all)');
  return 1;
}

function finishSupervise(
  result: { ok: true; lines: string[] } | { ok: false; message: string },
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): number {
  if (!result.ok) {
    stderr(result.message);
    return 1;
  }
  for (const line of result.lines) stdout(line);
  return 0;
}

function rememberHold(home: string | undefined, name: string, err: unknown): void {
  if (err instanceof WatcherAuthError) writeHold(home, name, 'auth');
  else if (err instanceof WatcherNotFoundError || err instanceof AgentWatchUnsupportedError) writeHold(home, name, 'config');
}

function createProgressRecorder(home: string | undefined, name: string) {
  let identity: { pid: number; token: string; startedAt: string } | null = null;
  return {
    attach(next: { pid: number; token: string; startedAt: string }) {
      identity = next;
    },
    note(phase: WatcherProgress['phase'], budgetMs: number) {
      if (!identity) return;
      const at = Date.now();
      writeProgress(home, name, {
        pid: identity.pid,
        token: identity.token,
        startedAt: identity.startedAt,
        phase,
        at: new Date(at).toISOString(),
        deadlineAt: new Date(at + budgetMs).toISOString(),
      });
    },
    clear() {
      clearProgress(home, name);
    },
  };
}

function supervisedLog(
  home: string | undefined,
  name: string,
  env: NodeJS.ProcessEnv,
  stderr: (line: string) => void,
): (line: string) => void {
  if (env.REPLYSLIP_SUPERVISED !== '1') return stderr;
  return (line: string) => {
    appendSuperviseLog(home, `${name}: ${line}`);
  };
}

/** A supervised watcher is detached. A hangup from a closing terminal is not a deliberate stop. */
function ignoreHangup(env: NodeJS.ProcessEnv): () => void {
  if (env.REPLYSLIP_SUPERVISED !== '1') return () => undefined;
  const onHang = () => undefined;
  try {
    process.on('SIGHUP', onHang);
  } catch {
    return () => undefined;
  }
  return () => {
    process.off('SIGHUP', onHang);
  };
}

/** One line, trimmed. The key is never included in an error. */
async function readWatcherKeyFile(file: string, stderr: (line: string) => void): Promise<string> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`Could not read watcher key file ${file}.`);
  }
  const key = text.trim();
  if (!key || key.includes('\n') || key.includes('\r')) {
    throw new Error(`Watcher key file ${file} must contain a single line.`);
  }
  try {
    const info = await stat(file);
    if ((info.mode & 0o077) !== 0) {
      stderr(`Watcher key file ${file} is not mode 600.`);
    }
  } catch {
    // The read already succeeded. A later stat failure is not a reason to print the key.
  }
  return key;
}
