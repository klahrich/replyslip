import { apiReferenceMarkdown } from '@/lib/agent-docs';
import { servedOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return new Response(apiReferenceMarkdown(servedOrigin(req)), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
