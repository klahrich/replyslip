import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runReplyslip } from '../packages/cli/src/cli';
import { replyslipScriptPath } from '@/lib/replyslip-script';

const execFileAsync = promisify(execFile);

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) };
}

describe('replyslip --help and --version', () => {
  it('prints help on stdout and exits 0, including after a subcommand, without starting watch', async () => {
    for (const argv of [['--help'], ['-h'], ['help'], ['watch', '--help'], ['register', '--help']]) {
      const io = capture();
      const fetchImpl: typeof fetch = async () => {
        throw new Error('help must not touch the network');
      };
      expect(await runReplyslip(argv, { ...io, fetchImpl, env: {} })).toBe(0);
      expect(io.out.join('\n')).toContain('Usage:');
      expect(io.out.join('\n')).toContain('replyslip watch');
      expect(io.out.join('\n')).toContain('https://replyslip.com/skill.md');
      expect(io.err).toEqual([]);
    }
  });

  it('bundle reports the packages/cli version', async () => {
    const { version } = JSON.parse(readFileSync('packages/cli/package.json', 'utf8')) as { version: string };
    const ok = await execFileAsync(process.execPath, [replyslipScriptPath(), '--version'], { encoding: 'utf8' });
    expect(ok.stdout.trim()).toBe(version);
  });
});
