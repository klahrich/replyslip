import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { POST as earlyAccess } from '@/app/api/valetto/early-access/route';
import { earlyAccessNoticeText, earlyAccessSubject, setEmailSenderForTests } from '@/lib/email';
import { EARLY_ACCESS_IP_LIMIT, VALETTO_EARLY_ACCESS_TO } from '@/lib/valetto-constants';
import { call, emailAddress } from './helpers';
import { earlyAccessNotices } from './inbox';

const URL = 'http://localhost/api/valetto/early-access';
let ipCounter = 0;

function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maya Chen',
    email: emailAddress('maya'),
    business: 'Acme Jewellers',
    website: 'acmejewellers.ca',
    industry: 'retail',
    teamSize: '2-10',
    usesGrokBot: 'yes',
    customerJobs: 'Render a custom ring from their choices, and check where an order is.',
    heardFrom: 'A friend on X',
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}, ip = freshIp()) {
  return call(earlyAccess, URL, { body, headers: { 'x-forwarded-for': ip, ...headers } });
}

afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe('POST /api/valetto/early-access', () => {
  it('returns exactly { ok: true } and emails karim@valetto.tech with the submitter as reply-to', async () => {
    const body = validBody({ email: '  Maya.Chen@Example.com ', unknownKey: 'ignored' });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });
    expect(res.res.headers.get('cache-control')).toBe('no-store');

    expect(earlyAccessNotices).toHaveLength(1);
    const notice = earlyAccessNotices[0]!;
    expect(notice.to).toBe(VALETTO_EARLY_ACCESS_TO);
    expect(notice.to).toBe('karim@valetto.tech');
    expect(notice.replyTo).toBe('Maya.Chen@Example.com');
    expect(notice).toMatchObject({
      name: 'Maya Chen',
      business: 'Acme Jewellers',
      website: 'acmejewellers.ca',
      industry: 'retail',
      teamSize: '2-10',
      usesGrokBot: 'yes',
      heardFrom: 'A friend on X',
    });
    expect(notice).not.toHaveProperty('unknownKey');
  });

  it('accepts null and empty optional fields', async () => {
    const res = await post(validBody({ website: null, heardFrom: '' }));
    expect(res.status).toBe(200);
    expect(earlyAccessNotices[0]).toMatchObject({ website: null, heardFrom: null });
  });

  it('returns a message per bad field, keyed by field name', async () => {
    const res = await post({
      name: '',
      email: 'not-an-email',
      business: 'b'.repeat(121),
      website: 'not a site',
      industry: 'farming',
      teamSize: 12,
      customerJobs: '   ',
      heardFrom: 'h'.repeat(201),
    });
    expect(res.status).toBe(400);
    expect(res.data.ok).toBe(false);
    expect(Object.keys(res.data.errors).sort()).toEqual(
      ['business', 'customerJobs', 'email', 'heardFrom', 'industry', 'name', 'teamSize', 'usesGrokBot', 'website'].sort(),
    );
    expect(res.data.errors.email).toBe("That email doesn't look right.");
    expect(res.data.errors.industry).toBe('Pick the closest match.');
    for (const message of Object.values(res.data.errors) as string[]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
    }
    expect(earlyAccessNotices).toHaveLength(0);
  });

  it('enforces the contract length limits at the boundary', async () => {
    const atLimit = await post(
      validBody({ name: 'n'.repeat(100), business: 'b'.repeat(120), customerJobs: 'c'.repeat(1000) }),
    );
    expect(atLimit.status).toBe(200);
    const over = await post(validBody({ name: 'n'.repeat(101), customerJobs: 'c'.repeat(1001) }));
    expect(over.status).toBe(400);
    expect(Object.keys(over.data.errors).sort()).toEqual(['customerJobs', 'name']);
    const longEmail = await post(validBody({ email: `${'a'.repeat(250)}@x.co` }));
    expect(longEmail.status).toBe(400);
    expect(Object.keys(longEmail.data.errors)).toEqual(['email']);
  });

  it('rejects control characters in single-line fields but keeps line breaks in customerJobs', async () => {
    const bad = await post(validBody({ name: 'Maya\r\nBcc: x@example.com' }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.data.errors)).toEqual(['name']);
    const ok = await post(validBody({ customerJobs: 'Track orders.\nRender rings.' }));
    expect(ok.status).toBe(200);
    expect(earlyAccessNotices.at(-1)?.customerJobs).toBe('Track orders.\nRender rings.');
  });

  it('accepts websites with or without a scheme and rejects bad ones', async () => {
    for (const website of ['https://acme.ca', 'http://shop.acme.co.uk/rings', 'acme.ca']) {
      expect((await post(validBody({ website }))).status).toBe(200);
    }
    for (const website of ['javascript:alert(1)', 'acme', 'https://acme.ca/ space']) {
      const res = await post(validBody({ website }));
      expect(res.status).toBe(400);
      expect(Object.keys(res.data.errors)).toEqual(['website']);
    }
  });

  it('rejects a body that is not a JSON object without an errors map', async () => {
    const res = await post(['not', 'an', 'object']);
    expect(res.status).toBe(400);
    expect(res.data.errors).toBeUndefined();
    const notJson = await call(earlyAccess, URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-forwarded-for': freshIp() },
    });
    expect(notJson.status).toBe(415);
  });

  it('rate-limits by IP, counting invalid submissions too', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < EARLY_ACCESS_IP_LIMIT.limit - 1; i += 1) {
      expect((await post({}, {}, ip)).status).toBe(400);
    }
    expect((await post(validBody(), {}, ip)).status).toBe(200);
    const limited = await post(validBody(), {}, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.data.errors).toBeUndefined();
    expect(earlyAccessNotices).toHaveLength(1);
    // Another IP is unaffected.
    expect((await post(validBody(), {}, '198.51.100.8')).status).toBe(200);
  });

  it('answers a repeat signup the same way and sends no second email', async () => {
    const email = emailAddress('repeat');
    const first = await post(validBody({ email }));
    const again = await post(validBody({ email: email.toUpperCase(), business: 'Other Co' }), {}, freshIp());
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.text).toBe(first.text);
    expect(again.res.headers.get('cache-control')).toBe(first.res.headers.get('cache-control'));
    expect(earlyAccessNotices).toHaveLength(1);
  });

  it('sends once when the same email is submitted concurrently', async () => {
    const email = emailAddress('race');
    const results = await Promise.all([1, 2, 3].map(() => post(validBody({ email }))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(earlyAccessNotices).toHaveLength(1);
  });

  it('does not store the submitter address in rate_events', async () => {
    const email = emailAddress('private');
    await post(validBody({ email }));
    const rows = await getDb().select().from(rateEvents);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.email).not.toContain('@');
  });

  it('lets a failed send be retried, and does not return ok', async () => {
    const email = emailAddress('retry');
    const sent: string[] = [];
    let fail = true;
    setEmailSenderForTests({
      async sendLoginCode() {},
      async sendFirstAgentAlert() {},
      async sendEarlyAccessNotice(message) {
        if (fail) throw new Error('resend down');
        sent.push(message.to);
      },
    });
    const original = console.error;
    console.error = () => {};
    try {
      const failed = await post(validBody({ email }));
      expect(failed.status).toBe(500);
      expect(failed.data.ok).toBeUndefined();
    } finally {
      console.error = original;
    }
    fail = false;
    const retried = await post(validBody({ email }));
    expect(retried.status).toBe(200);
    expect(sent).toEqual(['karim@valetto.tech']);
  });

  describe('Origin', () => {
    it('allows same-origin and Origin-less requests', async () => {
      expect((await post(validBody(), { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' })).status).toBe(200);
      expect((await post(validBody())).status).toBe(200);
    });

    it('rejects another site', async () => {
      const crossOrigin = await post(validBody(), { origin: 'https://evil.example' });
      expect(crossOrigin.status).toBe(403);
      expect(crossOrigin.data.error.code).toBe('bad_origin');
      const crossSite = await post(validBody(), { 'sec-fetch-site': 'cross-site' });
      expect(crossSite.status).toBe(403);
      expect(earlyAccessNotices).toHaveLength(0);
    });

    it('trusts only APP_ORIGIN when set (single value)', async () => {
      process.env.APP_ORIGIN = 'https://replyslip.com';
      expect((await post(validBody(), { origin: 'http://localhost' })).status).toBe(403);
      expect((await post(validBody(), { origin: 'https://replyslip.com' })).status).toBe(200);
      expect((await post(validBody(), { origin: 'https://valetto.tech' })).status).toBe(403);
    });

    it('accepts every entry of an APP_ORIGIN list, and nothing else', async () => {
      process.env.APP_ORIGIN = 'https://replyslip.com, https://www.replyslip.com ,https://valetto.tech/';
      for (const origin of ['https://replyslip.com', 'https://www.replyslip.com', 'https://valetto.tech']) {
        expect((await post(validBody(), { origin })).status, origin).toBe(200);
      }
      for (const origin of ['http://localhost', 'https://sub.valetto.tech', 'http://valetto.tech', 'https://evil.example']) {
        const res = await post(validBody(), { origin, 'x-forwarded-host': 'valetto.tech' });
        expect(res.status, origin).toBe(403);
        expect(res.data.error.code).toBe('bad_origin');
      }
      expect(
        (await post(validBody(), { origin: 'https://valetto.tech', 'sec-fetch-site': 'cross-site' })).status,
      ).toBe(403);
    });

    it('ignores a leftover VALETTO_ORIGIN', async () => {
      process.env.APP_ORIGIN = 'https://replyslip.com';
      process.env.VALETTO_ORIGIN = 'https://valetto.tech';
      try {
        expect((await post(validBody(), { origin: 'https://valetto.tech' })).status).toBe(403);
      } finally {
        delete process.env.VALETTO_ORIGIN;
      }
    });
  });
});

describe('early-access notice email', () => {
  const base = {
    replyTo: 'maya@example.com',
    name: 'Maya',
    business: 'Acme',
    website: null,
    industry: 'retail',
    teamSize: 'solo',
    usesGrokBot: 'not_yet',
    customerJobs: '<script>alert(1)</script>\nSecond line',
    heardFrom: null,
    createdAt: new Date('2026-10-29T12:00:00Z'),
  };

  it('is plain text and keeps subject and single-line fields on one line', () => {
    const subject = earlyAccessSubject({ business: 'Acme\r\nBcc: x@example.com' });
    expect(subject).not.toMatch(/[\r\n]/);
    const text = earlyAccessNoticeText({ ...base, name: 'Maya\nInjected: yes' });
    expect(text).toContain('Name: Maya Injected: yes');
    expect(text).not.toMatch(/^Injected:/m);
    expect(text).toContain('Website: none');
    expect(text).toContain('<script>alert(1)</script>\nSecond line');
  });
});
