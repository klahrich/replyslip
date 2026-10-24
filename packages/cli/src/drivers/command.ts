// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import type { CommandResult, CommandRunner } from './types.ts';

export const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
