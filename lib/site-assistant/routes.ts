import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { keyedHash } from '@/lib/crypto';
import { HttpError } from '@/lib/errors';
import { json, parseBody, readCookie, readJson } from '@/lib/http';
import { assertSameOrigin, clientIp, isHttpsRequest } from '@/lib/origin';
import { consumeRateLimit } from '@/lib/rate-limit';
import { SITE_MESSAGE_MAX_CHARS } from './config';
import {
  demoShot,
  demoView,
  newVisitorValue,
  postDemoMessage,
  resolveDemo,
  validVisitorValue,
  visitorCookieHeader,
  VISITOR_COOKIE,
  type PostMessageDeps,
} from './demo';
import { handleSite } from './http';

type TokenContext = { params: Promise<{ token: string }> };

/** The burst limits store a keyed hash of the IP in rate_events, never the raw IP. */
export function siteRateKey(req: Request): string {
  return keyedHash('site-rate', clientIp(req));
}

async function limit(req: Request, kind: 'siteEntry' | 'siteShot' | 'siteMessage'): Promise<void> {
  const rate = await consumeRateLimit({ kind, ip: siteRateKey(req) });
  if (rate.limited) {
    throw new HttpError(429, 'rate_limited', 'Too many requests. Try again later.', {
      retry_after_seconds: rate.retryAfterSeconds,
    });
  }
}

/** GET /api/v1/s/demo/:token: the demo page's one load (business, banner, checked suggestions, this visitor's messages). */
export function getDemoRoute(req: Request, context: TokenContext) {
  return handleSite(async () => {
    const { token } = await context.params;
    await limit(req, 'siteEntry');
    const demo = await resolveDemo(token);
    return json(await demoView(demo, validVisitorValue(readCookie(req, VISITOR_COOKIE))));
  });
}

// `text` is what LandingBot's page sends; `body` is accepted as the same field. client_message_id is required for
// typed messages and optional for suggested-question taps (the server makes one up; no replay then).
const messageSchema = z
  .object({
    client_message_id: z.uuid().optional(),
    text: z.string().optional(),
    body: z.string().optional(),
    suggested_question_id: z.uuid().optional(),
  })
  .strict()
  .refine((m) => !(m.text !== undefined && m.body !== undefined), { message: 'Send text or body, not both.' })
  .refine((m) => ((m.text ?? m.body) === undefined) !== (m.suggested_question_id === undefined), {
    message: 'Send exactly one of text or suggested_question_id.',
  })
  .refine((m) => m.suggested_question_id !== undefined || m.client_message_id !== undefined, {
    message: 'client_message_id is required.',
    path: ['client_message_id'],
  });

/** POST /api/v1/s/demo/:token/messages */
export function postDemoMessageRoute(req: Request, context: TokenContext, deps: PostMessageDeps = {}) {
  return handleSite(async () => {
    assertSameOrigin(req);
    const { token } = await context.params;
    const raw = await readJson(req);
    const demo = await resolveDemo(token);
    const body = parseBody(messageSchema, raw);
    let text: string | undefined;
    const typed = body.text ?? body.body;
    if (typed !== undefined) {
      text = typed.trim();
      if (!text) throw new HttpError(400, 'validation_error', 'The question is empty.');
      if (text.length > SITE_MESSAGE_MAX_CHARS) {
        throw new HttpError(400, 'message_too_long', `Keep your question to ${SITE_MESSAGE_MAX_CHARS} characters.`, {
          max_chars: SITE_MESSAGE_MAX_CHARS,
        });
      }
    }
    await limit(req, 'siteMessage');
    const existing = validVisitorValue(readCookie(req, VISITOR_COOKIE));
    const visitor = existing ?? newVisitorValue();
    const result = await postDemoMessage(
      demo,
      visitor,
      text !== undefined
        ? { clientMessageId: body.client_message_id!, text }
        : { clientMessageId: body.client_message_id ?? randomUUID(), suggestedQuestionId: body.suggested_question_id! },
      { ...deps, ip: deps.ip ?? clientIp(req) },
    );
    // A new visitor gets the cookie only when the conversation is theirs (not on a replay of someone else's message).
    const headers: HeadersInit =
      existing || !result.ownsConversation ? {} : { 'set-cookie': visitorCookieHeader(token, visitor, isHttpsRequest(req) || process.env.NODE_ENV === 'production') };
    return json({ message: result.message }, 200, headers);
  });
}

/** GET /s/demo/:token/shot/:kind. A bad, revoked or expired token is 404. */
export function getDemoShotRoute(req: Request, context: { params: Promise<{ token: string; kind: string }> }) {
  return handleSite(async () => {
    const { token, kind } = await context.params;
    if (kind !== 'desktop' && kind !== 'mobile') throw new HttpError(404, 'not_found', 'Not found.');
    await limit(req, 'siteShot');
    const demo = await resolveDemo(token, { expiredAs404: true });
    const shot = await demoShot(demo, kind);
    if (!shot) throw new HttpError(404, 'not_found', 'Not found.');
    return new Response(new Uint8Array(shot.bytes), {
      status: 200,
      headers: { 'content-type': shot.contentType, 'x-content-type-options': 'nosniff', 'content-length': String(shot.bytes.length) },
    });
  });
}
