import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WAKE_NOTICE } from '@/lib/wake-notice';
import { runReplyslip } from '../packages/cli/src/cli';
import { createRegistry } from '../packages/cli/src/drivers/registry';
import type { NudgeDriver } from '../packages/cli/src/drivers/types';
import { MAX_BACKOFF_MS, backoffDelay, watch } from '../packages/cli/src/watch';
import { machineBootId, normalizeOrigin, watcherLockPath, watcherScopeId } from '../packages/cli/src/watcher-lock';

const ORIGIN = 'http://relay.example';
const KEY = 'rsw_secret_test_key';
const TASK_ID = '1a2b3c4d-0000-4000-8000-000000000000';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeDriver(id: string, nudged: string[], check: NudgeDriver['check'] = async () => ({ ok: true })): NudgeDriver {
  return {
    id,
    check,
    async nudge(target, notice) {
      nudged.push(`${target}:${notice}`);
      return { ok: true };
    },
  };
}

const wake = { id: 'wake-1', driver: 'fake', target: 'codex', agent_name: 'codex', reason: 'task', task_id: TASK_ID };

describe('replyslip watch resilience', () => {
  it('backs off from the interval, doubles, and caps at 60 seconds', () => {
    expect(backoffDelay(4000, 1)).toBe(4000);
    expect(backoffDelay(4000, 2)).toBe(8000);
    expect(backoffDelay(4000, 3)).toBe(16000);
    expect(backoffDelay(4000, 10)).toBe(MAX_BACKOFF_MS);
    expect(backoffDelay(4000, 1000)).toBe(MAX_BACKOFF_MS);
  });

  it('survives fetch failed, 502, 503, 429, and a timeout, then wakes and resets the backoff', async () => {
    const controller = new AbortController();
    const logs: string[] = [];
    const delays: number[] = [];
    const nudged: string[] = [];
    const acked: unknown[] = [];
    const script: Array<() => Response> = [
      () => {
        throw new TypeError('fetch failed');
      },
      () => new Response('bad gateway', { status: 502 }),
      () => new Response('unavailable', { status: 503 }),
      () => new Response('slow down', { status: 429 }),
      () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      () => json({ wakes: [wake], workspace_id: 'ws-1' }),
      () => new Response('bad gateway', { status: 504 }),
      () => json({ wakes: [], workspace_id: 'ws-1' }),
    ];
    let polls = 0;
    const result = await watch({
      url: ORIGIN,
      key: KEY,
      intervalMs: 4000,
      log: (line) => logs.push(line),
      registry: createRegistry([fakeDriver('fake', nudged)]),
      sleep: async (ms) => {
        delays.push(ms);
      },
      signal: controller.signal,
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/ack')) {
          acked.push(JSON.parse(String(init?.body)));
          return json({ acked: 1 });
        }
        const step = script[polls] ?? (() => json({ wakes: [] }));
        polls += 1;
        if (polls >= script.length) controller.abort();
        return step();
      },
    });

    expect(result).toEqual({});
    expect(polls).toBe(script.length);
    expect(nudged).toEqual([`codex:${WAKE_NOTICE}`]);
    expect(acked).toEqual([{ wake_ids: ['wake-1'] }]);
    expect(delays).toEqual([4000, 8000, 16000, 32000, 60000, 4000, 4000, 4000]);
    const failures = logs.filter((line) => line.includes('poll failed'));
    expect(failures).toEqual([
      '[replyslip] poll failed (fetch failed), retrying in 4s',
      '[replyslip] poll failed (502), retrying in 8s',
      '[replyslip] poll failed (503), retrying in 16s',
      '[replyslip] poll failed (429), retrying in 32s',
      '[replyslip] poll failed (timeout), retrying in 60s',
      '[replyslip] poll failed (504), retrying in 4s',
    ]);
    expect(logs).toContain('[replyslip] woke codex via fake (task 1a2b3c4d)');
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('keeps running when the ack fails, and wakes again on the next lease', async () => {
    const controller = new AbortController();
    const logs: string[] = [];
    const nudged: string[] = [];
    let acks = 0;
    let polls = 0;
    await watch({
      url: ORIGIN,
      key: KEY,
      intervalMs: 500,
      log: (line) => logs.push(line),
      registry: createRegistry([fakeDriver('fake', nudged)]),
      sleep: async () => undefined,
      signal: controller.signal,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/ack')) {
          acks += 1;
          if (acks === 1) return new Response('oops', { status: 500 });
          controller.abort();
          return json({ acked: 1 });
        }
        polls += 1;
        return json({ wakes: [wake] });
      },
    });
    expect(polls).toBe(2);
    expect(nudged).toHaveLength(2);
    expect(logs).toContain('[replyslip] ack failed (500), retrying in 0.5s');
  });

  it('exits non-zero on a rejected key with a clear message, without retrying', async () => {
    for (const status of [401, 403]) {
      const out: string[] = [];
      const err: string[] = [];
      let polls = 0;
      const home = await mkdtemp(path.join(tmpdir(), 'replyslip-auth-'));
      const code = await runReplyslip(['watch', '--url', ORIGIN, '--key', KEY], {
        home,
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
        fetchImpl: async () => {
          polls += 1;
          return json({ error: { code: 'unauthorized', message: 'Watcher key rejected.' } }, status);
        },
      });
      expect(code).toBe(1);
      expect(polls).toBe(1);
      expect(err).toContain(`Watcher key rejected by ${ORIGIN}. Check the key in your dashboard.`);
      expect([...out, ...err].join('\n')).not.toContain(KEY);
    }
  });

  it('with --once, a single failed poll still exits non-zero', async () => {
    const err: string[] = [];
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-once-'));
    const code = await runReplyslip(['watch', '--once', '--url', ORIGIN, '--key', KEY], {
      home,
      stdout: () => undefined,
      stderr: (line) => err.push(line),
      fetchImpl: async () => new Response('bad gateway', { status: 502 }),
    });
    expect(code).toBe(1);
    expect(err.some((line) => line.startsWith('Watcher poll failed (502)'))).toBe(true);
  });

  it('checks a driver only when a wake needs it', async () => {
    const checked: string[] = [];
    const nudged: string[] = [];
    const logs: string[] = [];
    const registry = createRegistry([
      fakeDriver('herdr', nudged, async () => {
        checked.push('herdr');
        return { ok: true, version: '0.8.2' };
      }),
      fakeDriver('orca', nudged, async () => {
        checked.push('orca');
        return { ok: false, message: "Orca isn't running" };
      }),
    ]);
    const controller = new AbortController();
    let polls = 0;
    await watch({
      url: ORIGIN,
      key: KEY,
      intervalMs: 500,
      log: (line) => logs.push(line),
      registry,
      sleep: async () => undefined,
      signal: controller.signal,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/ack')) return json({ acked: 1 });
        polls += 1;
        if (polls === 1) return json({ wakes: [] });
        controller.abort();
        return json({ wakes: [{ ...wake, driver: 'herdr' }] });
      },
    });
    expect(checked).toEqual(['herdr']);
    expect(logs.some((line) => line.includes('orca') || line.includes('Orca'))).toBe(false);
    expect(logs).toContain('[replyslip] woke codex via herdr (task 1a2b3c4d)');
  });

  it('names the workspace in watch --status', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-status-'));
    const origin = normalizeOrigin('https://a.example');
    const file = watcherLockPath(home, watcherScopeId(origin, 'ws-a', KEY));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), hostname: hostname(), bootId: machineBootId(), origin, workspaceId: 'ws-a' })}\n`,
    );
    const out: string[] = [];
    expect(await runReplyslip(['watch', '--status'], { home, stdout: (line) => out.push(line), stderr: () => undefined })).toBe(0);
    expect(out).toEqual([`A ReplySlip watcher is running for workspace ws-a (pid ${process.pid}, origin https://a.example).`]);
  });

  it('exits 1 when the first poll gets a 404 or an HTML page', async () => {
    const responses = [
      () => new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } }),
      () => new Response('<!doctype html><title>Some site</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ];
    for (const respond of responses) {
      const err: string[] = [];
      let polls = 0;
      const home = await mkdtemp(path.join(tmpdir(), 'replyslip-404-'));
      const code = await runReplyslip(['watch', '--url', `${ORIGIN}/`, '--key', KEY], {
        home,
        stdout: () => undefined,
        stderr: (line) => err.push(line),
        fetchImpl: async () => {
          polls += 1;
          return respond();
        },
      });
      expect(code).toBe(1);
      expect(polls).toBe(1);
      expect(err).toEqual([`No ReplySlip server at ${ORIGIN}. Check --url.`]);
    }
  });

  it('keeps retrying a 404 after a good poll', async () => {
    const controller = new AbortController();
    const logs: string[] = [];
    const delays: number[] = [];
    let polls = 0;
    const result = await watch({
      url: ORIGIN,
      key: KEY,
      intervalMs: 1000,
      log: (line) => logs.push(line),
      registry: createRegistry([]),
      sleep: async (ms) => {
        delays.push(ms);
      },
      signal: controller.signal,
      fetchImpl: async () => {
        polls += 1;
        if (polls === 1) return json({ wakes: [], workspace_id: 'ws-1' });
        if (polls === 2) return new Response('not found', { status: 404 });
        if (polls === 3) return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        controller.abort();
        return json({ wakes: [] });
      },
    });
    expect(result).toEqual({});
    expect(polls).toBe(4);
    expect(delays).toEqual([1000, 1000, 2000, 1000]);
    expect(logs).toContain('[replyslip] poll failed (404), retrying in 1s');
    expect(logs).toContain('[replyslip] poll failed (invalid JSON), retrying in 2s');
  });
});
