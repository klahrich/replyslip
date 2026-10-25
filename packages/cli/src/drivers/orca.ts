// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCb } from 'node:child_process';
import type { NudgeResult } from './types.ts';

/** Override the `orca` binary. The value is the executable path, not a shell line. */
export const ORCA_BIN_ENV = 'REPLYSLIP_ORCA_BIN';

export const ORCA_NOT_RUNNING =
  "Orca isn't running or its CLI isn't enabled (Settings → Experimental → CLI)";

/** `--wait-submit` seconds. The CLI observes the same prompt and does not type it again. */
export const ORCA_WAIT_SUBMIT_SECONDS = '10';

/** Longer than `--wait-submit` so a receipt can come back before execFile kills the process. */
const SEND_TIMEOUT_MS = 20_000;
const QUICK_TIMEOUT_MS = 5_000;

export type OrcaExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** `execFile(file, args)` with `shell: false`. Tests pass a fake. */
export type OrcaExecFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<OrcaExecResult>;

type TerminalRow = { handle: string; title: string };

type Receipt = {
  delivered: boolean;
  unproven: boolean;
  stale: boolean;
  ambiguous: boolean;
  retryRequest: string | null;
  down: boolean;
  error: string;
};

export function orcaBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ORCA_BIN_ENV]?.trim();
  return override || 'orca';
}

export function execFileOrca(file: string, args: readonly string[], timeoutMs: number): Promise<OrcaExecResult> {
  return new Promise((resolve) => {
    execFileCb(
      file,
      [...args],
      { timeout: timeoutMs, shell: false, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = String(stdout ?? '');
        const errText = String(stderr ?? '');
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ code: 127, stdout: out, stderr: 'ENOENT', timedOut: false });
          return;
        }
        if (!err) {
          resolve({ code: 0, stdout: out, stderr: errText, timedOut: false });
          return;
        }
        const timedOut = Boolean((err as { killed?: boolean }).killed);
        const exitCode = (err as { code?: unknown }).code;
        const code = typeof exitCode === 'number' ? exitCode : 1;
        resolve({ code, stdout: out, stderr: errText, timedOut });
      },
    );
  });
}

export function createOrcaDriver(options?: { execFile?: OrcaExecFile; env?: NodeJS.ProcessEnv }) {
  const execFile = options?.execFile ?? execFileOrca;
  const bin = orcaBinary(options?.env);

  async function run(args: readonly string[], timeoutMs: number): Promise<OrcaExecResult> {
    return execFile(bin, args, timeoutMs);
  }

  function listArgs(): readonly string[] {
    return ['terminal', 'list', '--json'];
  }

  function sendArgs(handle: string, notice: string, retryRequest?: string): string[] {
    const args = [
      'terminal',
      'send',
      '--terminal',
      handle,
      '--text',
      notice,
      '--enter',
      '--wait-submit',
      ORCA_WAIT_SUBMIT_SECONDS,
      '--json',
    ];
    if (retryRequest) args.push('--retry-request', retryRequest);
    return args;
  }

  async function listTerminals(): Promise<{ ok: true; terminals: TerminalRow[] } | { ok: false; error: string }> {
    const result = await run(listArgs(), QUICK_TIMEOUT_MS);
    if (isDown(result)) return { ok: false, error: ORCA_NOT_RUNNING };
    if (result.code !== 0 || result.timedOut) {
      return { ok: false, error: `orca terminal list exited ${result.code}` };
    }
    const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
    return { ok: true, terminals: terminalsFrom(payload) };
  }

  async function send(handle: string, notice: string, retryRequest?: string): Promise<OrcaExecResult> {
    return run(sendArgs(handle, notice, retryRequest), SEND_TIMEOUT_MS);
  }

  /**
   * One submit to `handle`. A stale handle re-lists once. An ambiguous failure
   * retries once with `--retry-request` and does not type a second prompt.
   * Unproven receipts return ok so the watcher acks and does not call nudge again.
   */
  async function submit(handle: string, target: string, notice: string, allowRelist: boolean): Promise<NudgeResult> {
    const first = classify(await send(handle, notice));
    if (first.delivered) return { ok: true };
    if (first.stale && allowRelist) return submitReplacement(target, notice, handle);
    if (first.ambiguous && first.retryRequest) {
      const retried = classify(await send(handle, notice, first.retryRequest));
      if (retried.delivered) return { ok: true };
      if (retried.stale && allowRelist) return submitReplacement(target, notice, handle);
      // The prompt may already be in the terminal. Ack so a later poll cannot send --text again.
      if (!retried.down) return { ok: true };
      return { ok: false, error: ORCA_NOT_RUNNING };
    }
    if (first.unproven) return { ok: true };
    if (first.down) return { ok: false, error: ORCA_NOT_RUNNING };
    return { ok: false, error: first.error };
  }

  async function submitReplacement(target: string, notice: string, staleHandle: string): Promise<NudgeResult> {
    const listed = await listTerminals();
    if (!listed.ok) return { ok: false, error: listed.error };
    const matches = matchTitle(listed.terminals, target);
    if (matches.length !== 1 || matches[0].handle === staleHandle) {
      return { ok: false, error: `Orca terminal handle for ${quote(target)} is stale` };
    }
    return submit(matches[0].handle, target, notice, false);
  }

  return {
    id: 'orca',
    async check() {
      const result = await run(['status', '--json'], QUICK_TIMEOUT_MS);
      if (isDown(result) || result.code !== 0 || result.timedOut) {
        return { ok: false, message: ORCA_NOT_RUNNING };
      }
      const payload = parseJson(result.stdout);
      const root = record(payload);
      if (root && root.ok === false) return { ok: false, message: ORCA_NOT_RUNNING };
      const version = typeof root?.version === 'string' ? root.version : undefined;
      return { ok: true, version };
    },
    async nudge(target: string, notice: string): Promise<NudgeResult> {
      const listed = await listTerminals();
      if (!listed.ok) return { ok: false, error: listed.error };
      const matches = matchTitle(listed.terminals, target);
      if (matches.length === 0) return { ok: false, error: `no Orca terminal titled ${quote(target)}` };
      if (matches.length > 1) return { ok: false, error: `more than one Orca terminal titled ${quote(target)}` };
      return submit(matches[0].handle, target, notice, true);
    },
  };
}

function quote(target: string): string {
  return JSON.stringify(target);
}

function matchTitle(terminals: TerminalRow[], target: string): TerminalRow[] {
  const wanted = target.trim();
  return terminals.filter((terminal) => terminal.title === wanted);
}

function isDown(result: OrcaExecResult): boolean {
  return result.stderr === 'ENOENT' || result.code === 127;
}

function classify(result: OrcaExecResult): Receipt {
  const text = `${result.stdout}\n${result.stderr}`;
  const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
  const stages = stagesOf(payload);
  const delivered = stages.includes('turn_started');
  const accepted = stages.includes('input_accepted') || sendAccepted(payload);
  const stale = isStale(payload, text);
  const retryFromFlag = retryFlag(text);
  const retryRequest = retryFromFlag ?? (result.code !== 0 || result.timedOut ? requestIdOf(payload) : null);
  const down = isDown(result);
  const ambiguous =
    !delivered && !stale && !down && Boolean(retryRequest) && (result.timedOut || result.code !== 0 || Boolean(retryFromFlag));
  const unproven =
    !delivered && !stale && !down && !ambiguous && (result.timedOut || (result.code === 0 && accepted));
  const error = errorText(payload, result);
  return { delivered, unproven, stale, ambiguous, retryRequest, down, error };
}

function errorText(payload: unknown, result: OrcaExecResult): string {
  const root = record(payload);
  const error = record(root?.error);
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  if (result.timedOut) return 'orca terminal send timed out';
  return `orca terminal send exited ${result.code}`;
}

function isStale(payload: unknown, text: string): boolean {
  if (text.includes('terminal_handle_stale')) return true;
  const root = record(payload);
  const error = record(root?.error);
  return error?.code === 'terminal_handle_stale';
}

function stagesOf(payload: unknown): string[] {
  const send = sendRecord(payload);
  const prompt = record(send?.prompt);
  const stages = prompt?.stages ?? send?.stages;
  if (!Array.isArray(stages)) return [];
  return stages.filter((stage): stage is string => typeof stage === 'string');
}

function sendAccepted(payload: unknown): boolean {
  return sendRecord(payload)?.accepted === true;
}

function sendRecord(payload: unknown): Record<string, unknown> | null {
  const root = record(payload);
  if (!root) return null;
  return record(root.send) ?? record(record(root.result)?.send);
}

function requestIdOf(payload: unknown): string | null {
  const root = record(payload);
  if (!root) return null;
  const mutation = record(root.mutation) ?? record(record(root.result)?.mutation);
  const id = mutation?.requestId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function retryFlag(text: string): string | null {
  const match = text.match(/--retry-request(?:=|\s+)([^\s'"]+)/);
  return match?.[1] ?? null;
}

function terminalsFrom(payload: unknown): TerminalRow[] {
  const root = record(payload);
  if (!root) return [];
  const result = record(root.result);
  const list = arrayOf(result?.terminals) ?? arrayOf(root.terminals);
  if (!list) return [];
  const found: TerminalRow[] = [];
  for (const item of list) {
    const row = record(item);
    if (!row) continue;
    const handle = typeof row.handle === 'string' ? row.handle.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (handle && title) found.push({ handle, title });
  }
  return found;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
