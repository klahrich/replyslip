import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/errors';
import {
  allowedOrigins,
  assertSameOrigin,
  canonicalOrigin,
  configuredCustomerOrigin,
  configuredOrigins,
  customerOrigin,
  publicOrigin,
  servedOrigin,
} from '@/lib/origin';

const saved = { app: process.env.APP_ORIGIN, customer: process.env.CUSTOMER_ORIGIN };
afterEach(() => {
  if (saved.app === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = saved.app;
  if (saved.customer === undefined) delete process.env.CUSTOMER_ORIGIN;
  else process.env.CUSTOMER_ORIGIN = saved.customer;
  vi.restoreAllMocks();
});

function hosted(host: string, extra: Record<string, string> = {}): Request {
  return req({ 'x-forwarded-host': host, 'x-forwarded-proto': 'https', ...extra }, `https://${host}/llms.txt`);
}

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

describe('servedOrigin (per-request docs)', () => {
  const LIST = 'https://replyslip.com,https://www.replyslip.com,https://valetto.tech';

  it('uses the request origin when it is listed', () => {
    process.env.APP_ORIGIN = LIST;
    expect(servedOrigin(hosted('www.replyslip.com'))).toBe('https://www.replyslip.com');
    expect(servedOrigin(hosted('valetto.tech'))).toBe('https://valetto.tech');
    expect(servedOrigin(hosted('replyslip.com'))).toBe('https://replyslip.com');
  });

  it('uses the canonical first entry for an unlisted or spoofed host', () => {
    process.env.APP_ORIGIN = LIST;
    expect(servedOrigin(hosted('evil.example'))).toBe('https://replyslip.com');
    expect(servedOrigin(hosted('replyslip-abc.vercel.app'))).toBe('https://replyslip.com');
    expect(servedOrigin(req({ host: 'valetto.tech' }, 'http://valetto.tech/llms.txt'))).toBe('https://replyslip.com');
    expect(servedOrigin(req({ host: 'replyslip.com', 'x-forwarded-host': 'evil.example' }))).toBe('https://replyslip.com');
  });

  it('uses the request origin when APP_ORIGIN is unset', () => {
    delete process.env.APP_ORIGIN;
    expect(servedOrigin(hosted('preview.example'))).toBe('https://preview.example');
  });
});

describe('customerOrigin', () => {
  it('parses CUSTOMER_ORIGIN: trimmed, trailing slash stripped, blank is unset', () => {
    expect(configuredCustomerOrigin(' https://valetto.tech/ ')).toBe('https://valetto.tech');
    expect(configuredCustomerOrigin('  ')).toBeNull();
    expect(configuredCustomerOrigin(undefined)).toBeNull();
  });

  it('unset: falls back to the canonical origin, then the request origin', () => {
    delete process.env.CUSTOMER_ORIGIN;
    process.env.APP_ORIGIN = 'https://replyslip.com,https://valetto.tech';
    expect(customerOrigin(hosted('valetto.tech'))).toBe('https://replyslip.com');
    delete process.env.APP_ORIGIN;
    expect(customerOrigin(hosted('preview.example'))).toBe('https://preview.example');
  });

  it('set and in the APP_ORIGIN list: used as is', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com, https://valetto.tech';
    process.env.CUSTOMER_ORIGIN = ' https://valetto.tech/ ';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(customerOrigin(hosted('replyslip.com'))).toBe('https://valetto.tech');
    expect(warn).not.toHaveBeenCalled();
  });

  it('set and APP_ORIGIN unset: used as is', () => {
    delete process.env.APP_ORIGIN;
    process.env.CUSTOMER_ORIGIN = 'https://valetto.tech';
    expect(customerOrigin(hosted('preview.example'))).toBe('https://valetto.tech');
  });

  it('set but not in the list: warns once and falls back to canonical without throwing', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com,https://www.replyslip.com';
    process.env.CUSTOMER_ORIGIN = 'https://unlisted-customer.example';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(customerOrigin(hosted('www.replyslip.com'))).toBe('https://replyslip.com');
    expect(customerOrigin(hosted('www.replyslip.com'))).toBe('https://replyslip.com');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('CUSTOMER_ORIGIN');
  });

  it('is not an extra allowed origin for the Origin check', () => {
    process.env.APP_ORIGIN = 'https://replyslip.com';
    process.env.CUSTOMER_ORIGIN = 'https://valetto.tech';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(badOrigin(req({ origin: 'https://valetto.tech' }))).toBe('bad_origin');
    delete process.env.APP_ORIGIN;
    expect(badOrigin(req({ origin: 'https://valetto.tech' }))).toBe('bad_origin');
  });
});
