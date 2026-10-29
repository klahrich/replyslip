import type { NextConfig } from 'next';

const noReferrer = { key: 'Referrer-Policy', value: 'no-referrer' };
/** Page routes: /i/:token (invite and public link landing + email-code steps), /c... (customer), /sign-in. */
const CUSTOMER_PAGES = ['/i', '/i/:path*', '/c', '/c/:path*', '/sign-in', '/sign-in/:path*'];
/** R1–R8 (/api/v1/c/*) and the auth routes the customer page calls (request-code, verify-code, me, logout). */
const CUSTOMER_API = ['/api/v1/c/:path*', '/api/v1/auth/:path*'];

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres', 'ajv'],
  async headers() {
    const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      // The dashboard and the JSON/MCP API are never indexed, even after launch.
      { source: '/dashboard', headers: noindex },
      { source: '/dashboard/:path*', headers: noindex },
      { source: '/api/:path*', headers: noindex },
      // Valetto customer surface (spec 14, 17.11): customer pages, invite and public link pages, and sign-in.
      // Link tokens live in /i/:token URLs, so none of these may leak a Referer.
      ...CUSTOMER_PAGES.map((source) => ({ source, headers: [...noindex, noReferrer] })),
      // The customer API and the email-code sign-in API already get X-Robots-Tag from /api/:path* above.
      ...CUSTOMER_API.map((source) => ({ source, headers: [noReferrer] })),
      // MCP Registry HTTP domain verification (public key only); serve as plain text.
      { source: '/.well-known/mcp-registry-auth', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
