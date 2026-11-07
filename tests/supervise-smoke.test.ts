import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommandWithTimeout } from '../packages/cli/src/drivers/command';
import { identifyProcess, isReplyslipWatchCommand } from '../packages/cli/src/process-identity';
import { installSupervision, uninstallSupervision } from '../packages/cli/src/supervise';

describe('supervision subprocess smoke', () => {
  it('bounds a hung command and does not treat that process as a replyslip watcher', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
    try {
      const identity = await identifyProcess(child.pid ?? 0);
      expect(identity?.cmdline ?? '').not.toEqual('');
      expect(isReplyslipWatchCommand(identity?.cmdline ?? '')).toBe(false);
      expect(identity?.startedAtMs).toEqual(expect.any(Number));
    } finally {
      child.kill();
      await once(child, 'exit');
    }

    const started = Date.now();
    const result = await runCommandWithTimeout(300)(process.execPath, ['-e', 'setInterval(() => {}, 1e9)']);
    expect(result.code).toBe(124);
    expect(result.stderr).toContain('command timed out');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reports the real systemd user session, and removes a test timer when one can be installed', async () => {
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-systemd-'));
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    const scriptDir = await mkdtemp(path.join(tmpdir(), 'replyslip-systemd-script-'));
    const script = path.join(scriptDir, 'tick.js');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    writeFileSync(script, 'process.exit(0)\n');
    mkdirSync(path.join(home, '.replyslip', 'agents'), { recursive: true });
    writeFileSync(path.join(home, '.replyslip', 'agents', 'Bot.json'), '{"name":"Bot","api_key":"rsk_CANARY_do_not_print"}\n');
    const sup = {
      home,
      platform: 'linux' as const,
      scriptPath: script,
      nodePath: process.execPath,
      env: { PATH: process.env.PATH ?? '/usr/bin' },
      unitName: 'replyslip-supervise-test',
      spawnWatcher: () => ({ pid: process.pid }),
    };
    try {
      const installed = await installSupervision('Bot', sup);
      if (!installed.ok) {
        expect(installed.message).toMatch(/systemd user session|systemctl|not installed|No working/i);
        expect(installed.message).not.toContain('rsk_CANARY_do_not_print');
        return;
      }
      expect(installed.lines.join('\n')).toMatch(/systemd --user/);
      const removed = await uninstallSupervision({ all: true }, sup);
      expect(removed.ok).toBe(true);
    } finally {
      await uninstallSupervision({ all: true }, sup).catch(() => undefined);
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      await rm(home, { recursive: true, force: true });
      await rm(scriptDir, { recursive: true, force: true });
    }
  });
});
