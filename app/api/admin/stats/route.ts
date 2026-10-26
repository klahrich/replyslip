import { loadUsageStats, parseStatsDays, statsAuthDecision } from '@/lib/admin-stats';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'x-robots-tag': 'noindex',
  'cache-control': 'no-store',
};

function privateJson(body: unknown, status: number): Response {
  return json(body, status, PRIVATE_HEADERS);
}

export async function GET(req: Request): Promise<Response> {
  try {
    const decision = statsAuthDecision(req.headers.get('authorization'), process.env.STATS_API_KEY);
    if (decision === 'off') {
      return privateJson({ error: { code: 'not_found', message: 'Not found.' } }, 404);
    }
    if (decision === 'unauthorized') {
      return privateJson({ error: { code: 'unauthorized', message: 'Unauthorized.' } }, 401);
    }
    const days = parseStatsDays(new URL(req.url).searchParams.get('days'));
    if (days === null) {
      return privateJson(
        { error: { code: 'validation_error', message: 'days must be an integer from 1 to 90.' } },
        400,
      );
    }
    return privateJson(await loadUsageStats({ days }), 200);
  } catch (err) {
    console.error(err);
    return privateJson({ error: { code: 'internal_error', message: 'Something went wrong.' } }, 500);
  }
}
