import { llmsTxt } from '@/lib/agent-docs';
import { servedOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return new Response(llmsTxt(servedOrigin(req)), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
