import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/errors';
import { allowedOrigins, assertSameOrigin, canonicalOrigin, configuredOrigins, publicOrigin } from '@/lib/origin';

const saved = process.env.APP_ORIGIN;
afterEach(() => {
  if (saved === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = saved;
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
