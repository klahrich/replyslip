// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import type { CommandResult, CommandRunner } from './types.ts';

export const COMMAND_TIMED_OUT = 'command timed out';

export const runCommand: CommandRunner = (command, args) => runCommandWithTimeout(0)(command, args);

/** `timeoutMs` of 0 waits without a bound. A timed-out command returns exit 124 and is killed. */
export function runCommandWithTimeout(timeoutMs: number): CommandRunner {
  return (command, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              killChild(child);
              finish({ code: 124, stdout, stderr: `${stderr}\n${COMMAND_TIMED_OUT}`.trim() });
            }, timeoutMs)
          : null;
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));
    });
}

function killChild(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => undefined);
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone.
  }
}

export function isMissingBinary(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT';
}

export async function capture(run: CommandRunner, command: string, args: string[]): Promise<CommandResult> {
  try {
    return await run(command, args);
  } catch (err) {
    if (isMissingBinary(err)) {
      return { code: 127, stdout: '', stderr: 'ENOENT' };
    }
    throw err;
  }
}
