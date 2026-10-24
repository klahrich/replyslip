import { PANE_NAME_PATTERN } from '../../../../lib/constants.ts';
import { capture, runCommand } from './command.ts';
import type { CommandRunner, NudgeDriver } from './types.ts';

/** First Apache-2.0 herdr release. Earlier releases were AGPL. */
export const MIN_HERDR_VERSION = '0.8.0';
export const HERDR_INSTALL_URL = 'https://github.com/herdrdev/herdr';

const MISSING_PANE = /pane_not_found|agent_not_found|agent_pane_not_found|agent target .+ not found|pane .+ not found/i;

export function parseHerdrVersion(text: string): string | null {
  return text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const left = version.split('.').map((part) => Number(part));
  const right = minimum.split('.').map((part) => Number(part));
  for (let i = 0; i < 3; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

export function herdrInstallMessage(detail: string): string {
  return `${detail} Install herdr ${MIN_HERDR_VERSION} or newer (${HERDR_INSTALL_URL}). Herdr is Apache 2.0 since 22 July 2026; earlier releases were AGPL.`;
}

export function herdrArgs(target: string, notice: string): string[] {
  if (!PANE_NAME_PATTERN.test(target)) {
    throw new Error(`Refusing pane name: ${target}`);
  }
  return ['agent', 'prompt', target, notice];
}

export function herdrMissingPane(output: string): boolean {
  return MISSING_PANE.test(output);
}

export function createHerdrDriver(options?: { run?: CommandRunner }): NudgeDriver {
  const run = options?.run ?? runCommand;
  return {
    id: 'herdr',
    async check() {
      const result = await capture(run, 'herdr', ['--version']);
      if (result.stderr === 'ENOENT' || result.code === 127) {
        return { ok: false, message: herdrInstallMessage('herdr is not installed or not on PATH.') };
      }
      const version = parseHerdrVersion(`${result.stdout}\n${result.stderr}`);
      if (result.code !== 0 || !version) {
        return { ok: false, message: herdrInstallMessage('herdr --version did not report a version.') };
      }
      if (!versionAtLeast(version, MIN_HERDR_VERSION)) {
        return {
          ok: false,
          version,
          message: herdrInstallMessage(`herdr ${version} is older than ${MIN_HERDR_VERSION}.`),
        };
      }
      return { ok: true, version };
    },
    async nudge(target, notice) {
      let args: string[];
      try {
        args = herdrArgs(target, notice);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Refusing pane name.' };
      }
      const result = await capture(run, 'herdr', args);
      if (result.code === 0) return { ok: true };
      const output = `${result.stdout}\n${result.stderr}`;
      if (herdrMissingPane(output)) return { ok: false, error: `no pane named ${target}` };
      if (result.stderr === 'ENOENT' || result.code === 127) {
        return { ok: false, error: herdrInstallMessage('herdr is not installed or not on PATH.') };
      }
      return { ok: false, error: `herdr exited ${result.code}` };
    },
  };
}
