import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GET as apiDoc } from '@/app/docs/api.md/route';
import { GET as gettingStarted } from '@/app/docs/getting-started.md/route';
import { GET as llms } from '@/app/llms.txt/route';
import { GET as skill } from '@/app/skill.md/route';
import robots from '@/app/robots';
import { apiReferenceMarkdown } from '@/lib/agent-docs';

function docsRequest(path: string) {
  return new Request(`https://preview.example${path}`, {
    headers: { 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https' },
  });
}

describe('agent docs', () => {
  it('serves llms.txt and skill.md with the right types and host', async () => {
    const llmsRes = await llms(docsRequest('/llms.txt'));
    expect(llmsRes.status).toBe(200);
    expect(llmsRes.headers.get('content-type')).toContain('text/plain');
    const llmsBody = await llmsRes.text();
    expect(llmsBody).toContain('https://preview.example/docs/getting-started.md');
    expect(llmsBody).toContain('https://preview.example/docs/api.md');
    expect(llmsBody).toContain('https://preview.example/skill.md');
    expect(llmsBody.split('\n')[2]).toMatch(/^> ReplySlip/);

    const skillRes = await skill(docsRequest('/skill.md'));
    expect(skillRes.status).toBe(200);
    expect(skillRes.headers.get('content-type')).toContain('text/markdown');
    const skillBody = await skillRes.text();
    expect(skillBody).toMatch(/^---\nname: replyslip\ndescription: .+\n---/);
    expect(skillBody).toContain('create_task');
    expect(skillBody).toContain('result_schema');
    expect(skillBody).toContain('complete_task');
    expect(skillBody).toContain('result_schema_mismatch');
    expect(skillBody).toContain('https://preview.example/api/v1/agents/register');

    const guide = await gettingStarted(docsRequest('/docs/getting-started.md'));
    expect(guide.status).toBe(200);
    expect(guide.headers.get('content-type')).toContain('text/markdown');
    const guideBody = await guide.text();
    for (const word of ['open', 'needs_info', 'done', 'failed', 'join code', 'send_message', 'ask', 'fail_task']) {
      expect(guideBody.toLowerCase()).toContain(word);
    }

    const api = await apiDoc(docsRequest('/docs/api.md'));
    expect(api.status).toBe(200);
    expect(api.headers.get('content-type')).toContain('text/markdown');
    const apiBody = await api.text();
    expect(apiBody).toContain('https://preview.example/api/mcp');
    expect(apiBody).toContain('/api/v1/auth/request-code');
    expect(apiBody).toContain('/api/v1/join-codes');
  });

  it('keeps docs/API.md identical to the shared source', () => {
    expect(readFileSync('docs/API.md', 'utf8')).toBe(apiReferenceMarkdown('https://<host>'));
  });

  it('allows AI crawlers on the site and blocks the dashboard and API', () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    for (const name of ['*', 'GPTBot', 'ClaudeBot']) {
      const rule = list.find((item) => item.userAgent === name);
      expect(rule?.allow).toBe('/');
      expect(rule?.disallow).toEqual(expect.arrayContaining(['/dashboard', '/api']));
    }
  });
});
