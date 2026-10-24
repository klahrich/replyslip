import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';

export type AgentKeyFile = {
  name: string;
  agent_id: string;
  api_key: string;
  mcp_url: string;
  relay_url: string;
  created_at: string;
};

export function replyslipHome(home = homedir()): string {
  return path.join(home, '.replyslip');
}

export function agentKeyPath(name: string, home = homedir()): string {
  return path.join(replyslipHome(home), 'agents', `${name}.json`);
}

/** REPLYSLIP_JOIN_CODE_<NAME>: uppercase the agent name and replace every other character with _. */
export function joinCodeEnvName(agentName: string): string {
  return `REPLYSLIP_JOIN_CODE_${agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function resolveJoinCode(agentName: string, flag: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (flag && flag.trim()) return flag.trim();
  const fromEnv = env[joinCodeEnvName(agentName)];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return null;
}

function relayOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Relay URL must use http or https.');
  }
  return url.origin;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export async function writeAgentKeyFile(file: AgentKeyFile, options: { home?: string; force?: boolean }): Promise<string> {
  if (!AGENT_NAME_PATTERN.test(file.name)) {
    throw new Error('Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.');
  }
  const home = options.home ?? homedir();
  const root = replyslipHome(home);
  const agentsDir = path.join(root, 'agents');
  await ensurePrivateDir(root);
  await ensurePrivateDir(agentsDir);
  const target = agentKeyPath(file.name, home);
  const body = `${JSON.stringify(file, null, 2)}\n`;
  try {
    await writeFile(target, body, { flag: options.force ? 'w' : 'wx', mode: 0o600 });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
    if (code === 'EEXIST') {
      throw new Error(`Refusing to overwrite ${target}. Pass --force to replace it.`);
    }
    throw new Error(`Registered ${file.name} but could not save the key file. The key was not printed. Revoke the agent and register again.`);
  }
  await chmod(target, 0o600);
  return target;
}

async function refuseExistingKeyFile(name: string, home: string | undefined, force: boolean | undefined): Promise<void> {
  if (force) return;
  const target = agentKeyPath(name, home ?? homedir());
  try {
    await stat(target);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
    if (code === 'ENOENT') return;
    throw err;
  }
  throw new Error(`Refusing to overwrite ${target}. Pass --force to replace it.`);
}

export async function registerAgent(options: {
  name: string;
  description?: string;
  joinCode: string;
  relayUrl: string;
  home?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; name: string; mcpUrl: string }> {
  if (!AGENT_NAME_PATTERN.test(options.name)) {
    throw new Error('Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.');
  }
  await refuseExistingKeyFile(options.name, options.home, options.force);
  const relay = relayOrigin(options.relayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${relay}/api/v1/agents/register`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.joinCode}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: options.name,
      ...(options.description ? { description: options.description } : {}),
    }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && payload && 'error' in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
        ? (payload as { error: { message: string } }).error.message
        : `Registration failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const record = payload as {
    api_key?: unknown;
    agent?: { id?: unknown; created_at?: unknown };
    mcp?: { url?: unknown };
  };
  if (typeof record.api_key !== 'string' || typeof record.agent?.id !== 'string') {
    throw new Error(`Registration failed (HTTP ${response.status}).`);
  }
  const mcpUrl = typeof record.mcp?.url === 'string' ? record.mcp.url : `${relay}/api/mcp`;
  const createdAt = typeof record.agent.created_at === 'string' ? record.agent.created_at : new Date().toISOString();
  const filePath = await writeAgentKeyFile(
    {
      name: options.name,
      agent_id: record.agent.id,
      api_key: record.api_key,
      mcp_url: mcpUrl,
      relay_url: relay,
      created_at: createdAt,
    },
    { home: options.home, force: options.force },
  );
  return { path: filePath, name: options.name, mcpUrl };
}
