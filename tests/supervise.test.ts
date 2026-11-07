import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplyslip } from '../packages/cli/src/cli';
import { acquireFileLockSync, releaseFileLock } from '../packages/cli/src/file-lock';
import { killLockAllowed, killSpawnAllowed, linuxStartMs, parseWindowsIdentity } from '../packages/cli/src/process-identity';
import { redactSecrets } from '../packages/cli/src/redact';
import { decideSupervision } from '../packages/cli/src/supervise-decide';
import { buildInstallPlan, windowsCmd } from '../packages/cli/src/supervise-os';
import { appendSuperviseLog, installSupervision, runSupervisionTick, stopSupervision, supervisedEnv, uninstallSupervision, verifyDistributedScript } from '../packages/cli/src/supervise';
import { watch } from '../packages/cli/src/watch';
import { acquireAgentWatcherLock, agentWatcherScopeId, machineBootId, watcherLockPath } from '../packages/cli/src/watcher-lock';
import { emptySuperviseState, enrollAgent, isStopped, readEnrolled, readHold, readProgress, readSuperviseState, writeProgress, writeSuperviseState } from '../packages/cli/src/watcher-progress';

const KEY = 'rsk_CANARY_agent_key_do_not_print';
const ORIGIN = 'https://relay.example';

function helperPid(file: string): number {
  const listed = execFileSync('ps', ['-ww', '-eo', 'pid,args'], { encoding: 'utf8' });
  const line = listed.split('\n').find((row) => row.includes(file));
  if (!line) throw new Error(`lock helper not found for ${file}`);
  return Number(line.trim().split(/\s+/)[0]);
}

function defer() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) };
}

function liveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
}

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'replyslip-supervise-'));
}

function writeKey(home: string, name: string, apiKey = KEY) {
  const dir = path.join(home, '.replyslip', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify({ name, api_key: apiKey, relay_url: ORIGIN })}\n`, { mode: 0o600 });
}

function writeScript(dir: string, body = '#!/usr/bin/env node\nprocess.exit(0)\n') {
  const script = path.join(dir, 'replyslip.mjs');
  writeFileSync(script, body);
  const digest = createHash('sha256').update(body).digest('hex');
  writeFileSync(`${script}.sha256`, `${digest}  replyslip.mjs\n`);
  return script;
}

function writeAgentLock(home: string, name: string, pid: number, token: string, startedAt: string) {
  const file = watcherLockPath(home, 'abcdef0123456789');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      pid,
      startedAt,
      hostname: hostname(),
      bootId: machineBootId(),
      origin: ORIGIN,
      workspaceId: 'ws-1',
      token,
      agentId: 'agent-1',
      agentName: name,
    })}\n`,
  );
  return file;
}

const lock = { pid: 4242, token: 'tokentokentoken', startedAt: '2026-11-07T12:00:00.000Z' };

function progress(deadlineAt: string, phase: 'poll' | 'nudge' | 'ack' | 'sleep' = 'poll') {
  return { ...lock, phase, at: '2026-11-07T12:00:00.000Z', deadlineAt };
}

describe('supervision decisions', () => {
  const now = Date.parse('2026-11-07T12:10:00.000Z');

  it('starts a dead watcher and does not treat a modest timer delay as sleep', () => {
    const dead = decideSupervision({
      now,
      stopped: false,
      hold: null,
      lockLive: false,
      lock: null,
      progress: null,
      spawnAlive: false,
      state: { ...emptySuperviseState(), lastCheckAt: new Date(now - 150_000).toISOString() },
    });
    expect(dead.decision).toEqual({ action: 'start', reason: 'missing' });

    const lateWedge = decideSupervision({
      now,
      stopped: false,
      hold: null,
      lockLive: true,
      lock,
      progress: progress(new Date(now - 120_000).toISOString(), 'nudge'),
      spawnAlive: true,
      state: { ...emptySuperviseState(), lastCheckAt: new Date(now - 150_000).toISOString() },
    });
    expect(lateWedge.decision.action).toBe('kill-lock');
    if (lateWedge.decision.action === 'kill-lock') expect(lateWedge.decision.reason).toBe('wedge');
  });

  it('keeps a network backoff that still has deadline, and defers a kill only across a long gap', () => {
    const backoff = decideSupervision({
      now,
      stopped: false,
      hold: null,
      lockLive: true,
      lock,
      progress: progress(new Date(now + 10_000).toISOString(), 'sleep'),
      spawnAlive: true,
      state: { ...emptySuperviseState(), lastCheckAt: new Date(now - 120_000).toISOString() },
    });
    expect(backoff.decision).toMatchObject({ action: 'skip', reason: 'healthy' });

    const slept = decideSupervision({
      now,
      stopped: false,
      hold: null,
      lockLive: true,
      lock,
      progress: progress(new Date(now - 120_000).toISOString(), 'nudge'),
      spawnAlive: true,
      state: { ...emptySuperviseState(), lastCheckAt: new Date(now - 11 * 60_000).toISOString() },
    });
    expect(slept.decision).toMatchObject({ action: 'skip', reason: 'defer-wedge' });
  });

  it('caps restarts, then allows one after the window, and keeps a deliberate stop', () => {
    const restarts = Array.from({ length: 5 }, (_, index) => new Date(now - index * 60_000).toISOString());
    const capped = decideSupervision({
      now,
      stopped: false,
      hold: null,
      lockLive: false,
      lock: null,
      progress: null,
      spawnAlive: false,
      state: { ...emptySuperviseState(), restarts },
    });
    expect(capped.decision).toMatchObject({ action: 'skip', reason: 'restart-cap' });

    const later = decideSupervision({
      now: now + 2 * 60 * 60 * 1000,
      stopped: false,
      hold: null,
      lockLive: false,
      lock: null,
      progress: null,
      spawnAlive: false,
      state: { ...emptySuperviseState(), restarts },
    });
    expect(later.decision).toMatchObject({ action: 'start', reason: 'missing' });

    const stopped = decideSupervision({
      now,
      stopped: true,
      hold: null,
      lockLive: false,
      lock: null,
      progress: null,
      spawnAlive: false,
      state: emptySuperviseState(),
    });
    expect(stopped.decision).toMatchObject({ action: 'skip', reason: 'stopped' });
  });

  it('does not kill a reused pid or an unrelated command', () => {
    const identity = { cmdline: 'node /tmp/replyslip.mjs watch --name Bot', startedAtMs: Date.parse(lock.startedAt) + 120_000 };
    expect(killLockAllowed({ lock, expected: lock, identity })).toMatchObject({ ok: false, reason: 'pid-reused' });
    expect(
      killLockAllowed({
        lock,
        expected: lock,
        identity: { cmdline: 'node -e setInterval', startedAtMs: Date.parse(lock.startedAt) - 1000 },
      }),
    ).toMatchObject({ ok: false, reason: 'not-watcher' });
    expect(
      killLockAllowed({
        lock: { ...lock, token: 'other' },
        expected: lock,
        identity: { cmdline: identity.cmdline, startedAtMs: Date.parse(lock.startedAt) - 1000 },
      }),
    ).toMatchObject({ ok: false, reason: 'lock-changed' });
    expect(killSpawnAllowed({ identity: { cmdline: identity.cmdline, startedAtMs: null }, spawnedAt: lock.startedAt })).toMatchObject({
      ok: false,
      reason: 'unverified-process',
    });
    expect(killLockAllowed({ lock, expected: lock, identity: { cmdline: identity.cmdline, startedAtMs: Date.parse(lock.startedAt) - 1000 } })).toEqual({ ok: true });
  });

  it('parses a linux start time and a windows creation date', () => {
    const stat = '4242 (node) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
    expect(linuxStartMs(stat, 1_700_000_000)).toBe(1_700_000_000 * 1000 + 10_000);
    const created = parseWindowsIdentity('{"CommandLine":"node C:\\\\replyslip.mjs watch --name Bot","CreationDate":"/Date(1700000000000)/"}');
    expect(created?.startedAtMs).toBe(1_700_000_000_000);
    expect(created?.cmdline).toContain('watch');
    const west = parseWindowsIdentity('{"CommandLine":"node replyslip.mjs watch --name Bot","CreationDate":"20261107100000.000000-480"}');
    expect(west?.startedAtMs).toBe(Date.UTC(2026, 10, 7, 18, 0, 0, 0));
    const east = parseWindowsIdentity('{"CommandLine":"node replyslip.mjs watch --name Bot","CreationDate":"20261107100000.000000+120"}');
    expect(east?.startedAtMs).toBe(Date.UTC(2026, 10, 7, 8, 0, 0, 0));
    const zulu = parseWindowsIdentity('{"CommandLine":"node replyslip.mjs watch --name Bot","CreationDate":"20261107100000.000000+000"}');
    expect(zulu?.startedAtMs).toBe(Date.UTC(2026, 10, 7, 10, 0, 0, 0));
    expect(parseWindowsIdentity('{"CommandLine":"node replyslip.mjs watch --name Bot","CreationDate":"20261107100000.000000"}')).toBeNull();
    expect(parseWindowsIdentity('{"CommandLine":"node replyslip.mjs watch --name Bot","CreationDate":"20261307100000.000000+000"}')).toBeNull();
    expect(parseWindowsIdentity('{"CommandLine":"node replyslip.mjs watch --name Bot","CreationDate":"20261107100000.000000-48"}')).toBeNull();
  });
});

describe('supervision install and tick', () => {
  function fakeRun(code = 0) {
    const calls: string[][] = [];
    return {
      calls,
      run: async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        return { code, stdout: '', stderr: code === 0 ? '' : 'systemctl: Failed to connect to bus' };
      },
    };
  }

  it('refuses an unsupported OS, a bad checksum, and a systemd session that is not there', async () => {
    const home = await tempHome();
    const script = writeScript(home);
    const unsupported = buildInstallPlan({
      platform: 'freebsd',
      home,
      nodePath: process.execPath,
      scriptPath: script,
      pathEnv: '/usr/bin',
    });
    expect(unsupported).toMatchObject({ error: expect.stringContaining('no timer') });

    writeFileSync(`${script}.sha256`, `${'ab'.repeat(32)}  replyslip.mjs\n`);
    expect(verifyDistributedScript(script).ok).toBe(false);

    writeScript(home);
    writeKey(home, 'Bot');
    const runner = fakeRun(1);
    const failed = await installSupervision('Bot', {
      home,
      platform: 'linux',
      scriptPath: script,
      nodePath: process.execPath,
      env: { PATH: '/usr/bin', REPLYSLIP_WATCHER_KEY: KEY },
      run: runner.run,
      spawnWatcher: () => {
        throw new Error('should not start');
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.message).toMatch(/systemd user session|not installed/i);
      expect(failed.message).not.toContain(KEY);
    }
    expect(runner.calls.some((call) => call[0] === 'systemctl')).toBe(true);
  });

  it('installs one linux timer for two agents, restarts neither when stopped, and reinstall clears the stop', async () => {
    const home = await tempHome();
    const script = writeScript(home);
    writeKey(home, 'Alpha');
    writeKey(home, 'Beta');
    const calls: string[][] = [];
    const spawned: string[] = [];
    let pid = 50;
    const sup = {
      home,
      platform: 'linux' as const,
      scriptPath: script,
      nodePath: '/usr/bin/node',
      env: { PATH: '/usr/bin:/bin', REPLYSLIP_ORCA_BIN: '/opt/orca', REPLYSLIP_WATCHER_KEY: KEY },
      run: async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        return { code: 0, stdout: '', stderr: '' };
      },
      spawnWatcher: (request: { name: string; scriptPath: string }) => {
        spawned.push(`${request.name} ${request.scriptPath}`);
        pid += 1;
        return { pid };
      },
      alive: () => true,
      identify: async () => ({ cmdline: 'node /usr/bin/replyslip.mjs watch --name Bot', startedAtMs: Date.now() - 1000 }),
      kill: () => {
        throw new Error('kill');
      },
    };
    const io = capture();
    expect(await runReplyslip(['supervise', '--install', '--name', 'Alpha'], { ...io, home, env: sup.env, supervise: sup })).toBe(0);
    expect(await runReplyslip(['supervise', '--install', '--name', 'Beta'], { ...io, home, env: sup.env, supervise: sup })).toBe(0);
    expect(spawned).toEqual([`Alpha ${script}`, `Beta ${script}`]);
    const unitDir = path.join(home, '.config', 'systemd', 'user');
    const unit = readFileSync(path.join(unitDir, 'replyslip-supervise.service'), 'utf8');
    const timer = readFileSync(path.join(unitDir, 'replyslip-supervise.timer'), 'utf8');
    expect(unit).toContain('supervise --once');
    expect(timer).toContain('OnUnitActiveSec=120s');
    expect(unit).toContain('/usr/bin/node');
    expect(unit).toContain('REPLYSLIP_ORCA_BIN="/opt/orca"');
    expect(unit).not.toContain(KEY);
    expect(unit).not.toContain('Linger');
    expect(calls.filter((call) => call[0] === 'systemctl' && call.includes('enable')).length).toBe(2);

    const tick = capture();
    expect(await runReplyslip(['supervise', '--once'], { ...tick, home, env: sup.env, supervise: { ...sup, now: () => Date.now() } })).toBe(0);
    expect(tick.out.join('\n')).toMatch(/Alpha: starting/);
    expect(tick.out.join('\n')).toMatch(/Beta: starting/);

    const stopped = capture();
    expect(await runReplyslip(['supervise', '--stop', '--name', 'Alpha'], { ...stopped, home, env: sup.env, supervise: sup })).toBe(0);
    expect(isStopped(home, 'Alpha')).toBe(true);
    expect(isStopped(home, 'Beta')).toBe(false);
    const after = capture();
    expect(await runReplyslip(['supervise', '--once'], { ...after, home, env: sup.env, supervise: sup })).toBe(0);
    expect(after.out.join('\n')).toMatch(/Alpha: stopped/);
    expect(after.out.join('\n')).toMatch(/Beta: starting/);

    const again = capture();
    expect(await runReplyslip(['supervise', '--install', '--name', 'Alpha'], { ...again, home, env: sup.env, supervise: sup })).toBe(0);
    expect(isStopped(home, 'Alpha')).toBe(false);
    expect(again.out.join('\n')).toMatch(/Watcher started for Alpha/);
  });

  it('replaces a watcher after a reused spawn pid and does not signal or duplicate it', async () => {
    const home = await tempHome();
    writeKey(home, 'Bot');
    enrollAgent(home, 'Bot');
    const origin = Date.parse('2026-11-07T12:00:00.000Z');
    writeSuperviseState(home, 'Bot', {
      ...emptySuperviseState(),
      lastSpawnPid: 4242,
      lastSpawnAt: new Date(origin - 130_000).toISOString(),
      lastCheckAt: new Date(origin - 130_000).toISOString(),
    });
    const kills: number[] = [];
    const spawned: number[] = [];
    let nextPid = 9000;
    let now = origin;
    const sup = {
      home,
      platform: 'linux' as const,
      scriptPath: '/tmp/replyslip-tick.js',
      nodePath: '/usr/bin/node',
      env: { PATH: '/usr/bin' },
      now: () => now,
      alive: (pid: number) => pid === 4242 || spawned.includes(pid),
      identify: async (pid: number) => {
        if (pid === 4242) return { cmdline: 'node /tmp/replyslip.mjs watch --name Other', startedAtMs: origin };
        const spawnedAt = Date.parse(readSuperviseState(home, 'Bot').lastSpawnAt ?? '');
        return { cmdline: 'node /tmp/replyslip.mjs watch --name Bot', startedAtMs: spawnedAt - 1000 };
      },
      kill: (pid: number) => {
        kills.push(pid);
      },
      spawnWatcher: () => {
        nextPid += 1;
        spawned.push(nextPid);
        return { pid: nextPid };
      },
    };
    const first = await runSupervisionTick(sup);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lines.join('\n')).toMatch(/started pid 9001 without signalling 4242/);
    expect(kills).toEqual([]);
    expect(spawned).toEqual([9001]);

    now = origin + 30_000;
    const duringGrace = await runSupervisionTick(sup);
    expect(duringGrace.ok).toBe(true);
    if (!duringGrace.ok) return;
    expect(duringGrace.lines.join('\n')).toMatch(/starting/);
    expect(spawned).toEqual([9001]);
    expect(kills).toEqual([]);

    now = origin + 130_000;
    const later = await runSupervisionTick(sup);
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.lines.join('\n')).not.toMatch(/left in place/);
    expect(kills).toEqual([9001]);
    expect(spawned).toEqual([9001, 9002]);
    expect(kills).not.toContain(4242);
    expect(readSuperviseState(home, 'Bot').lastSpawnPid).toBe(9002);

    now += 10_000;
    const noDuplicate = await runSupervisionTick(sup);
    expect(noDuplicate.ok).toBe(true);
    if (!noDuplicate.ok) return;
    expect(noDuplicate.lines.join('\n')).toMatch(/starting/);
    expect(spawned).toEqual([9001, 9002]);
    expect(kills).toEqual([9001]);
  });

  it('does not spawn, signal, or write state when the lock helper dies during identify', async () => {
    const home = await tempHome();
    writeKey(home, 'Bot');
    enrollAgent(home, 'Bot');
    const origin = Date.parse('2026-11-07T12:00:00.000Z');
    writeSuperviseState(home, 'Bot', {
      ...emptySuperviseState(),
      lastSpawnPid: 4242,
      lastSpawnAt: new Date(origin - 130_000).toISOString(),
      lastCheckAt: new Date(origin - 130_000).toISOString(),
    });
    const kills: number[] = [];
    const spawned: number[] = [];
    const identifyEntered = defer();
    const identifyUnblocked = defer();
    let block = true;
    const sup = {
      home,
      platform: 'linux' as const,
      scriptPath: '/tmp/replyslip-tick.js',
      nodePath: '/usr/bin/node',
      env: { PATH: '/usr/bin' },
      now: () => origin,
      alive: (pid: number) => pid === 4242 || spawned.includes(pid),
      identify: async (pid: number) => {
        if (block && pid === 4242) {
          identifyEntered.resolve();
          await identifyUnblocked.promise;
          block = false;
          return { cmdline: 'node /tmp/replyslip.mjs watch --name Other', startedAtMs: origin };
        }
        if (pid === 4242) return { cmdline: 'node /tmp/replyslip.mjs watch --name Other', startedAtMs: origin };
        return { cmdline: 'node /tmp/replyslip.mjs watch --name Bot', startedAtMs: origin - 1000 };
      },
      kill: (pid: number) => {
        kills.push(pid);
      },
      spawnWatcher: () => {
        spawned.push(9001);
        return { pid: 9001 };
      },
    };
    const op = path.join(home, '.replyslip', 'supervise', 'Bot.op');
    const tick = runSupervisionTick(sup);
    await identifyEntered.promise;
    const snapshot = JSON.parse(JSON.stringify(readSuperviseState(home, 'Bot')));
    process.kill(helperPid(op), 'SIGKILL');
    const contender = acquireFileLockSync(op, { waitMs: 2_000 });
    identifyUnblocked.resolve();
    const first = await tick;
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lines.join('\n')).toMatch(/no longer held/);
    expect(spawned).toEqual([]);
    expect(kills).toEqual([]);
    expect(JSON.parse(JSON.stringify(readSuperviseState(home, 'Bot')))).toEqual(snapshot);
    releaseFileLock(contender);
    const second = await runSupervisionTick(sup);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.lines.join('\n')).toMatch(/started pid 9001 without signalling 4242/);
    expect(spawned).toEqual([9001]);
    expect(kills).toEqual([]);
  });

  it('does not signal when the helper dies during reap, and a later stop still can', async () => {
    const home = await tempHome();
    writeKey(home, 'Bot');
    enrollAgent(home, 'Bot');
    const origin = Date.parse('2026-11-07T12:00:00.000Z');
    writeSuperviseState(home, 'Bot', { ...emptySuperviseState(), lastSpawnPid: 4242, lastSpawnAt: new Date(origin).toISOString() });
    const kills: number[] = [];
    const identifyEntered = defer();
    const identifyUnblocked = defer();
    let block = true;
    const identify = async (pid: number) => {
      if (block && pid === 4242) {
        identifyEntered.resolve();
        await identifyUnblocked.promise;
        block = false;
      }
      return { cmdline: 'node /tmp/replyslip.mjs watch --name Bot', startedAtMs: origin - 1000 };
    };
    const op = path.join(home, '.replyslip', 'supervise', 'Bot.op');
    const stopping = stopSupervision('Bot', {
      home,
      platform: 'linux',
      alive: (pid) => pid === 4242,
      identify,
      kill: (pid) => {
        kills.push(pid);
      },
    });
    await identifyEntered.promise;
    const snapshot = JSON.parse(JSON.stringify(readSuperviseState(home, 'Bot')));
    const stopped = isStopped(home, 'Bot');
    process.kill(helperPid(op), 'SIGKILL');
    const contender = acquireFileLockSync(op, { waitMs: 2_000 });
    identifyUnblocked.resolve();
    const first = await stopping;
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.message).toMatch(/no longer held/);
    expect(kills).toEqual([]);
    expect(JSON.parse(JSON.stringify(readSuperviseState(home, 'Bot')))).toEqual(snapshot);
    expect(isStopped(home, 'Bot')).toBe(stopped);
    releaseFileLock(contender);
    const second = await stopSupervision('Bot', {
      home,
      platform: 'linux',
      alive: (pid) => pid === 4242,
      identify,
      kill: (pid) => {
        kills.push(pid);
      },
    });
    expect(second.ok).toBe(true);
    expect(kills).toEqual([4242]);
  });

  it('stop during recovery reaps the replacement and does not leave it running', async () => {
    const home = await tempHome();
    writeKey(home, 'Bot');
    enrollAgent(home, 'Bot');
    const origin = Date.parse('2026-11-07T12:00:00.000Z');
    writeSuperviseState(home, 'Bot', {
      ...emptySuperviseState(),
      lastSpawnPid: 4242,
      lastSpawnAt: new Date(origin - 130_000).toISOString(),
      lastCheckAt: new Date(origin - 130_000).toISOString(),
    });
    const kills: number[] = [];
    const dead = new Set<number>();
    const spawned: number[] = [];
    const identifyEntered = defer();
    const identifyUnblocked = defer();
    const identityFor = async (pid: number, gate: boolean) => {
      if (gate && pid === 4242) {
        identifyEntered.resolve();
        await identifyUnblocked.promise;
      }
      if (pid === 4242) return { cmdline: 'node /tmp/replyslip.mjs watch --name Other', startedAtMs: origin };
      return { cmdline: 'node /tmp/replyslip.mjs watch --name Bot', startedAtMs: origin - 500 };
    };
    const sup = {
      home,
      platform: 'linux' as const,
      scriptPath: '/tmp/replyslip-tick.js',
      nodePath: '/usr/bin/node',
      env: { PATH: '/usr/bin' },
      now: () => origin,
      alive: (pid: number) => (pid === 4242 || spawned.includes(pid)) && !dead.has(pid),
      identify: (pid: number) => identityFor(pid, false),
      kill: (pid: number) => {
        kills.push(pid);
        dead.add(pid);
      },
      spawnWatcher: () => {
        const pid = 9001;
        spawned.push(pid);
        return { pid };
      },
    };
    const tick = runSupervisionTick({ ...sup, identify: (pid: number) => identityFor(pid, true) });
    await identifyEntered.promise;
    const stop = stopSupervision('Bot', sup);
    identifyUnblocked.resolve();
    const tickResult = await tick;
    const stopResult = await stop;
    expect(tickResult.ok).toBe(true);
    expect(stopResult.ok).toBe(true);
    expect(kills).toEqual([9001]);
    expect(kills).not.toContain(4242);
    const again = await runSupervisionTick(sup);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.lines.join('\n')).toMatch(/stopped/);
    expect(spawned).toEqual([9001]);
    expect(isStopped(home, 'Bot')).toBe(true);
  });

  it('install loses to an in-flight uninstall, and a foreign lock is not replaced or deleted', async () => {
    const home = await tempHome();
    const script = writeScript(home);
    writeKey(home, 'Bot');
    const preflightEntered = defer();
    const preflightUnblocked = defer();
    let sawPreflight = false;
    const spawned: string[] = [];
    const installing = installSupervision('Bot', {
      home,
      platform: 'linux',
      scriptPath: script,
      nodePath: '/usr/bin/node',
      env: { PATH: '/usr/bin' },
      run: async () => {
        if (!sawPreflight) {
          sawPreflight = true;
          preflightEntered.resolve();
          await preflightUnblocked.promise;
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      spawnWatcher: () => {
        spawned.push('spawned');
        return { pid: 50 };
      },
    });
    await preflightEntered.promise;
    const removed = await uninstallSupervision({ name: 'Bot' }, { home, platform: 'linux', env: { PATH: '/usr/bin' }, run: async () => ({ code: 0, stdout: '', stderr: '' }) });
    preflightUnblocked.resolve();
    const installed = await installing;
    expect(removed.ok).toBe(true);
    expect(installed.ok).toBe(false);
    if (!installed.ok) expect(installed.message).toMatch(/Stop for Bot won/);
    expect(spawned).toEqual([]);
    expect(isStopped(home, 'Bot')).toBe(true);

    const child = liveChild();
    const kills: number[] = [];
    try {
      writeKey(home, 'Held');
      const startedAt = new Date().toISOString();
      const token = 'abcabcabcabcabca';
      const lockFile = writeAgentLock(home, 'Held', child.pid ?? 0, token, startedAt);
      const blocked = await installSupervision('Held', {
        home,
        platform: 'linux',
        scriptPath: script,
        nodePath: '/usr/bin/node',
        env: { PATH: '/usr/bin' },
        run: async () => ({ code: 0, stdout: '', stderr: '' }),
        identify: async () => ({ cmdline: `${process.execPath} -e setInterval`, startedAtMs: Date.now() - 1000 }),
        alive: () => true,
        kill: (pid: number) => {
          kills.push(pid);
        },
        spawnWatcher: () => {
          throw new Error('must not spawn');
        },
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.message).toMatch(/not replaced/);
      expect(kills).toEqual([]);
      expect(readFileSync(lockFile, 'utf8')).toContain(token);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('uninstall reaps the watcher an in-flight install just spawned', async () => {
    const home = await tempHome();
    const script = writeScript(home);
    writeKey(home, 'Bot');
    const entered = defer();
    const unblock = defer();
    const kills: number[] = [];
    const dead = new Set<number>();
    const shared = {
      home,
      platform: 'linux' as const,
      scriptPath: script,
      nodePath: '/usr/bin/node',
      env: { PATH: '/usr/bin' },
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      alive: (pid: number) => pid === 777 && !dead.has(pid),
      identify: async () => ({ cmdline: 'node /tmp/replyslip.mjs watch --name Bot', startedAtMs: Date.now() - 100 }),
      kill: (pid: number) => {
        kills.push(pid);
        dead.add(pid);
      },
      spawnWatcher: () => ({ pid: 777 }),
      beforeSpawn: async () => {
        entered.resolve();
        await unblock.promise;
      },
    };
    const installing = installSupervision('Bot', shared);
    await entered.promise;
    const removing = uninstallSupervision({ name: 'Bot' }, shared);
    unblock.resolve();
    const installed = await installing;
    const removed = await removing;
    expect(installed.ok).toBe(true);
    expect(removed.ok).toBe(true);
    expect(kills).toEqual([777]);
    expect(isStopped(home, 'Bot')).toBe(true);
    expect(readEnrolled(home)).not.toContain('Bot');
    const again = await runSupervisionTick(shared);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.lines.join('\n')).toMatch(/No enrolled/);
  });

  it('reclaim fails closed when the lock changes at acquisition', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'replyslip-reclaim-'));
    const startedAt = '2026-11-07T12:00:00.000Z';
    const token = 'aaaaaaaaaaaaaaaa';
    const file = watcherLockPath(home, agentWatcherScopeId('agent-1'));
    mkdirSync(path.dirname(file), { recursive: true });
    const body = (nextPid: number, nextToken: string) =>
      `${JSON.stringify({
        pid: nextPid,
        startedAt,
        hostname: hostname(),
        bootId: machineBootId(),
        origin: ORIGIN,
        workspaceId: 'ws-1',
        token: nextToken,
        agentId: 'agent-1',
        agentName: 'Bot',
      })}\n`;
    writeFileSync(file, body(10, token));
    const result = acquireAgentWatcherLock({
      home,
      origin: ORIGIN,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      agentName: 'Bot',
      isAlive: () => true,
      reclaim: { pid: 10, token, startedAt },
      onBeforeTakeover: () => {
        writeFileSync(file, body(11, 'bbbbbbbbbbbbbbbb'));
      },
    });
    expect(result.ok).toBe(false);
    const kept = readFileSync(file, 'utf8');
    expect(kept).toContain('"pid":11');
    expect(kept).toContain('bbbbbbbbbbbbbbbb');
    expect(kept).not.toContain(`"pid":${process.pid}`);
  });

  it('does not signal an unrelated pid when stopping', async () => {
    const home = await tempHome();
    const child = liveChild();
    const kills: number[] = [];
    try {
      writeAgentLock(home, 'Bot', child.pid ?? 0, 'abcabcabcabcabca', new Date().toISOString());
      const result = await stopSupervision('Bot', {
        home,
        identify: async () => ({ cmdline: `${process.execPath} -e setInterval`, startedAtMs: Date.now() - 1000 }),
        kill: (pid) => {
          kills.push(pid);
        },
        alive: () => true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/not-watcher/);
      expect(kills).toEqual([]);
      expect(isStopped(home, 'Bot')).toBe(true);
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });

  it('records an auth hold without a deliberate stop, and a failed poll extends the sleep deadline', async () => {
    const home = await tempHome();
    writeKey(home, 'Bot');
    const io = capture();
    const fetchImpl: typeof fetch = async () => new Response('no', { status: 401 });
    expect(await runReplyslip(['watch', '--once', '--name', 'Bot'], { ...io, home, env: {}, fetchImpl })).toBe(1);
    expect(readHold(home, 'Bot')).toBe('auth');
    expect(isStopped(home, 'Bot')).toBe(false);
    expect(io.err.join('\n')).not.toContain(KEY);

    const notes: Array<[string, number]> = [];
    let fetches = 0;
    const controller = new AbortController();
    await watch({
      url: ORIGIN,
      key: KEY,
      intervalMs: 3000,
      agent: { name: 'Bot' },
      lock: { home },
      log: () => undefined,
      signal: controller.signal,
      sleep: async () => controller.abort(),
      fetchImpl: async () => {
        fetches += 1;
        if (fetches === 1) {
          return Response.json({ wakes: [], workspace_id: 'ws-1', agent_id: 'agent-1', agent_name: 'Bot' });
        }
        throw new Error('ECONNRESET');
      },
      progress: {
        attach(identity) {
          writeProgress(home, 'Bot', {
            ...identity,
            phase: 'poll',
            at: new Date().toISOString(),
            deadlineAt: new Date(Date.now() + 30_000).toISOString(),
          });
        },
        note(phase, budgetMs) {
          notes.push([phase, budgetMs]);
          const current = readProgress(home, 'Bot');
          if (!current) return;
          writeProgress(home, 'Bot', {
            ...current,
            phase,
            at: new Date().toISOString(),
            deadlineAt: new Date(Date.now() + budgetMs).toISOString(),
          });
        },
      },
    });
    expect(notes).toContainEqual(['sleep', 3000]);
    const filed = readProgress(home, 'Bot');
    expect(filed?.phase).toBe('sleep');
    expect(Date.parse(filed?.deadlineAt ?? '')).toBeGreaterThan(Date.now() - 1000);
  });

  it('redacts keys from the supervisor log and keeps them out of scheduler text', async () => {
    expect(redactSecrets(`authorization: Bearer ${KEY} {"api_key":"${KEY}"}`)).not.toContain(KEY);
    const home = '/tmp/replyslip-home';
    const plan = buildInstallPlan({
      platform: 'win32',
      home,
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\Users\\Ada\\.replyslip\\replyslip.mjs',
      pathEnv: 'C:\\Program Files\\nodejs;C:\\Windows\\System32',
      uid: undefined,
    });
    expect('files' in plan).toBe(true);
    if (!('files' in plan)) return;
    const cmd = plan.files[0]?.contents ?? '';
    expect(cmd).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(cmd).toContain('supervise --once');
    const percent = windowsCmd({
      platform: 'win32',
      home: 'C:\\Users\\Ada%PATH%',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\Users\\Ada%PATH%\\.replyslip\\replyslip.mjs',
      pathEnv: 'C:\\Windows\\System32',
      orcaBin: 'C:\\orca%PATH%\\orca.exe',
    });
    expect(percent).toContain('set "HOME=C:\\Users\\Ada%%PATH%%"');
    expect(percent).toContain('set "USERPROFILE=C:\\Users\\Ada%%PATH%%"');
    expect(percent).toContain('set "REPLYSLIP_ORCA_BIN=C:\\orca%%PATH%%\\orca.exe"');
    expect(percent).toContain('"C:\\Users\\Ada%%PATH%%\\.replyslip\\replyslip.mjs"');
    expect(percent).not.toMatch(/(?<!%)%PATH%/);
    expect(plan.commands[0]?.args).toEqual(expect.arrayContaining(['/IT', '/RL', 'LIMITED', '/MO', '2']));
    expect(plan.commands[0]?.args.join(' ')).not.toContain('Program Files\\nodejs\\node.exe" "');
    expect(JSON.stringify(plan)).not.toContain(KEY);

    const darwin = buildInstallPlan({
      platform: 'darwin',
      home,
      uid: 501,
      nodePath: '/opt/homebrew/bin/node',
      scriptPath: '/Users/ada/.replyslip/replyslip.mjs',
      pathEnv: '/opt/homebrew/bin:/usr/bin',
    });
    if (!('files' in darwin)) throw new Error('darwin plan');
    expect(darwin.files[0]?.contents).toContain('<key>StartInterval</key>');
    expect(darwin.files[0]?.contents).not.toContain('KeepAlive');
    expect(darwin.files[0]?.contents).toContain('<integer>120</integer>');

    const logHome = await tempHome();
    appendSuperviseLog(logHome, `bearer ${KEY}`);
    expect(readFileSync(path.join(logHome, '.replyslip', 'supervise', 'supervise.log'), 'utf8')).not.toContain(KEY);

    const env = supervisedEnv(
      { nodePath: '/usr/bin/node', scriptPath: '/s', name: 'Bot', home: '/home/ada', pathEnv: '/usr/bin', orcaBin: '/opt/orca' },
      { REPLYSLIP_WATCHER_KEY: KEY, PATH: '/evil', LANG: 'C' },
    );
    expect(env.REPLYSLIP_WATCHER_KEY).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.REPLYSLIP_ORCA_BIN).toBe('/opt/orca');
    expect(JSON.stringify(env)).not.toContain(KEY);
  });
});
