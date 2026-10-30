import { VALETTO_URL } from '@/components/site/valetto/seo';

// valetto.tech/robots.txt (host-scoped rewrite in next.config.ts). replyslip.com keeps app/robots.ts.
export const dynamic = 'force-static';

export function GET() {
  const body = `User-Agent: *\nAllow: /\n\nSitemap: ${VALETTO_URL}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
