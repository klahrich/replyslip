import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../next.config';
import sitemap from '@/app/sitemap';
import { GET as valettoSitemap } from '@/app/valetto-seo/sitemap/route';

// Spec 2.5: every /s/* page and /api/v1/s/* route is noindex and sends no referrer, and none is in a sitemap.
// Walks the real route folders, so a page LandingBot adds later is checked too.
const ROOT = join(__dirname, '..');
const TREES = [join(ROOT, 'app', '(customer)', 's'), join(ROOT, 'app', 'api', 'v1', 's')];
const SAMPLE_TOKEN = 'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function urlFor(file: string): string {
  const segments = relative(join(ROOT, 'app'), file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => (s === '[token]' || s === '[code]' ? SAMPLE_TOKEN : s === '[kind]' ? 'desktop' : s.replace(/^\[\.*(.+?)\]$/, 'x')));
  return `/${segments.join('/')}`;
}

async function configHeaders(path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rule of (await nextConfig.headers?.()) ?? []) {
    if (getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(path)) {
      for (const h of rule.headers) out.set(h.key.toLowerCase(), h.value);
    }
  }
  return out;
}

const files = TREES.flatMap(walk).filter((f) => /\/(page|route)\.(ts|tsx)$/.test(f));

describe('site assistant SEO', () => {
  beforeEach(() => vi.stubEnv('VALETTO_SITE_ASSISTANT', '1'));
  afterEach(() => vi.unstubAllEnvs());

  it('finds the demo routes', () => {
    const urls = files.map(urlFor);
    expect(urls).toContain(`/s/demo/${SAMPLE_TOKEN}/shot/desktop`);
    expect(urls).toContain(`/api/v1/s/demo/${SAMPLE_TOKEN}`);
    expect(urls).toContain(`/api/v1/s/demo/${SAMPLE_TOKEN}/messages`);
  });

  // LandingBot's page (/s/demo/<token>) lives in another PR; the header rule must already cover it.
  it.each(['/s', '/s/demo', `/s/demo/${SAMPLE_TOKEN}`, `/s/demo/${SAMPLE_TOKEN}/shot/mobile`, '/s/claim/x', `/api/v1/s/demo/${SAMPLE_TOKEN}`])(
    'next.config sends noindex and no-referrer on %s',
    async (path) => {
      const headers = await configHeaders(path);
      expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  it.each(files.map((f) => [relative(ROOT, f), f]))('%s gets noindex and no-referrer from next.config', async (_name, file) => {
    const headers = await configHeaders(urlFor(file));
    expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each(files.filter((f) => /route\.ts$/.test(f)).map((f) => [relative(ROOT, f), f]))(
    '%s sends the headers itself, on errors too',
    async (_name, file) => {
      const mod = (await import(file)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
      for (const method of ['GET', 'POST'] as const) {
        const handler = mod[method];
        if (!handler) continue;
        const res = await handler(
          new Request(`http://localhost${urlFor(file)}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: method === 'POST' ? '{}' : undefined,
          }),
          { params: Promise.resolve({ token: SAMPLE_TOKEN, kind: 'desktop' }) },
        );
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
        expect(res.headers.get('referrer-policy')).toBe('no-referrer');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
      }
    },
  );

  it('keeps /s out of both sitemaps', async () => {
    expect(sitemap().some((entry) => /\/s(\/|$)/.test(new URL(entry.url).pathname))).toBe(false);
    const xml = await valettoSitemap().text();
    expect(xml).not.toMatch(/<loc>[^<]*\/s(\/|<)/);
  });
});
