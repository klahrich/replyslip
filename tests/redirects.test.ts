import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

// Mirrors how Next applies redirects: first rule whose source matches the path and whose `has` host regex
// matches the Host header wins. Like Next, the incoming query string is appended to the destination.
// Returns the Location or null when the request passes through.
async function redirectFor(host: string, url: string): Promise<string | null> {
  const [pathname, query] = url.split('?');
  const rules = (await nextConfig.redirects?.()) ?? [];
  for (const rule of rules) {
    const hostOk = (rule.has ?? []).every((h) => h.type === 'host' && new RegExp(`^${h.value}$`).test(host));
    if (!hostOk) continue;
    const params = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(pathname);
    if (!params) continue;
    const location = rule.destination.replace(/:(\w+)\*?/g, (_, name: string) => {
      const v = params[name];
      return Array.isArray(v) ? v.join('/') : (v ?? '');
    });
    return query ? `${location}?${query}` : location;
  }
  return null;
}

const NEVER_REDIRECTED = [
  '/api/mcp',
  '/api/v1/c/abc',
  '/api/v1/s/demo/abc',
  '/api/valetto/early-access',
  '/mcp',
  '/_next/static/chunk.js',
  '/i',
  '/i/abc',
  '/c',
  '/c/abc',
  '/s/demo/abc',
  '/s/demo/abc/shot/desktop',
  '/sign-in',
  '/claim',
  '/dashboard',
  '/dashboard/settings',
  // Owner setup page linked from the dashboard footer (app/dashboard/layout.tsx).
  '/agents',
  '/.well-known/mcp-registry-auth',
  '/assets/og.png',
  '/skill.md',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/google868fe048808dd6c8.html',
  '/og.png',
  '/favicon.ico',
  '/replyslip.mjs',
  '/docs/api.md',
  '/docs/getting-started.md',
  '/valetto-seo/robots',
  '/docs',
  '/docs/api',
  // Unknown paths and future routes are never redirected by default.
  '/foo',
  '/foo/bar',
  '/nonexistent',
  '/compare',
  '/compare/new-slug',
  '/how-it-works/extra',
];

const OLD_SITE_PAGES = ['/how-it-works', '/compare/agent-relay', '/compare/harnessrouter', '/sharing'];

describe('replyslip.com redirects', () => {
  for (const host of ['replyslip.com', 'www.replyslip.com']) {
    it(`${host}: site pages go to the valetto.tech homepage`, async () => {
      for (const path of ['/', '/privacy', '/terms', ...OLD_SITE_PAGES]) {
        expect(await redirectFor(host, path), path).toBe('https://valetto.tech/');
      }
    });

    it(`${host}: /valetto paths keep their PR #98 mapping`, async () => {
      expect(await redirectFor(host, '/valetto')).toBe('https://valetto.tech/');
      expect(await redirectFor(host, '/valetto/early-access')).toBe('https://valetto.tech/early-access');
    });

    it(`${host}: API, MCP, token, app and file paths pass through`, async () => {
      for (const path of NEVER_REDIRECTED) expect(await redirectFor(host, path), path).toBeNull();
      // ReplySlip has no /early-access page; only valetto.tech serves one.
      expect(await redirectFor(host, '/early-access')).toBeNull();
    });
  }
});

describe('query strings', () => {
  it('are preserved on the replyslip.com and valetto.tech redirects', async () => {
    expect(await redirectFor('replyslip.com', '/?ref=x')).toBe('https://valetto.tech/?ref=x');
    expect(await redirectFor('www.replyslip.com', '/how-it-works?ref=x')).toBe('https://valetto.tech/?ref=x');
    expect(await redirectFor('valetto.tech', '/sharing?ref=x')).toBe('https://valetto.tech/?ref=x');
  });
});

describe('valetto.tech redirects', () => {
  it('old ReplySlip site pages go to the homepage', async () => {
    for (const path of OLD_SITE_PAGES) expect(await redirectFor('valetto.tech', path), path).toBe('https://valetto.tech/');
  });

  it('Valetto pages and their rewrite sources are untouched', async () => {
    for (const path of ['/', '/early-access', '/privacy', '/terms', '/valetto', '/valetto/early-access', '/valetto/privacy', '/valetto/terms']) {
      expect(await redirectFor('valetto.tech', path), path).toBeNull();
    }
  });

  it('API, MCP, token, app and file paths pass through', async () => {
    for (const path of NEVER_REDIRECTED) expect(await redirectFor('valetto.tech', path), path).toBeNull();
  });

  it('www.valetto.tech sends old site pages home in one hop and keeps the path for Valetto pages', async () => {
    expect(await redirectFor('www.valetto.tech', '/how-it-works')).toBe('https://valetto.tech/');
    expect(await redirectFor('www.valetto.tech', '/')).toBe('https://valetto.tech/');
    expect(await redirectFor('www.valetto.tech', '/privacy')).toBe('https://valetto.tech/privacy');
    // Unknown paths only get the existing www -> apex hop, never the homepage redirect.
    expect(await redirectFor('www.valetto.tech', '/foo')).toBe('https://valetto.tech/foo');
    expect(await redirectFor('www.valetto.tech', '/agents')).toBe('https://valetto.tech/agents');
  });
});

describe('preview hosts', () => {
  it('*.vercel.app serves every path as-is', async () => {
    for (const path of ['/', '/how-it-works', '/valetto', '/privacy']) {
      expect(await redirectFor('replyslip-git-main.vercel.app', path), path).toBeNull();
    }
  });
});
