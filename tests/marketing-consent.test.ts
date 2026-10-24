import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as me, PATCH as patchMe } from '@/app/api/v1/auth/me/route';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route';
import { GET as unsubscribeGet, POST as unsubscribePost } from '@/app/api/v1/unsubscribe/route';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { MARKETING_CONSENT_TEXTS, unsubscribeUrl } from '@/lib/marketing';
import { call, emailAddress } from './helpers';
import { latestCode } from './inbox';

const WORDING = MARKETING_CONSENT_TEXTS[0];
const UNKNOWN_WORDING = 'Email me about new ReplySlip plans. I can unsubscribe at any time.';

async function userRow(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`no user for ${email}`);
  return row;
}

function unsubscribeRequestUrl(userId: string): string {
  const token = new URL(unsubscribeUrl(userId)).searchParams.get('token');
  if (!token) throw new Error('unsubscribeUrl did not include a token');
  return `http://localhost/api/v1/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function verify(email: string, extra: Record<string, unknown> = {}) {
  const code = latestCode(email);
  return call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
    body: { email, code, ...extra },
  });
}

describe('marketing consent', () => {
  it('defaults to false and does not record consent unless the person opts in', async () => {
    const email = emailAddress('consent-default');
    const requested = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    expect(requested.status).toBe(200);
    const created = await userRow(email);
    expect(created.marketingOptIn).toBe(false);
    expect(created.marketingConsentAt).toBeNull();
    expect(created.marketingConsentText).toBeNull();
    expect(created.marketingUnsubscribedAt).toBeNull();

    const verified = await verify(email);
    expect(verified.status).toBe(200);
    expect(verified.data.user.marketing_opt_in).toBe(false);
    const who = await call(me, 'http://localhost/api/v1/auth/me', { cookie: verified.cookie! });
    expect(who.status).toBe(200);
    expect(who.data.user.marketing_opt_in).toBe(false);
    const row = await userRow(email);
    expect(row.marketingOptIn).toBe(false);
    expect(row.marketingConsentAt).toBeNull();
    expect(row.marketingConsentText).toBeNull();
  });

  it('records the wording and timestamp on opt-in, and leaves that proof alone when the choice does not change', async () => {
    const email = emailAddress('consent-in');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const missing = await verify(email, { marketing_opt_in: true });
    expect(missing.status).toBe(400);
    expect(missing.data.error.code).toBe('validation_error');

    const before = Date.now();
    const verified = await verify(email, { marketing_opt_in: true, consent_text: `  ${WORDING}  ` });
    expect(verified.status).toBe(200);
    expect(verified.data.user.marketing_opt_in).toBe(true);
    const row = await userRow(email);
    expect(row.marketingOptIn).toBe(true);
    expect(row.marketingConsentText).toBe(WORDING);
    expect(row.marketingUnsubscribedAt).toBeNull();
    expect(row.marketingConsentAt).toBeInstanceOf(Date);
    expect(row.marketingConsentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.marketingConsentAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const unknown = await verify(email, { marketing_opt_in: true, consent_text: UNKNOWN_WORDING });
    expect(unknown.status).toBe(400);
    expect(unknown.data).toEqual({ error: 'invalid_consent_text' });
    const again = await verify(email, { marketing_opt_in: true, consent_text: WORDING });
    expect(again.status).toBe(200);
    expect(again.data.user.marketing_opt_in).toBe(true);
    const same = await userRow(email);
    expect(same.marketingConsentText).toBe(WORDING);
    expect(same.marketingConsentAt!.getTime()).toBe(row.marketingConsentAt!.getTime());

    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const declined = await verify(email, { marketing_opt_in: false });
    expect(declined.status).toBe(200);
    expect(declined.data.user.marketing_opt_in).toBe(true);
    expect((await userRow(email)).marketingConsentText).toBe(WORDING);
  });

  it('opts out from the session toggle and from a valid unsubscribe link, and rejects a tampered token', async () => {
    const email = emailAddress('consent-out');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const verified = await verify(email, { marketing_opt_in: true, consent_text: WORDING });
    expect(verified.status).toBe(200);
    const cookie = verified.cookie!;

    const bare = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      cookie,
      body: { marketing_opt_in: true },
    });
    expect(bare.status).toBe(400);
    expect((await userRow(email)).marketingConsentText).toBe(WORDING);

    const optedOut = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      cookie,
      body: { marketing_opt_in: false },
    });
    expect(optedOut.status).toBe(200);
    expect(optedOut.data.user.marketing_opt_in).toBe(false);
    const withdrawn = await userRow(email);
    expect(withdrawn.marketingOptIn).toBe(false);
    expect(withdrawn.marketingConsentText).toBe(WORDING);
    expect(withdrawn.marketingConsentAt).toBeInstanceOf(Date);
    expect(withdrawn.marketingUnsubscribedAt).toBeInstanceOf(Date);
    const who = await call(me, 'http://localhost/api/v1/auth/me', { cookie });
    expect(who.data.user.marketing_opt_in).toBe(false);

    const again = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      cookie,
      body: { marketing_opt_in: false },
    });
    expect(again.status).toBe(200);
    expect((await userRow(email)).marketingUnsubscribedAt!.getTime()).toBe(withdrawn.marketingUnsubscribedAt!.getTime());

    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const rejected = await verify(email, { marketing_opt_in: true, consent_text: UNKNOWN_WORDING });
    expect(rejected.status).toBe(400);
    expect(rejected.data).toEqual({ error: 'invalid_consent_text' });
    expect((await userRow(email)).marketingOptIn).toBe(false);
    const changed = await verify(email, { marketing_opt_in: true, consent_text: WORDING });
    expect(changed.status).toBe(200);
    expect(changed.data.user.marketing_opt_in).toBe(true);
    const changedRow = await userRow(email);
    expect(changedRow.marketingConsentText).toBe(WORDING);
    expect(changedRow.marketingUnsubscribedAt).toBeNull();
    expect(changedRow.marketingConsentAt!.getTime()).toBeGreaterThan(withdrawn.marketingConsentAt!.getTime());

    const badPatch = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      cookie,
      body: { marketing_opt_in: true, consent_text: UNKNOWN_WORDING },
    });
    expect(badPatch.status).toBe(400);
    expect(badPatch.data).toEqual({ error: 'invalid_consent_text' });
    expect((await userRow(email)).marketingConsentAt!.getTime()).toBe(changedRow.marketingConsentAt!.getTime());

    const restored = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      cookie,
      body: { marketing_opt_in: true, consent_text: WORDING },
    });
    expect(restored.status).toBe(200);
    expect(restored.data.user.marketing_opt_in).toBe(true);
    const back = await userRow(email);
    expect(back.marketingOptIn).toBe(true);
    expect(back.marketingUnsubscribedAt).toBeNull();
    expect(back.marketingConsentText).toBe(WORDING);
    expect(back.marketingConsentAt!.getTime()).toBe(changedRow.marketingConsentAt!.getTime());

    const link = unsubscribeRequestUrl(back.id);
    expect(unsubscribeUrl(back.id)).toMatch(/^https:\/\/replyslip\.com\/api\/v1\/unsubscribe\?token=/);
    const gone = await call(unsubscribeGet, link);
    expect(gone.status).toBe(200);
    expect(gone.res.headers.get('content-type')).toContain('text/html');
    expect(gone.text).toContain('You are unsubscribed from ReplySlip marketing emails.');
    const afterLink = await userRow(email);
    expect(afterLink.marketingOptIn).toBe(false);
    expect(afterLink.marketingConsentText).toBe(WORDING);
    expect(afterLink.marketingUnsubscribedAt).toBeInstanceOf(Date);
    const repeat = await call(unsubscribePost, link, { method: 'POST' });
    expect(repeat.status).toBe(200);
    expect(repeat.text).toContain('<h1>Unsubscribed</h1>');
    expect((await userRow(email)).marketingUnsubscribedAt!.getTime()).toBe(afterLink.marketingUnsubscribedAt!.getTime());

    const rejoined = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      cookie,
      body: { marketing_opt_in: true, consent_text: WORDING },
    });
    expect(rejoined.data.user.marketing_opt_in).toBe(true);

    const token = new URL(link).searchParams.get('token')!;
    const flipped = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    const tampered = await call(
      unsubscribeGet,
      `http://localhost/api/v1/unsubscribe?token=${encodeURIComponent(flipped)}`,
    );
    expect(tampered.status).toBe(400);
    expect(tampered.text).toContain('This unsubscribe link is not valid.');
    expect((await userRow(email)).marketingOptIn).toBe(true);

    const unknown = await call(unsubscribeGet, unsubscribeRequestUrl(randomUUID()));
    expect(unknown.status).toBe(400);
    expect((await userRow(email)).marketingOptIn).toBe(true);

    const signedOut = await call(patchMe, 'http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      body: { marketing_opt_in: false },
    });
    expect(signedOut.status).toBe(401);
  });
});
