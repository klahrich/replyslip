import { describe, expect, it } from 'vitest';
import { WAKE_NOTICE } from '@/lib/wake-notice';
import {
  MIN_ORCA_VERSION,
  ORCA_NOT_RUNNING,
  ORCA_OLD_HOST_WARNING,
  ORCA_WAIT_SUBMIT_SECONDS,
  createOrcaDriver,
  orcaBinary,
  type OrcaExecFile,
  type OrcaExecResult,
} from '../packages/cli/src/drivers/orca';

type Call = { file: string; args: string[] };

function scripted(steps: Array<(call: Call) => OrcaExecResult>): { execFile: OrcaExecFile; calls: Call[] } {
  const calls: Call[] = [];
  const execFile: OrcaExecFile = async (file, args) => {
    const call = { file, args: [...args] };
    calls.push(call);
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unexpected orca call ${calls.length}: ${args.join(' ')}`);
    return step(call);
  };
  return { execFile, calls };
}

function ok(stdout: string): OrcaExecResult {
  return { code: 0, stdout, stderr: '', timedOut: false };
}

function fail(stdout: string, code = 1): OrcaExecResult {
  return { code, stdout, stderr: '', timedOut: false };
}

const running = ok(JSON.stringify({ ok: true, version: '1.4.205' }));

const PANE = 'tab_a:leaf_a';

function listed(rows: Array<{ handle: string; tabId: string; leafId: string; title?: string }>): OrcaExecResult {
  return ok(JSON.stringify({ result: { terminals: rows } }));
}

function receipt(stages: string[], extra: Record<string, unknown> = {}): OrcaExecResult {
  return ok(
    JSON.stringify({
      send: { accepted: true, prompt: { stages } },
      mutation: { requestId: 'req-ignored', replayed: false },
      ...extra,
    }),
  );
}

const sendArgs = (handle: string, retry?: string) => [
  'terminal',
  'send',
  '--terminal',
  handle,
  '--text',
  WAKE_NOTICE,
  '--enter',
  '--wait-submit',
  ORCA_WAIT_SUBMIT_SECONDS,
  '--json',
  ...(retry ? ['--retry-request', retry] : []),
];

describe('orca driver', () => {
  it('sends the herdr notice once a pane key resolves and turn_started is delivered', async () => {
    const { execFile, calls } = scripted([
      () => running,
      () =>
        listed([
          { handle: 'term_old', tabId: 'tab_b', leafId: 'leaf_b', title: 'Reviewer' },
          { handle: 'term_live', tabId: 'tab_a', leafId: 'leaf_a', title: 'Reviewer' },
        ]),
      () => receipt(['input_accepted', 'turn_started']),
    ]);
    const driver = createOrcaDriver({ execFile, env: { REPLYSLIP_ORCA_BIN: '/opt/orca' } });
    expect(orcaBinary({ REPLYSLIP_ORCA_BIN: '/opt/orca' })).toBe('/opt/orca');
    expect(orcaBinary({})).toBe('orca');

    expect((await driver.check()).ok).toBe(true);
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls.map((call) => call.file)).toEqual(['/opt/orca', '/opt/orca', '/opt/orca']);
    expect(calls.map((call) => call.args)).toEqual([
      ['status', '--json'],
      ['terminal', 'list', '--json'],
      sendArgs('term_live'),
    ]);
    expect(JSON.stringify(calls)).not.toContain('term_old');
    expect(calls[2].args[5]).toContain('Another agent');
  });

  it('acks an input_accepted receipt without a second send', async () => {
    const { execFile, calls } = scripted([
      () => listed([{ handle: 'term_1', tabId: 'tab_a', leafId: 'leaf_a' }]),
      () => receipt(['input_accepted'], { warnings: ['input was accepted, but this provider cannot report delivery.'] }),
    ]);
    const driver = createOrcaDriver({ execFile, env: {} });
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls.map((call) => call.args)).toEqual([['terminal', 'list', '--json'], sendArgs('term_1')]);
  });

  it('acks a send timeout without resending', async () => {
    const { execFile, calls } = scripted([
      () => listed([{ handle: 'term_1', tabId: 'tab_a', leafId: 'leaf_a' }]),
      () => ({ code: 1, stdout: '', stderr: '', timedOut: true }),
    ]);
    const driver = createOrcaDriver({ execFile, env: {} });
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('retries an ambiguous failure only with --retry-request and then acks when still unproven', async () => {
    const ambiguous = fail(
      JSON.stringify({
        ok: false,
        warnings: ['ambiguous transport failure; repeat the exact command with --retry-request req_9'],
        mutation: { requestId: 'req_9' },
      }),
    );
    const { execFile, calls } = scripted([
      () => listed([{ handle: 'term_1', tabId: 'tab_a', leafId: 'leaf_a' }]),
      () => ambiguous,
      () => receipt(['input_accepted']),
    ]);
    const driver = createOrcaDriver({ execFile, env: {} });
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls.map((call) => call.args)).toEqual([
      ['terminal', 'list', '--json'],
      sendArgs('term_1'),
      sendArgs('term_1', 'req_9'),
    ]);
  });

  it('fails closed when the pane key matches nothing or more than one terminal', async () => {
    const row = () => listed([{ handle: 'term_1', tabId: 'tab_b', leafId: 'leaf_b', title: 'Reviewer' }]);
    const none = scripted([row, row]);
    const missing = createOrcaDriver({ execFile: none.execFile, env: {} });
    expect(await missing.nudge(PANE, WAKE_NOTICE)).toEqual({
      ok: false,
      error: 'no Orca pane "tab_a:leaf_a"',
    });
    expect(await missing.nudge('Reviewer', WAKE_NOTICE)).toEqual({
      ok: false,
      error: 'no Orca pane "Reviewer"',
    });
    expect(none.calls.map((call) => call.args[0])).toEqual(['terminal', 'terminal']);

    const many = scripted([
      () =>
        listed([
          { handle: 'term_a', tabId: 'tab_a', leafId: 'leaf_a' },
          { handle: 'term_b', tabId: 'tab_a', leafId: 'leaf_a' },
        ]),
    ]);
    const duplicate = createOrcaDriver({ execFile: many.execFile, env: {} });
    expect(await duplicate.nudge(PANE, WAKE_NOTICE)).toEqual({
      ok: false,
      error: 'more than one Orca pane "tab_a:leaf_a"',
    });
    expect(many.calls).toHaveLength(1);
  });

  it('re-lists once after a stale handle and sends only to the replacement', async () => {
    const { execFile, calls } = scripted([
      () => listed([{ handle: 'term_old', tabId: 'tab_a', leafId: 'leaf_a' }]),
      () =>
        fail(
          JSON.stringify({ ok: false, error: { code: 'terminal_handle_stale', message: 'handle expired' } }),
        ),
      () => listed([{ handle: 'term_new', tabId: 'tab_a', leafId: 'leaf_a' }]),
      () => receipt(['turn_started']),
    ]);
    const driver = createOrcaDriver({ execFile, env: {} });
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls.map((call) => call.args)).toEqual([
      ['terminal', 'list', '--json'],
      sendArgs('term_old'),
      ['terminal', 'list', '--json'],
      sendArgs('term_new'),
    ]);
  });

  it('falls back to a plain send when an older host refuses --wait-submit', async () => {
    const logs: string[] = [];
    const refused = fail(
      JSON.stringify({
        ok: false,
        error: {
          code: 'incompatible_runtime',
          message:
            'This Orca host does not support --wait-submit. No input was sent; update Orca on the execution host, or omit only --wait-submit for a legacy prompt whose delivery cannot be observed or retried safely.',
        },
      }),
    );
    const legacy = ok(
      JSON.stringify({
        send: {
          accepted: true,
          prompt: {
            requestId: 'unsupported-old-host',
            stages: ['input_accepted'],
            provider: 'old-host',
            observation: 'unsupported',
          },
        },
      }),
    );
    const { execFile, calls } = scripted([
      () => listed([{ handle: 'term_1', tabId: 'tab_a', leafId: 'leaf_a' }]),
      () => refused,
      () => legacy,
    ]);
    const driver = createOrcaDriver({ execFile, env: {}, log: (message) => logs.push(message) });
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls.map((call) => call.args)).toEqual([
      ['terminal', 'list', '--json'],
      sendArgs('term_1'),
      ['terminal', 'send', '--terminal', 'term_1', '--text', WAKE_NOTICE, '--enter', '--json'],
    ]);
    expect(logs).toEqual([ORCA_OLD_HOST_WARNING]);
    expect(ORCA_OLD_HOST_WARNING).toContain(MIN_ORCA_VERSION);
  });

  it('reports when Orca is not running', async () => {
    const down = scripted([() => ({ code: 127, stdout: '', stderr: 'ENOENT', timedOut: false })]);
    const driver = createOrcaDriver({ execFile: down.execFile, env: {} });
    expect(await driver.check()).toEqual({ ok: false, message: ORCA_NOT_RUNNING });

    const statusFail = scripted([() => fail(JSON.stringify({ ok: false, error: { message: 'not running' } }))]);
    const stopped = createOrcaDriver({ execFile: statusFail.execFile, env: {} });
    expect(await stopped.check()).toEqual({ ok: false, message: ORCA_NOT_RUNNING });

    const nudgeDown = scripted([() => ({ code: 127, stdout: '', stderr: 'ENOENT', timedOut: false })]);
    const nudger = createOrcaDriver({ execFile: nudgeDown.execFile, env: {} });
    expect(await nudger.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: false, error: ORCA_NOT_RUNNING });
  });

  it('uses --include-visual-layouts when terminal list omits leafId', async () => {
    const untitled = ok(JSON.stringify({ result: { terminals: [{ handle: 'term_live', title: 'Reviewer' }] } }));
    const visual = ok(
      JSON.stringify({
        result: {
          terminals: [{ handle: 'term_live', title: 'Reviewer' }],
          visualLayouts: [
            {
              root: {
                type: 'group',
                tabs: [
                  {
                    tabId: 'tab_a',
                    panes: {
                      type: 'pane-split',
                      direction: 'vertical',
                      first: { type: 'terminal', handle: 'term_other', tabId: 'tab_a', leafId: 'leaf_b' },
                      second: { type: 'terminal', handle: 'term_live', tabId: 'tab_a', leafId: 'leaf_a' },
                    },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const { execFile, calls } = scripted([() => untitled, () => visual, () => receipt(['turn_started'])]);
    const driver = createOrcaDriver({ execFile, env: {} });
    expect(await driver.nudge(PANE, WAKE_NOTICE)).toEqual({ ok: true });
    expect(calls.map((call) => call.args)).toEqual([
      ['terminal', 'list', '--json'],
      ['terminal', 'list', '--include-visual-layouts', '--json'],
      sendArgs('term_live'),
    ]);
  });
});
