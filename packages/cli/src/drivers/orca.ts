// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCb } from 'node:child_process';
import type { NudgeResult } from './types.ts';

/** Override the `orca` binary. The value is the executable path, not a shell line. */
export const ORCA_BIN_ENV = 'REPLYSLIP_ORCA_BIN';

export const ORCA_NOT_RUNNING =
  "Orca isn't running or its CLI isn't enabled (Settings → Experimental → CLI)";

/**
 * First release whose `terminal send` accepts `--wait-submit` and reports `turn_started`.
 * Confirmed from the v1.4.198…v1.4.199 range: commit 06a607a1d7 added the flag, and the
 * v1.4.199 skill guide is the first tag that documents it. Older hosts refuse the flag
 * before sending input.
 */
export const MIN_ORCA_VERSION = '1.4.199';

/** `--wait-submit` seconds. The CLI observes the same prompt and does not type it again. */
export const ORCA_WAIT_SUBMIT_SECONDS = '10';

export const ORCA_OLD_HOST_WARNING =
  `[replyslip] orca: this host refused --wait-submit (old-host). Fell back to a plain send and treated input_accepted as delivered. Orca ${MIN_ORCA_VERSION} or newer is the recommended minimum.`;

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

export function createOrcaDriver(options?: {
  execFile?: OrcaExecFile;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}) {
  const execFile = options?.execFile ?? execFileOrca;
  const bin = orcaBinary(options?.env);
  const log = options?.log ?? console.error;

  async function run(args: readonly string[], timeoutMs: number): Promise<OrcaExecResult> {
    return execFile(bin, args, timeoutMs);
  }

  function listArgs(): readonly string[] {
    return ['terminal', 'list', '--json'];
  }

  function sendArgs(handle: string, notice: string, retryRequest?: string, waitSubmit = true): string[] {
    const args = ['terminal', 'send', '--terminal', handle, '--text', notice, '--enter'];
    if (waitSubmit) args.push('--wait-submit', ORCA_WAIT_SUBMIT_SECONDS);
    args.push('--json');
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

  async function send(handle: string, notice: string, retryRequest?: string, waitSubmit = true): Promise<OrcaExecResult> {
    return run(sendArgs(handle, notice, retryRequest, waitSubmit), waitSubmit ? SEND_TIMEOUT_MS : QUICK_TIMEOUT_MS);
  }

  /** The plain send already happened. `input_accepted` counts as delivered only on this path. */
  async function finishLegacy(
    plain: OrcaExecResult,
    handle: string,
    target: string,
    notice: string,
    allowRelist: boolean,
  ): Promise<NudgeResult> {
    if (isStaleResult(plain) && allowRelist) return submitReplacement(target, notice, handle, false);
    const receipt = classify(plain);
    if (legacyAccepted(plain) || receipt.delivered) {
      log(ORCA_OLD_HOST_WARNING);
      return { ok: true };
    }
    if (receipt.unproven) return { ok: true };
    if (receipt.down) return { ok: false, error: ORCA_NOT_RUNNING };
    return { ok: false, error: receipt.error };
  }

  /**
   * One submit to `handle`. A stale handle re-lists once. An ambiguous failure
   * retries once with `--retry-request` and does not type a second prompt.
   * Unproven receipts return ok so the watcher acks and does not call nudge again.
   */
  async function submit(handle: string, target: string, notice: string, allowRelist: boolean, waitSubmit = true): Promise<NudgeResult> {
    const raw = await send(handle, notice, undefined, waitSubmit);
    if (!waitSubmit) return finishLegacy(raw, handle, target, notice, allowRelist);
    if (isOldHostReceipt(raw)) {
      log(ORCA_OLD_HOST_WARNING);
      return { ok: true };
    }
    if (isOldHostRefusal(raw)) return finishLegacy(await send(handle, notice, undefined, false), handle, target, notice, allowRelist);
    const first = classify(raw);
    if (first.delivered) return { ok: true };
    if (first.stale && allowRelist) return submitReplacement(target, notice, handle, true);
    if (first.ambiguous && first.retryRequest) {
      const retriedRaw = await send(handle, notice, first.retryRequest, true);
      if (isOldHostRefusal(retriedRaw)) {
        return finishLegacy(await send(handle, notice, undefined, false), handle, target, notice, allowRelist);
      }
      if (isOldHostReceipt(retriedRaw)) {
        log(ORCA_OLD_HOST_WARNING);
        return { ok: true };
      }
      const retried = classify(retriedRaw);
      if (retried.delivered) return { ok: true };
      if (retried.stale && allowRelist) return submitReplacement(target, notice, handle, true);
      // The prompt may already be in the terminal. Ack so a later poll cannot send --text again.
      if (!retried.down) return { ok: true };
      return { ok: false, error: ORCA_NOT_RUNNING };
    }
    if (first.unproven) return { ok: true };
    if (first.down) return { ok: false, error: ORCA_NOT_RUNNING };
    return { ok: false, error: first.error };
  }

  async function submitReplacement(target: string, notice: string, staleHandle: string, waitSubmit: boolean): Promise<NudgeResult> {
    const listed = await listTerminals();
    if (!listed.ok) return { ok: false, error: listed.error };
    const matches = matchTitle(listed.terminals, target);
    if (matches.length !== 1 || matches[0].handle === staleHandle) {
      return { ok: false, error: `Orca terminal handle for ${quote(target)} is stale` };
    }
    return submit(matches[0].handle, target, notice, false, waitSubmit);
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

function isOldHostRefusal(result: OrcaExecResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/does not support --wait-submit/i.test(text)) return true;
  const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
  const error = record(record(payload)?.error);
  return error?.code === 'incompatible_runtime' && /wait-submit/i.test(text);
}

function isOldHostReceipt(result: OrcaExecResult): boolean {
  const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
  const prompt = record(sendRecord(payload)?.prompt);
  return prompt?.provider === 'old-host' || prompt?.requestId === 'unsupported-old-host';
}

function isStaleResult(result: OrcaExecResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`;
  return isStale(parseJson(result.stdout) ?? parseJson(result.stderr), text);
}

function legacyAccepted(result: OrcaExecResult): boolean {
  const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
  const stages = stagesOf(payload);
  return stages.includes('input_accepted') || stages.includes('turn_started') || sendAccepted(payload) || isOldHostReceipt(result);
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
