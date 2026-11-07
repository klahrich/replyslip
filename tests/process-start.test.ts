import { describe, expect, it } from 'vitest';
import {
  darwinLstartMs,
  linuxStartMs,
  parseDarwinIdentity,
  PROCESS_START_TIMEOUT_MS,
  processStartedAtMs,
} from '../packages/cli/src/process-identity';

const STAT = '4242 (node) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
const LSTART = 'Sat Nov  7 16:33:01 2026';

describe('process start adapters', () => {
  it('parses a stable macOS lstart and keeps the command that follows it', () => {
    const expected = new Date(2026, 10, 7, 16, 33, 1).getTime();
    expect(darwinLstartMs(`  ${LSTART}  `)).toBe(expected);
    expect(darwinLstartMs('Sat Feb 31 00:00:00 2026')).toBeNull();
    expect(darwinLstartMs('not a start time')).toBeNull();
    const identity = parseDarwinIdentity(`${LSTART} node replyslip.mjs watch --name Bot`);
    expect(identity).toEqual({ cmdline: 'node replyslip.mjs watch --name Bot', startedAtMs: expected });
    expect(parseDarwinIdentity(LSTART)).toBeNull();
    const sameSecond = darwinLstartMs(LSTART);
    expect(darwinLstartMs('Sat Nov  7 16:33:01 2026')).toBe(sameSecond);
    expect(darwinLstartMs('Sat Nov  7 16:33:02 2026')).toBe((sameSecond ?? 0) + 1000);
  });

  it('reads linux, macOS, and windows start times, and fails closed when the probe is unknown', () => {
    expect(processStartedAtMs(4242, { platform: 'linux', readLinux: () => ({ stat: STAT, btimeSec: 1_700_000_000 }) })).toBe(
      linuxStartMs(STAT, 1_700_000_000),
    );
    expect(processStartedAtMs(4242, { platform: 'linux', readLinux: () => null })).toBeNull();

    const expected = new Date(2026, 10, 7, 16, 33, 1).getTime();
    let timeout = 0;
    expect(
      processStartedAtMs(42, {
        platform: 'darwin',
        run: (_file, args, ms) => {
          timeout = ms;
          expect(args).toContain('lstart=');
          return `${LSTART}\n`;
        },
      }),
    ).toBe(expected);
    expect(timeout).toBe(PROCESS_START_TIMEOUT_MS);
    expect(processStartedAtMs(42, { platform: 'darwin', run: () => null })).toBeNull();
    expect(
      processStartedAtMs(42, {
        platform: 'darwin',
        run: () => {
          throw new Error('timed out');
        },
      }),
    ).toBeNull();
    expect(processStartedAtMs(42, { platform: 'freebsd', run: () => LSTART })).toBeNull();

    expect(
      processStartedAtMs(42, {
        platform: 'win32',
        run: (_file, args, ms) => {
          expect(ms).toBe(PROCESS_START_TIMEOUT_MS);
          expect(args.at(-1)).toContain('ProcessId=42');
          return '"20261107100000.000000-480"';
        },
      }),
    ).toBe(Date.UTC(2026, 10, 7, 18, 0, 0, 0));
    expect(processStartedAtMs(42, { platform: 'win32', run: () => '"/Date(1700000000000)/"' })).toBe(1_700_000_000_000);
    expect(processStartedAtMs(42, { platform: 'win32', run: () => 'not-a-date' })).toBeNull();
    expect(processStartedAtMs(42, { platform: 'win32', run: () => null })).toBeNull();
  });
});
