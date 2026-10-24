import { replyslipScriptSha256Line } from '@/lib/replyslip-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(replyslipScriptSha256Line(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
