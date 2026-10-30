import type { NextConfig } from 'next';

// valetto.tech serves the Valetto pages (app/(site)/valetto) at its root. Host-scoped so replyslip.com and
// *.vercel.app previews keep their own routes. Paths not listed here (/api, /_next, /i, /c, /sign-in, /mcp,
// static files) pass through untouched on every host.
const VALETTO_HOST = [{ type: 'host' as const, value: '(www\\.)?valetto\\.tech' }];
const WWW_VALETTO_HOST = [{ type: 'host' as const, value: 'www\\.valetto\\.tech' }];
const REPLYSLIP_HOST = [{ type: 'host' as const, value: '(www\\.)?replyslip\\.com' }];
// Paths the www redirect leaves alone: API, MCP, Next assets, token pages, sign-in and any file with an extension.
const PASS_THROUGH = '(?!api(?:/|$)|mcp(?:/|$)|_next/|i(?:/|$)|c(?:/|$)|sign-in(?:/|$)|\\.well-known/|assets/|[^/]*\\.[^/]+$)';
// replyslip.com is retired. Only these named ReplySlip marketing pages (app/(site)) redirect to the valetto.tech
// homepage; everything else, including any future route, passes through. Not listed on purpose: /claim, /i, /sign-in
// (token and auth pages), /valetto (rules below), /dashboard, /docs/*, /api, /mcp and files.
const REPLYSLIP_MARKETING_PAGES = ['/how-it-works', '/compare/agent-relay', '/compare/harnessrouter', '/sharing', '/agents'];
// replyslip.com also sends its home and legal pages; valetto.tech serves its own /, /privacy and /terms.
const REPLYSLIP_ONLY_PAGES = ['/', '/privacy', '/terms'];
const toValettoHome = (source: string, has: typeof VALETTO_HOST) => ({ source, has, destination: 'https://valetto.tech/', statusCode: 301 as const });

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres', 'ajv'],
  async redirects() {
    return [
      // Old ReplySlip marketing pages still reachable on valetto.tech go home. Listed before the www rule so
      // www.valetto.tech/how-it-works is a single hop.
      ...REPLYSLIP_MARKETING_PAGES.map((source) => toValettoHome(source, VALETTO_HOST)),
      { source: `/:path(${PASS_THROUGH}.*)`, has: WWW_VALETTO_HOST, destination: 'https://valetto.tech/:path', statusCode: 301 },
      { source: '/valetto', has: REPLYSLIP_HOST, destination: 'https://valetto.tech/', statusCode: 301 },
      { source: '/valetto/:path*', has: REPLYSLIP_HOST, destination: 'https://valetto.tech/:path*', statusCode: 301 },
      ...[...REPLYSLIP_ONLY_PAGES, ...REPLYSLIP_MARKETING_PAGES].map((source) => toValettoHome(source, REPLYSLIP_HOST)),
    ];
  },
  async rewrites() {
    return {
      // beforeFiles: valetto.tech's / , /privacy and /terms must win over the ReplySlip pages at those paths.
      beforeFiles: [
        { source: '/', has: VALETTO_HOST, destination: '/valetto' },
        { source: '/early-access', has: VALETTO_HOST, destination: '/valetto/early-access' },
        { source: '/privacy', has: VALETTO_HOST, destination: '/valetto/privacy' },
        { source: '/terms', has: VALETTO_HOST, destination: '/valetto/terms' },
        { source: '/robots.txt', has: VALETTO_HOST, destination: '/valetto-seo/robots' },
        { source: '/sitemap.xml', has: VALETTO_HOST, destination: '/valetto-seo/sitemap' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      // The dashboard and the JSON/MCP API are never indexed, even after launch.
      { source: '/dashboard', headers: noindex },
      { source: '/dashboard/:path*', headers: noindex },
      { source: '/api/:path*', headers: noindex },
      // Invite, claim, customer and sign-in pages carry tokens in the URL: never indexed, never sent as a referrer.
      ...['/i', '/i/:path*', '/claim', '/c', '/c/:path*', '/sign-in', '/api/v1/c/:path*'].map((source) => ({
        source,
        headers: [...noindex, { key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
      // MCP Registry HTTP domain verification (public key only); serve as plain text.
      { source: '/.well-known/mcp-registry-auth', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
