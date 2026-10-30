import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/errors';
import {
  RESULT_VALIDATOR_CACHE_MAX,
  assertResultSchema,
  clearResultValidatorCacheForTests,
  resultValidatorCacheSizeForTests,
  validateResult,
} from '@/lib/validate';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof HttpError ? err.code : 'threw';
  }
}

const score = { type: 'object', required: ['score'], properties: { score: { type: 'number' } } };

describe('result_schema checks', () => {
  it('rejects at save a schema that passes the meta-schema but cannot compile', () => {
    expect(codeOf(() => assertResultSchema({ type: 'object', properties: { a: { $ref: '#/definitions/missing' } } }))).toBe(
      'invalid_result_schema',
    );
    expect(codeOf(() => assertResultSchema({ $ref: 'https://example.com/remote.json' }))).toBe('invalid_result_schema');
  });

  it('accepts draft-07 and 2020-12 and validates with each', () => {
    for (const $schema of [undefined, 'http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft/2020-12/schema']) {
      const schema = { ...($schema ? { $schema } : {}), ...score };
      expect(assertResultSchema(schema)).toBe(schema);
      expect(validateResult(schema, { score: 1 })).toEqual({ ok: true });
      const bad = validateResult(schema, { score: 'high' });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.errors[0]).toMatchObject({ instancePath: '/score', keyword: 'type' });
    }
  });

  it('rejects 2019-09 with a clear message instead of an internal error', () => {
    try {
      assertResultSchema({ $schema: 'https://json-schema.org/draft/2019-09/schema', ...score });
      throw new Error('expected a rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe('invalid_result_schema');
      expect((err as HttpError).message).toContain('2019-09');
    }
  });

  it('still rejects a schema that breaks the meta-schema', () => {
    expect(codeOf(() => assertResultSchema({ type: 'nonsense' }))).toBe('invalid_result_schema');
    expect(codeOf(() => assertResultSchema([]))).toBe('invalid_result_schema');
  });

  it('compiles the same $id schema many times without a clash or cache growth', () => {
    clearResultValidatorCacheForTests();
    const before = resultValidatorCacheSizeForTests().ajv;
    const withId = { $id: 'https://replyslip.test/score.json', ...score };
    for (let i = 0; i < 1000; i += 1) {
      const copy = JSON.parse(JSON.stringify(withId));
      assertResultSchema(copy);
      expect(validateResult(copy, { score: i })).toEqual({ ok: true });
    }
    expect(resultValidatorCacheSizeForTests()).toEqual({ lru: 1, ajv: before });
  });

  it('bounds the validator cache', () => {
    clearResultValidatorCacheForTests();
    for (let i = 0; i < RESULT_VALIDATOR_CACHE_MAX + 20; i += 1) {
      validateResult({ type: 'object', properties: { score: { type: 'number', maximum: i } } }, { score: 0 });
    }
    expect(resultValidatorCacheSizeForTests().lru).toBe(RESULT_VALIDATOR_CACHE_MAX);
  });
});
