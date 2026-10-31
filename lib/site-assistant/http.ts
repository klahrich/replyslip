import { HttpError } from '@/lib/errors';
import { jsonError } from '@/lib/http';
import { siteAssistantEnabled } from './config';

/** Every /s/* and /api/v1/s/* response, errors included (spec 2.5). next.config.ts sends the same two SEO headers. */
export const SITE_HEADERS = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
} as const;

/** Route wrapper: 404 while VALETTO_SITE_ASSISTANT is off, the error envelope, and SITE_HEADERS on everything. */
export async function handleSite(fn: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    if (!siteAssistantEnabled()) throw new HttpError(404, 'not_found', 'Not found.');
    response = await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      response = jsonError(err);
      if (err.status === 429 && typeof (err.details as { retry_after_seconds?: number } | undefined)?.retry_after_seconds === 'number') {
        response.headers.set('retry-after', String((err.details as { retry_after_seconds: number }).retry_after_seconds));
      }
    } else {
      console.error(err);
      response = jsonError(new HttpError(500, 'internal_error', 'Something went wrong.'));
    }
  }
  for (const [name, value] of Object.entries(SITE_HEADERS)) response.headers.set(name, value);
  return response;
}
