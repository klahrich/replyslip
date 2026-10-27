import type { MetadataRoute } from 'next';
import { agentDocs } from '@/lib/agent-docs';
import { SITE_URL } from '@/components/site/seo';

/** Public pages and the agent docs the backend serves. Never /dashboard, /sign-in or /api. */
export default function sitemap(): MetadataRoute.Sitemap {
  const { paths } = agentDocs;
  return ['/', '/agents', '/compare/harnessrouter', '/compare/agent-relay', '/sharing', '/privacy', '/terms', paths.llms, paths.skill, paths.gettingStarted, paths.api].map((path) => ({
    url: path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`,
  }));
}
