import { VALETTO_PATHS, VALETTO_URL } from '@/components/site/valetto/seo';

// valetto.tech/sitemap.xml (host-scoped rewrite in next.config.ts). replyslip.com keeps app/sitemap.ts.
export const dynamic = 'force-static';

export function GET() {
  const urls = VALETTO_PATHS.map((p) => `<url>\n<loc>${VALETTO_URL}${p}</loc>\n</url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
