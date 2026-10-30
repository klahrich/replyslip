import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/errors';
import {
  allowedOrigins,
  assertSameOrigin,
  canonicalOrigin,
  configuredOrigins,
  publicOrigin,
  OriginConfigError,
  resetOriginWarningsForTests,
  validateOriginConfig,
} from '@/lib/origin';

const saved = process.env.APP_ORIGIN;
afterEach(() => {
  if (saved === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = saved;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetOriginWarningsForTests();
});

function req(headers: Record<string, string> = {}, url = 'http://localhost/api/v1/c/links/x/accept'): Request {
  return new Request(url, { method: 'POST', headers });
}

function badOrigin(r: Request): string | null {
  try {
    assertSameOrigin(r);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return (e as HttpError).code;
  }
}

describe('configuredOrigins', () => {
  it('parses a single value', () => {
    expect(configuredOrigins('https://replyslip.com')).toEqual(['https://replyslip.com']);
  });

  it('parses a list in order', () => {
    expect(configuredOrigins('https://replyslip.com,https://www.replyslip.com,https://valetto.tech')).toEqual([
      'https://replyslip.com',
      'https://www.replyslip.com',
      'https://valetto.tech',
    ]);
  });

  it('trims whitespace, strips trailing slashes, and drops empty entries', () => {
    expect(configuredOrigins('  https://a.example/ , ,https://b.example//,, \t')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('is empty when unset or blank', () => {
    expect(configuredOrigins(undefined)).toEqual([]);
    expect(configuredOrigins('')).toEqual([]);
    expect(configuredOrigins(' , ,')).toEqual([]);
  });
});

describe('canonical and public origin', () => {
  it('uses the first entry', () => {
    process.env.APP_ORIGIN = ' https://replyslip.com/ , https://valetto.tech';
    expect(canonicalOrigin()).toBe('https://replyslip.com');
    expect(publicOrigin(req({ host: 'valetto.tech', 'x-forwarded-proto': 'https' }))).toBe('https://replyslip.com');
  });

  it('falls back to the request origin when unset', () => {
    delete process.env.APP_ORIGIN;
    expect(canonicalOrigin()).toBeNull();
    expect(publicOrigin(req({ host: 'preview.example', 'x-forwarded-proto': 'https' }))).toBe('https://preview.example');
    expect(publicOrigin(req())).toBe('http://localhost');
  });

  it('treats a blank list as unset', () => {
    process.env.APP_ORIGIN = ' , ';
    expect(canonicalOrigin()).toBeNull();
    expect(allowedOrigins(req())).toEqual(['http://localhost']);
  });
});

describe('assertSameOrigin', () => {
  it('single value: allows it and refuses the request host', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com';
    expect(badOrigin(req({ origin: 'https://replyslip.com' }))).toBeNull();
    expect(badOrigin(req({ origin: 'http://localhost' }))).toBe('bad_origin');
  });

  it('list: allows every entry, exact match only', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com, https://www.replyslip.com/ ,https://valetto.tech';
    for (const origin of ['https://replyslip.com', 'https://www.replyslip.com', 'https://valetto.tech']) {
      expect(badOrigin(req({ origin })), origin).toBeNull();
    }
    for (const origin of [
      'https://evil.example',
      'https://valetto.tech.evil.example',
      'https://sub.valetto.tech',
      'http://valetto.tech',
      'https://valetto.tech:8443',
      'https://valetto.tech/',
      'https://replyslip.com,https://valetto.tech',
      'null',
      '',
    ]) {
      expect(badOrigin(req({ origin })), origin).toBe('bad_origin');
    }
  });

  it('mismatch: ignores X-Forwarded-Host when APP_ORIGIN is set', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com,https://valetto.tech';
    expect(badOrigin(req({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))).toBe(
      'bad_origin',
    );
  });

  it('refuses Sec-Fetch-Site: cross-site even from a listed origin', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com,https://valetto.tech';
    expect(badOrigin(req({ origin: 'https://valetto.tech', 'sec-fetch-site': 'cross-site' }))).toBe('bad_origin');
  });

  it('unset: the request origin only, as before', () => {
    delete process.env.APP_ORIGIN;
    expect(badOrigin(req({ origin: 'http://localhost' }))).toBeNull();
    expect(badOrigin(req({ origin: 'https://replyslip.com' }))).toBe('bad_origin');
    expect(badOrigin(req())).toBeNull();
  });
});

describe('origin config validation', () => {
  it('drops a literal null entry, so Origin: null never passes', () => {
    expect(configuredOrigins('null, https://replyslip.com ,null')).toEqual(['https://replyslip.com']);
    process.env.APP_ORIGIN = 'null,https://replyslip.com';
    expect(badOrigin(req({ origin: 'null' }))).toBe('bad_origin');
    process.env.APP_ORIGIN = 'null';
    expect(configuredOrigins()).toEqual([]);
    expect(badOrigin(req({ origin: 'null' }))).toBe('bad_origin');
  });

  for (const [label, entry] of [
    ['uppercase host', 'https://ReplySlip.com'],
    ['default port', 'https://replyslip.com:443'],
    ['a path', 'https://replyslip.com/app'],
    ['missing scheme', 'replyslip.com'],
    ['host:port without scheme', 'localhost:3000'],
    ['a query', 'https://replyslip.com?x=1'],
    ['garbage', 'not a url'],
  ] as const) {
    it(`APP_ORIGIN with ${label} fails with a clear error`, () => {
      expect(() => configuredOrigins(`https://ok.example,${entry}`)).toThrow(OriginConfigError);
      expect(() => configuredOrigins(entry)).toThrow(/APP_ORIGIN entry/);
      process.env.APP_ORIGIN = entry;
      expect(() => validateOriginConfig()).toThrow(OriginConfigError);
    });
  }

  it('names the canonical form in the error', () => {
    expect(() => configuredOrigins('https://ReplySlip.com:443')).toThrow('write it as "https://replyslip.com"');
  });

  it('accepts canonical origins, including a non-default port and http', () => {
    expect(configuredOrigins('https://replyslip.com,http://localhost:3000,https://valetto.tech/')).toEqual([
      'https://replyslip.com',
      'http://localhost:3000',
      'https://valetto.tech',
    ]);
    process.env.APP_ORIGIN = 'https://valetto.tech, https://www.valetto.tech/,https://replyslip.com';
    expect(() => validateOriginConfig()).not.toThrow();
  });
});

describe('APP_ORIGIN unset in production', () => {
  function unsetWarnings(warn: { mock: { calls: unknown[][] } }) {
    return warn.mock.calls.filter((c) => String(c[0]).includes('APP_ORIGIN is not set in production'));
  }

  it('warns once when NODE_ENV is production, and still works', () => {
    delete process.env.APP_ORIGIN;
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(publicOrigin(req())).toBe('http://localhost');
    expect(badOrigin(req({ origin: 'http://localhost' }))).toBeNull();
    configuredOrigins();
    expect(unsetWarnings(warn)).toHaveLength(1);
  });

  it('warns once when VERCEL_ENV is production', () => {
    process.env.APP_ORIGIN = ' , ';
    vi.stubEnv('VERCEL_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configuredOrigins();
    configuredOrigins();
    expect(unsetWarnings(warn)).toHaveLength(1);
  });

  it('does not warn outside production or when set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.APP_ORIGIN;
    vi.stubEnv('VERCEL_ENV', 'preview');
    configuredOrigins();
    process.env.APP_ORIGIN = 'https://replyslip.com';
    vi.stubEnv('VERCEL_ENV', 'production');
    configuredOrigins();
    expect(unsetWarnings(warn)).toHaveLength(0);
  });

  it('does not warn on a Vercel preview, which also runs NODE_ENV=production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.APP_ORIGIN;
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    configuredOrigins();
    expect(unsetWarnings(warn)).toHaveLength(0);
  });
});
