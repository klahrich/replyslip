import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplyslip } from '../packages/cli/src/cli';
import { joinCodeEnvName } from '../packages/cli/src/register';

const KEY = 'rsk_CANARY_KEY_do_not_print';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe('replyslip register', () => {
  it('writes mode 600, prints no key, and refuses to overwrite', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    const io = capture();
    const calls: { authorization?: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({
          api_key: KEY,
          agent: { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-24T00:00:00.000Z' },
          mcp: { url: 'https://replyslip.com/api/mcp' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };

    const code = await runReplyslip(
      ['register', '--name', 'LandingBot', '--description', 'Drafts', '--url', 'https://replyslip.com'],
      {
        home,
        env: { REPLYSLIP_JOIN_CODE: 'rjc_shared_burned', REPLYSLIP_JOIN_CODE_LANDINGBOT: 'rjc_personal' },
        fetchImpl,
        stdout: io.stdout,
        stderr: io.stderr,
      },
    );
    expect(code).toBe(0);
    expect(joinCodeEnvName('LandingBot')).toBe('REPLYSLIP_JOIN_CODE_LANDINGBOT');
    expect(calls[0]?.authorization).toBe('Bearer rjc_personal');
    expect(calls[0]?.body).toContain('"description":"Drafts"');
    const printed = [...io.out, ...io.err].join('\n');
    expect(printed).not.toContain(KEY);
    expect(printed).toContain('LandingBot');
    expect(printed).toContain('https://replyslip.com/api/mcp');
    expect(printed).toContain('key saved to ');

    const file = io.out.find((line) => line.startsWith('key saved to '))!.replace('key saved to ', '');
    const saved = JSON.parse(await readFile(file, 'utf8')) as { api_key: string; relay_url: string };
    expect(saved.api_key).toBe(KEY);
    expect(saved.relay_url).toBe('https://replyslip.com');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(home, '.replyslip'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);

    const again = capture();
    const second = await runReplyslip(['register', '--join-code', 'rjc_other', '--name', 'LandingBot'], {
      home,
      env: { REPLYSLIP_JOIN_CODE: 'rjc_shared_burned' },
      fetchImpl,
      stdout: again.stdout,
      stderr: again.stderr,
    });
    expect(second).toBe(1);
    expect(again.err.join('\n')).toMatch(/Refusing to overwrite/);
    expect([...again.out, ...again.err].join('\n')).not.toContain(KEY);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(await readFile(file, 'utf8')).api_key).toBe(KEY);

    const pathOnly = capture();
    const looked = await runReplyslip(['key-path', 'LandingBot'], { home, stdout: pathOnly.stdout, stderr: pathOnly.stderr });
    expect(looked).toBe(0);
    expect(pathOnly.out).toEqual([file]);
    expect(pathOnly.err).toEqual([]);

    const shared = capture();
    let fetched = false;
    const ignored = await runReplyslip(['register', '--name', 'OtherBot'], {
      home,
      env: { REPLYSLIP_JOIN_CODE: 'rjc_shared_burned' },
      fetchImpl: async () => {
        fetched = true;
        return new Response('{}', { status: 500 });
      },
      stdout: shared.stdout,
      stderr: shared.stderr,
    });
    expect(ignored).toBe(1);
    expect(fetched).toBe(false);
    expect(shared.err.join('\n')).toMatch(/REPLYSLIP_JOIN_CODE/);
    expect([...shared.out, ...shared.err].join('\n')).not.toContain('rjc_shared_burned');
  });
});

describe('replyslip watch --key-file', () => {
  it('sends the file key, prefers it over --key, and does not print it', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-watch-'));
    const keyFile = path.join(home, 'watcher-box.key');
    const secret = 'rsw_CANARY_do_not_print';
    await writeFile(keyFile, `${secret}\n`, { mode: 0o600 });
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      if (String(input).endsWith('/ack')) return new Response('{"acked":0}', { status: 200 });
      return new Response('{"wakes":[]}', { status: 200 });
    };
    const io = capture();
    const code = await runReplyslip(
      ['watch', '--once', '--url', 'https://replyslip.com', '--key-file', keyFile, '--key', 'rsw_ignored'],
      {
        home,
        env: { REPLYSLIP_WATCHER_KEY: 'rsw_env_ignored' },
        fetchImpl,
        stdout: io.stdout,
        stderr: io.stderr,
      },
    );
    expect(code).toBe(0);
    expect(seen[0]).toBe(`Bearer ${secret}`);
    expect([...io.out, ...io.err].join('\n')).not.toContain(secret);
    expect([...io.out, ...io.err].join('\n')).not.toContain('rsw_ignored');

    const missing = capture();
    const failed = await runReplyslip(['watch', '--url', 'https://replyslip.com', '--key-file', path.join(home, 'missing.key')], {
      home,
      stdout: missing.stdout,
      stderr: missing.stderr,
    });
    expect(failed).toBe(1);
    expect(missing.err.join('\n')).toMatch(/Could not read watcher key file/);
    expect(missing.err.join('\n')).not.toContain(secret);
  });
});
