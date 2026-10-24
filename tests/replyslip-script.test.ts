import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GET as scriptRoute } from '@/app/replyslip.mjs/route';
import { GET as shaRoute } from '@/app/replyslip.mjs.sha256/route';
import { replyslipScriptPath } from '@/lib/replyslip-script';

const execFileAsync = promisify(execFile);

describe('served replyslip.mjs', () => {
  it('matches the bundle, the sha256 route, and a Node syntax check', async () => {
    await execFileAsync(process.execPath, ['scripts/bundle-replyslip.mjs', '--check']);
    const bytes = readFileSync(replyslipScriptPath());
    const digest = createHash('sha256').update(bytes).digest('hex');

    const script = await scriptRoute();
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    const body = Buffer.from(await script.arrayBuffer());
    expect(Buffer.compare(body, bytes)).toBe(0);
    expect(body.toString('utf8')).toContain('// SPDX-License-Identifier: Apache-2.0');
    expect(body.toString('utf8')).toContain('watch');
    expect(body.toString('utf8')).toContain('register');
    expect(body.toString('utf8')).not.toContain('rsk_');
    expect(body.toString('utf8')).not.toContain('rsw_');

    const sha = await shaRoute();
    expect(sha.status).toBe(200);
    expect(sha.headers.get('content-type')).toContain('text/plain');
    expect(await sha.text()).toBe(`${digest}  replyslip.mjs\n`);

    await execFileAsync(process.execPath, ['--check', replyslipScriptPath()]);
    let code = 0;
    let output = '';
    try {
      const ok = await execFileAsync(process.execPath, [replyslipScriptPath()], { encoding: 'utf8' });
      output = `${ok.stdout}${ok.stderr}`;
    } catch (err) {
      const failure = err as { code?: number; stdout?: string; stderr?: string };
      code = typeof failure.code === 'number' ? failure.code : 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
    expect(code).toBe(1);
    expect(output).toContain('Usage: replyslip');
  });
});
