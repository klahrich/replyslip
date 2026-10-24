import { createHmac } from 'node:crypto';
import { and, eq, or, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { users } from '@/db/schema';
import { safeEqualString } from './crypto';
import { HttpError } from './errors';

/** Checkbox wording is stored as proof. Longer copy is rejected. */
export const CONSENT_TEXT_MAX = 1000;

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ORIGIN = 'https://replyslip.com';

function unsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET?.trim();
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not set');
  return secret;
}

function signUserId(userId: string): string {
  return createHmac('sha256', unsubscribeSecret()).update(userId).digest('base64url');
}

/** `userId.hmac`. The id is not secret; the signature is what makes the link unforgeable. */
export function unsubscribeToken(userId: string): string {
  return `${userId}.${signUserId(userId)}`;
}

export function userIdFromUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const userId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!USER_ID_PATTERN.test(userId) || signature.length === 0) return null;
  if (!safeEqualString(signature, signUserId(userId))) return null;
  return userId;
}

/**
 * Absolute one-click unsubscribe link for a future marketing email.
 * Origin is `REPLYSLIP_URL` when that is set, otherwise https://replyslip.com.
 */
export function unsubscribeUrl(userId: string): string {
  const configured = process.env.REPLYSLIP_URL?.trim();
  const origin = (configured || PUBLIC_ORIGIN).replace(/\/$/, '');
  return `${origin}/api/v1/unsubscribe?token=${encodeURIComponent(unsubscribeToken(userId))}`;
}

/** The exact wording to store. Empty and oversized copy is not consent. */
export function consentTextForOptIn(value: string | undefined): string {
  const text = value?.trim() ?? '';
  if (text.length < 1 || text.length > CONSENT_TEXT_MAX) {
    throw new HttpError(
      400,
      'validation_error',
      'Consent text is required when opting in to marketing email.',
    );
  }
  return text;
}

/**
 * Record opt-in only when this user is not already opted in
 * (first sign-in, or they changed their mind after opting out).
 * A repeat opt-in leaves the original timestamp and wording alone.
 */
export async function recordMarketingOptIn(db: Db, userId: string, consentText: string): Promise<void> {
  await db
    .update(users)
    .set({
      marketingOptIn: true,
      marketingConsentAt: new Date(),
      marketingConsentText: consentText,
      marketingUnsubscribedAt: null,
    })
    .where(and(eq(users.id, userId), eq(users.marketingOptIn, false)));
}

/** Dashboard toggle. Opting in needs the checkbox wording. Opting out keeps the earlier proof. */
export async function setMarketingOptIn(userId: string, optIn: boolean, consentText?: string): Promise<void> {
  const text = optIn ? consentTextForOptIn(consentText) : null;
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(404, 'not_found', 'No user was found.');
  if (optIn) {
    if (user.marketingOptIn && user.marketingUnsubscribedAt === null && user.marketingConsentText === text) return;
    await db
      .update(users)
      .set({
        marketingOptIn: true,
        marketingConsentAt: new Date(),
        marketingConsentText: text,
        marketingUnsubscribedAt: null,
      })
      .where(eq(users.id, userId));
    return;
  }
  if (!user.marketingOptIn && user.marketingUnsubscribedAt) return;
  await db
    .update(users)
    .set({ marketingOptIn: false, marketingUnsubscribedAt: new Date() })
    .where(and(eq(users.id, userId), or(eq(users.marketingOptIn, true), isNull(users.marketingUnsubscribedAt))));
}

/** Valid token opts the user out. Already-out users stay out. Invalid tokens change nothing. */
export async function unsubscribeWithToken(token: string): Promise<boolean> {
  const userId = userIdFromUnsubscribeToken(token);
  if (!userId) return false;
  const db = getDb();
  const [user] = await db
    .select({ id: users.id, marketingOptIn: users.marketingOptIn })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return false;
  if (user.marketingOptIn) {
    await db
      .update(users)
      .set({ marketingOptIn: false, marketingUnsubscribedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.marketingOptIn, true)));
  }
  return true;
}

export function unsubscribePage(ok: boolean): Response {
  const title = ok ? 'Unsubscribed' : 'Link not valid';
  const message = ok
    ? 'You are unsubscribed from ReplySlip marketing emails. Sign-in codes are not affected.'
    : 'This unsubscribe link is not valid.';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
</head>
<body>
<h1>${title}</h1>
<p>${message}</p>
</body>
</html>
`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
