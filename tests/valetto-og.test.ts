import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { VALETTO_DESCRIPTION, VALETTO_OG_IMAGE, VALETTO_PATHS, VALETTO_TITLE, valettoMeta } from '@/components/site/valetto/seo';

const ROOT = join(__dirname, '..');

describe('Valetto social image', () => {
  it('share text leads with the pain and matches the hero lines', () => {
    const page = readFileSync(join(ROOT, 'app/(site)/valetto/page.tsx'), 'utf8');
    const sub = page.match(/<p className="vt-sub">([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(VALETTO_TITLE).toBe('Customers wait while you’re on a job. Valetto answers.');
    expect(VALETTO_TITLE.length).toBeLessThanOrEqual(60);
    expect(VALETTO_TITLE.startsWith('Valetto')).toBe(false);
    expect(VALETTO_DESCRIPTION).toBe(
      'Answer every customer, even when you’re on a job. It answers from your website and content, and passes anything it can’t answer to you.',
    );
    expect(VALETTO_DESCRIPTION.length).toBeLessThanOrEqual(155);
    expect(VALETTO_DESCRIPTION).not.toMatch(/approv|review first/i);
    expect(VALETTO_OG_IMAGE.alt).toBe('Valetto: Answer every customer. Even when you’re on a job.');
    expect(page).toContain('text="Answer every customer."');
    expect(page).toContain('text="Even when you’re on a job."');
    expect(sub).toContain('answers from your website and content');
    expect(sub).toContain('passes anything it can’t answer to you');
    expect(sub).not.toMatch(/approv|review first/i);
  });

  it('is a 1200x630 PNG in public at the path the metadata uses', () => {
    const png = readFileSync(join(ROOT, 'public', VALETTO_OG_IMAGE.url));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('every Valetto page shares it on og and twitter as a large card', () => {
    for (const path of VALETTO_PATHS) {
      const meta = valettoMeta(path, 'T', 'D');
      expect(meta.openGraph?.images, path).toEqual([VALETTO_OG_IMAGE]);
      expect(meta.twitter, path).toMatchObject({ card: 'summary_large_image', images: [VALETTO_OG_IMAGE] });
    }
  });

  it('is served as a static file on valetto.tech, with no redirect or rewrite in front of it', async () => {
    const matches = (rule: { source: string; has?: { type: string; value?: string }[] }, host: string) =>
      (rule.has ?? []).every((h) => h.type === 'host' && new RegExp(`^${h.value}$`).test(host)) &&
      Boolean(getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(VALETTO_OG_IMAGE.url));
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const rewrites = await nextConfig.rewrites?.();
    const beforeFiles = rewrites && !Array.isArray(rewrites) ? rewrites.beforeFiles : (rewrites ?? []);
    expect(redirects.filter((r) => matches(r, 'valetto.tech'))).toEqual([]);
    for (const host of ['valetto.tech', 'www.valetto.tech']) expect(beforeFiles.filter((r) => matches(r, host)), host).toEqual([]);
    // www.valetto.tech sends it one hop to the same file on valetto.tech (og:image is already absolute there).
    expect(redirects.filter((r) => matches(r, 'www.valetto.tech')).map((r) => r.destination)).toEqual(['https://valetto.tech/:path']);
  });
});
