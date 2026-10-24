import type { MetadataRoute } from 'next';

const agents = [
  '*',
  'GPTBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-User',
  'Google-Extended',
  'PerplexityBot',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'Applebot-Extended',
  'meta-externalagent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: agents.map((userAgent) => ({
      userAgent,
      allow: '/',
      disallow: ['/dashboard', '/dashboard/', '/api', '/api/'],
    })),
    sitemap: 'https://replyslip.com/sitemap.xml',
  };
}
