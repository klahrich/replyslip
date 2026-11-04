// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'node:fs/promises';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';
import { agentKeyPath, joinCodeEnvName, listRegisteredAgents, readAgentCredentials, registerAgent, resolveJoinCode } from './register.ts';
import { watch, type WatchResult } from './watch.ts';
import {
  WATCHER_NOT_RUNNING_MESSAGE,
  agentAlreadyRunningMessage,
  agentWatchersRunningMessage,
  alreadyRunningMessage,
  listLiveWatcherLocks,
  statusLine,
} from './watcher-lock.ts';

/** Set by scripts/bundle-replyslip.mjs from packages/cli/package.json. Undefined under tsx. */
declare const __REPLYSLIP_VERSION__: string | undefined;

export const REPLYSLIP_VERSION = typeof __REPLYSLIP_VERSION__ === 'string' ? __REPLYSLIP_VERSION__ : 'dev';

const HELP = `replyslip ${REPLYSLIP_VERSION}: watcher and register CLI for Valetto (https://valetto.tech)

Usage:
  replyslip register --join-code <code> --name <name> [--url <origin>] [--description <text>] [--force]
  replyslip watch [--name <name>] [--url <origin>] [--interval <ms>] [--once] [--force]
  replyslip watch --status
  replyslip key-path <name>
  replyslip --help | --version

watch runs one agent's own watcher with the key register saved in ~/.replyslip/agents/<name>.json.
It wakes only that agent's pane. --name is needed only when more than one agent is registered here.
Each agent starts its own watcher. Delivery (herdr or Orca, and the pane) is set by the human on the dashboard.

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

  if (command !== 'watch') {
    stderr('Usage: replyslip watch | register | key-path');
    return 1;
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
  let result: WatchResult;
  try {
    result = await watch({
      url,
      key: credentials.apiKey,
      intervalMs,
      once: argv.includes('--once'),
      fetchImpl: io.fetchImpl,
      log: io.stderr,
      lock: { home: io.home, force: argv.includes('--force') },
      agent: { name },
    });
  } catch (err) {
    stderr(err instanceof Error ? err.message : 'Watcher stopped.');
    return 1;
  }
  if (result.legacyBlocked) {
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
