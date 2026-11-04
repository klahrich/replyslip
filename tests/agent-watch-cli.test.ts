// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplyslip } from '../packages/cli/src/cli';
import { watch } from '../packages/cli/src/watch';
import {
  acquireAgentWatcherLock,
  agentRunningStatusMessage,
  agentWatcherScopeId,
  legacyWatcherScopeId,
  machineBootId,
  readWatcherLock,
  watcherLockPath,
  watcherScopeId,
} from '../packages/cli/src/watcher-lock';

const ORIGIN = 'https://relay.example';
const WS = 'ws-agent-1';
const AGENT_KEY = 'rsk_CANARY_agent_key_do_not_print';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) };
}

function liveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
}

async function stop(child: ReturnType<typeof liveChild>) {
  child.kill();
  await once(child, 'exit');
}

async function homeWithAgents(...names: string[]): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'replyslip-agent-watch-'));
  const dir = path.join(home, '.replyslip', 'agents');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of names) {
    writeFileSync(
      path.join(dir, `${name}.json`),
      `${JSON.stringify({ name, agent_id: `id-${name}`, api_key: `${AGENT_KEY}_${name}`, mcp_url: `${ORIGIN}/api/mcp`, relay_url: ORIGIN, created_at: '2026-11-04T00:00:00.000Z' })}\n`,
      { mode: 0o600 },
    );
  }
  return home;
}

/** A legacy machine-wide (watcher key) lock for WS held by a live pid, as replyslip 0.1.2 writes it. */
function writeLegacyLock(home: string, pid: number, options: { preWorkspaceField?: boolean } = {}): string {
  const file = options.preWorkspaceField
    ? watcherLockPath(home, legacyWatcherScopeId('https://valetto.tech', WS, ''))
    : watcherLockPath(home, watcherScopeId(WS, 'rsw_any'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      pid,
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: hostname(),
      bootId: machineBootId(),
      origin: 'https://valetto.tech',
      ...(options.preWorkspaceField ? {} : { workspaceId: WS }),
    })}\n`,
  );
  return file;
}

type Seen = { url: string; auth: string | null; body: unknown };

function fakeRelay(agentName: string, wakes: unknown[] = []) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get('authorization');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    seen.push({ url, auth, body });
    if (url.endsWith('/ack')) return Response.json({ acked: (body as { wake_ids: string[] }).wake_ids.length });
    const lease = !(body && (body as { lease?: boolean }).lease === false);
    return Response.json({ wakes: lease ? wakes : [], workspace_id: WS, agent_id: `id-${agentName}`, agent_name: agentName });
  };
  return { seen, fetchImpl };
}

describe('replyslip watch with the agent own key', () => {
  it('uses the registered agent key, identifies without leasing, then locks for this agent only', async () => {
    const home = await homeWithAgents('PaneBot');
    const relay = fakeRelay('PaneBot');
    const io = capture();
    const code = await runReplyslip(['watch', '--once'], { home, env: {}, fetchImpl: relay.fetchImpl, stdout: io.stdout, stderr: io.stderr });
    expect(code).toBe(0);
    expect(relay.seen.map((s) => s.url)).toEqual([`${ORIGIN}/api/v1/watcher/poll`, `${ORIGIN}/api/v1/watcher/poll`]);
    expect(relay.seen[0]!.body).toEqual({ lease: false });
    expect(relay.seen[1]!.body).toBeNull();
    expect(relay.seen.every((s) => s.auth === `Bearer ${AGENT_KEY}_PaneBot`)).toBe(true);
    expect(io.err.join('\n')).toContain('for agent PaneBot');
    expect(io.out.join('\n') + io.err.join('\n')).not.toContain(AGENT_KEY);
    // --once released the lock; nothing with the key is left behind.
    for (const name of readdirSync(path.join(home, '.replyslip'))) {
      if (name.endsWith('.lock')) expect(readFileSync(path.join(home, '.replyslip', name), 'utf8')).not.toContain(AGENT_KEY);
    }
  });

  it('needs --name when more than one agent is registered, and uses the named one', async () => {
    const home = await homeWithAgents('AlphaBot', 'BetaBot');
    const relay = fakeRelay('BetaBot');
    const ambiguous = capture();
    expect(await runReplyslip(['watch', '--once'], { home, env: {}, fetchImpl: relay.fetchImpl, stdout: ambiguous.stdout, stderr: ambiguous.stderr })).toBe(1);
    expect(ambiguous.err.join('\n')).toContain('AlphaBot, BetaBot');
    expect(relay.seen).toEqual([]);
    const named = capture();
    expect(await runReplyslip(['watch', '--once', '--name', 'BetaBot'], { home, env: {}, fetchImpl: relay.fetchImpl, stdout: named.stdout, stderr: named.stderr })).toBe(0);
    expect(relay.seen[0]!.auth).toBe(`Bearer ${AGENT_KEY}_BetaBot`);
  });

  it('refuses to start while a legacy machine-wide watcher for the workspace runs, without leasing a wake', async () => {
    for (const preWorkspaceField of [false, true]) {
      const home = await homeWithAgents('PaneBot');
      const child = liveChild();
      try {
        const lock = writeLegacyLock(home, child.pid ?? 0, { preWorkspaceField });
        const relay = fakeRelay('PaneBot', [{ id: 'wake-1', driver: 'herdr', target: 'pane-bot' }]);
        const io = capture();
        const code = await runReplyslip(['watch', '--once', '--force'], { home, env: {}, fetchImpl: relay.fetchImpl, stdout: io.stdout, stderr: io.stderr });
        expect(code).toBe(1);
        expect(relay.seen).toHaveLength(1);
        expect(relay.seen[0]!.body).toEqual({ lease: false });
        const message = io.err.join('\n');
        expect(message).toContain('legacy machine-wide ReplySlip watcher');
        expect(message).toContain(`pid ${child.pid}`);
        expect(message).toContain(lock);
        expect(message).toContain('stop that watcher first');
        expect(readWatcherLock(lock)?.pid).toBe(child.pid);
      } finally {
        await stop(child);
      }
    }
  });

  it('stops before nudging when a legacy watcher appears while it runs', async () => {
    const home = await homeWithAgents('PaneBot');
    const relay = fakeRelay('PaneBot');
    const child = liveChild();
    const prompts: string[][] = [];
    try {
      let sleeps = 0;
      const result = await watch({
        url: ORIGIN,
        key: `${AGENT_KEY}_PaneBot`,
        intervalMs: 500,
        fetchImpl: relay.fetchImpl,
        log: () => {},
        lock: { home },
        agent: { name: 'PaneBot' },
        runCommand: async (_cmd, args) => {
          prompts.push(args);
          return { code: 0, stdout: 'herdr 0.8.2\n', stderr: '' };
        },
        sleep: async () => {
          sleeps += 1;
          if (sleeps === 1) writeLegacyLock(home, child.pid ?? 0);
        },
      });
      expect(result.legacyBlocked).toContain('legacy machine-wide ReplySlip watcher');
      // hello + one leasing poll before the legacy lock appeared; none after.
      expect(relay.seen).toHaveLength(2);
      expect(prompts).toEqual([]);
    } finally {
      await stop(child);
    }
  });

  it('a legacy --key-file watcher refuses to start beside per-agent watchers for the workspace', async () => {
    const home = await homeWithAgents();
    const child = liveChild();
    try {
      const held = acquireAgentWatcherLock({ home, origin: ORIGIN, workspaceId: WS, agentId: 'id-PaneBot', agentName: 'PaneBot', pid: child.pid ?? 0 });
      expect(held.ok).toBe(true);
      const keyFile = path.join(home, 'watcher.key');
      writeFileSync(keyFile, 'rsw_legacy_key\n', { mode: 0o600 });
      const io = capture();
      const code = await runReplyslip(['watch', '--once', '--url', ORIGIN, '--key-file', keyFile], {
        home,
        env: {},
        stdout: io.stdout,
        stderr: io.stderr,
        fetchImpl: async () => Response.json({ wakes: [], workspace_id: WS }),
      });
      expect(code).toBe(0);
      expect(io.out.join('\n')).toContain('per-agent ReplySlip watcher is running for agent PaneBot');

      const status = capture();
      await runReplyslip(['watch', '--status'], { home, stdout: status.stdout, stderr: status.stderr });
      expect(status.out).toEqual([agentRunningStatusMessage(child.pid ?? 0, ORIGIN, 'PaneBot', WS)]);
    } finally {
      await stop(child);
    }
  });

  it('locks per agent: two agents in one workspace each run a watcher, the same agent twice is refused', async () => {
    const home = await homeWithAgents();
    const a = acquireAgentWatcherLock({ home, origin: ORIGIN, workspaceId: WS, agentId: 'id-a', agentName: 'A' });
    const b = acquireAgentWatcherLock({ home, origin: ORIGIN, workspaceId: WS, agentId: 'id-b', agentName: 'B' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(path.basename(a.hold.path)).toBe(`watcher-${agentWatcherScopeId('id-a')}.lock`);
    expect(readWatcherLock(a.hold.path)).toMatchObject({ workspaceId: WS, agentId: 'id-a', agentName: 'A' });
    const again = acquireAgentWatcherLock({ home, origin: ORIGIN, workspaceId: WS, agentId: 'id-a', agentName: 'A' });
    expect(again).toMatchObject({ ok: false, reason: 'running', agentName: 'A', path: a.hold.path });
    a.hold.release();
    b.hold.release();
  });
});
