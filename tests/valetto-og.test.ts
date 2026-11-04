import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { VALETTO_OG_IMAGE, VALETTO_PATHS, valettoMeta } from '@/components/site/valetto/seo';

const ROOT = join(__dirname, '..');

describe('Valetto social image', () => {
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
