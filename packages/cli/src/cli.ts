import { readFile, stat } from 'node:fs/promises';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';
import { agentKeyPath, joinCodeEnvName, registerAgent, resolveJoinCode } from './register.ts';
import { watch } from './watch.ts';

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

  if (command === 'key-path') {
    const name = rest[0] ?? flag(argv, '--name');
    if (!name || !AGENT_NAME_PATTERN.test(name)) {
      stderr('Usage: replyslip key-path <name>');
      return 1;
    }
    stdout(agentKeyPath(name, io.home));
    return 0;
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
    const relayUrl = flag(argv, '--url') ?? env.REPLYSLIP_URL ?? 'https://replyslip.com';
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

  const url = flag(argv, '--url') ?? env.REPLYSLIP_URL;
  const keyFile = flag(argv, '--key-file');
  let key = flag(argv, '--key') ?? env.REPLYSLIP_WATCHER_KEY;
  if (keyFile) {
    try {
      key = await readWatcherKeyFile(keyFile, stderr);
    } catch (err) {
      stderr(err instanceof Error ? err.message : 'Could not read watcher key file.');
      return 1;
    }
  }
  const intervalMs = Number(flag(argv, '--interval') ?? env.REPLYSLIP_POLL_INTERVAL_MS ?? '3000');
  if (!url || !key) {
    stderr('Set --url and one of --key-file, --key, or REPLYSLIP_WATCHER_KEY. REPLYSLIP_URL stands in for --url.');
    return 1;
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 500) {
    stderr('--interval must be at least 500 milliseconds.');
    return 1;
  }
  await watch({ url, key, intervalMs, once: argv.includes('--once'), fetchImpl: io.fetchImpl });
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
