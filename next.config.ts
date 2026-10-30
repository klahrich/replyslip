import type { NextConfig } from 'next';

const noReferrer = { key: 'Referrer-Policy', value: 'no-referrer' };
/** Page routes: /i and /i/:token (invite and link landing), /claim, /c… (customer), /sign-in. */
const CUSTOMER_PAGES = ['/i', '/i/:path*', '/claim', '/c', '/c/:path*', '/sign-in', '/sign-in/:path*'];
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
      // Valetto and invite pages carry tokens in the URL (/i/:token, /claim?token=…) or sign people in:
      // never indexed, never sent as a referrer (spec 14, 17.11).
      ...CUSTOMER_PAGES.map((source) => ({ source, headers: [...noindex, noReferrer] })),
      // The customer API (R1–R7) and email-code auth: /api/:path* above already sends X-Robots-Tag.
      ...CUSTOMER_API.map((source) => ({ source, headers: [noReferrer] })),
      // MCP Registry HTTP domain verification (public key only); serve as plain text.
      { source: '/.well-known/mcp-registry-auth', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
