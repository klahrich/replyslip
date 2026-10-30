import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres', 'ajv'],
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
