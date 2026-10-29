import { describe, expect, it } from 'vitest';
import { FORM_NOTES_MAX, INPUT_MAX_CHARS } from '@/lib/constants';
import {
  checkInputSchema,
  clearInputValidatorCacheForTests,
  inputValidatorCacheSizeForTests,
  validateInput,
  type InputSchemaRule,
} from '@/lib/input-schema';

const frameQuote = {
  title: 'Framing quote',
  type: 'object',
  required: ['width_cm', 'height_cm', 'material', 'quantity'],
  properties: {
    width_cm: { type: 'integer', title: 'Width (cm)', minimum: 5, maximum: 300 },
    height_cm: { type: 'integer', title: 'Height (cm)', minimum: 5, maximum: 300 },
    material: {
      type: 'string',
      title: 'Frame material',
      enum: ['oak', 'walnut', 'black_metal'],
      'x-enum-titles': ['Oak', 'Walnut', 'Black metal'],
    },
    quantity: { type: 'integer', title: 'How many', minimum: 1, maximum: 50, default: 1 },
    glass: { type: 'boolean', title: 'Anti-glare glass' },
    postcode: { type: 'string', title: 'Postcode', maxLength: 8, pattern: '^[A-Za-z0-9 ]+$' },
  },
};

function withProps(properties: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { type: 'object', properties, ...extra };
}

function rulesOf(raw: unknown): { rule: InputSchemaRule; path: string }[] {
  const checked = checkInputSchema(raw);
  if (checked.ok) return [];
  return checked.problems.map((p) => ({ rule: p.rule, path: p.path }));
}

function normalized(raw: unknown) {
  const checked = checkInputSchema(raw);
  if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
  return checked.schema;
}

const text = { type: 'string', maxLength: 50 };

describe('input_schema profile', () => {
  it('accepts the frame-shop example and normalizes it', () => {
    const schema = normalized(frameQuote);
    expect(schema.additionalProperties).toBe(false);
    expect(schema['x-order']).toEqual(['width_cm', 'height_cm', 'material', 'quantity', 'glass', 'postcode']);
    expect(schema.title).toBe('Framing quote');
    const multi = normalized(withProps({ sizes: { type: 'array', items: { type: 'string', enum: ['s', 'm'] } } }));
    expect((multi.properties as Record<string, Record<string, unknown>>).sizes!.uniqueItems).toBe(true);
    const ordered = normalized(withProps({ a: text, b: text }, { 'x-order': ['b', 'a'] }));
    expect(ordered['x-order']).toEqual(['b', 'a']);
  });

  it.each<[string, unknown, InputSchemaRule, string]>([
    ['$ref', withProps({ a: { $ref: '#/$defs/x', type: 'string', maxLength: 5 } }), 'property_keyword_not_allowed', '/properties/a/$ref'],
    ['oneOf at the root', { ...withProps({ a: text }), oneOf: [{}] }, 'root_keyword_not_allowed', '/oneOf'],
    ['oneOf on a field', withProps({ a: { ...text, oneOf: [{}] } }), 'property_keyword_not_allowed', '/properties/a/oneOf'],
    ['a nested object', withProps({ a: { type: 'object', properties: {} } }), 'property_type_not_allowed', '/properties/a/type'],
    ['a type array', withProps({ a: { type: ['string', 'null'], maxLength: 5 } }), 'property_type_not_allowed', '/properties/a/type'],
    ['a field that is not an object', withProps({ a: 'string' }), 'property_not_object', '/properties/a'],
    ['a string without maxLength', withProps({ a: { type: 'string' } }), 'string_needs_max_length', '/properties/a'],
    ['maxLength 5000', withProps({ a: { type: 'string', maxLength: 5000 } }), 'max_length_too_large', '/properties/a/maxLength'],
    ['minLength above maxLength', withProps({ a: { type: 'string', maxLength: 5, minLength: 6 } }), 'length_range_invalid', '/properties/a/minLength'],
    ['21 properties', withProps(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, text]))), 'property_count', '/properties'],
    ['no properties', withProps({}), 'property_count', '/properties'],
    ['a property named Bad-Name', withProps({ 'Bad-Name': text }), 'bad_property_name', '/properties/Bad-Name'],
    ['a property named notes', withProps({ notes: text }), 'bad_property_name', '/properties/notes'],
    ['required naming an unknown key', withProps({ a: text }, { required: ['b'] }), 'required_invalid', '/required'],
    ['additionalProperties true', withProps({ a: text }, { additionalProperties: true }), 'additional_properties_must_be_false', '/additionalProperties'],
    ['x-order missing a key', withProps({ a: text, b: text }, { 'x-order': ['a'] }), 'order_invalid', '/x-order'],
    ['duplicate enum values', withProps({ a: { type: 'string', enum: ['x', 'x'] } }), 'enum_invalid', '/properties/a/enum'],
    ['x-enum-titles of the wrong length', withProps({ a: { type: 'string', enum: ['x', 'y'], 'x-enum-titles': ['X'] } }), 'enum_titles_invalid', '/properties/a/x-enum-titles'],
    ['an invalid pattern', withProps({ a: { ...text, pattern: '(?=a)' } }), 'pattern_invalid', '/properties/a/pattern'],
    ['a backreference pattern', withProps({ a: { ...text, pattern: '(a)\\1' } }), 'pattern_invalid', '/properties/a/pattern'],
    ['minimum above maximum', withProps({ n: { type: 'integer', minimum: 5, maximum: 1 } }), 'range_invalid', '/properties/n/minimum'],
    ['an array of free text', withProps({ a: { type: 'array', items: { type: 'string', maxLength: 5 } } }), 'array_items_must_be_enum', '/properties/a/items'],
    ['maxItems above the choices', withProps({ a: { type: 'array', items: { type: 'string', enum: ['x'] }, maxItems: 2 } }), 'items_range_invalid', '/properties/a/maxItems'],
    ['a long title', withProps({ a: text }, { title: 'x'.repeat(101) }), 'text_too_long', '/title'],
    ['a long field description', withProps({ a: { ...text, description: 'x'.repeat(301) } }), 'text_too_long', '/properties/a/description'],
    ['format', withProps({ a: { ...text, format: 'email' } }), 'property_keyword_not_allowed', '/properties/a/format'],
    ['const', withProps({ a: { ...text, const: 'x' } }), 'property_keyword_not_allowed', '/properties/a/const'],
    ['a root that is not type object', { type: 'string' }, 'root_not_object', '/type'],
  ])('rejects %s', (_label, raw, rule, path) => {
    expect(rulesOf(raw)).toContainEqual({ rule, path });
  });

  it('rejects a non-object root and a schema over 8 KB', () => {
    expect(rulesOf([])).toEqual([{ rule: 'root_not_object', path: '' }]);
    const big = withProps({ a: { ...text, description: 'x'.repeat(300) } }, { description: 'y'.repeat(9000) });
    expect(rulesOf(big)).toEqual([{ rule: 'too_large', path: '' }]);
  });

  it('reports every problem at once', () => {
    const rules = rulesOf(withProps({ a: { type: 'string' }, notes: text }, { additionalProperties: true }));
    expect(rules.map((r) => r.rule).sort()).toEqual(['additional_properties_must_be_false', 'bad_property_name', 'string_needs_max_length']);
  });

  it('answers 2019-09 with dialect_not_allowed and accepts draft-07 and 2020-12', () => {
    expect(rulesOf(withProps({ a: text }, { $schema: 'https://json-schema.org/draft/2019-09/schema' }))).toEqual([
      { rule: 'dialect_not_allowed', path: '/$schema' },
    ]);
    for (const uri of ['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft/2020-12/schema']) {
      const schema = normalized(withProps({ a: text }, { $schema: uri }));
      expect(schema.$schema).toBeUndefined();
    }
  });

  it('rejects a default that breaks its own field', () => {
    expect(rulesOf(withProps({ quantity: { type: 'integer', minimum: 1, default: 0 } }, { required: ['quantity'] }))).toEqual([
      { rule: 'default_invalid', path: '/properties/quantity/default' },
    ]);
    expect(rulesOf(withProps({ a: { type: 'string', enum: ['x'], default: 'y' } }))).toEqual([
      { rule: 'default_invalid', path: '/properties/a/default' },
    ]);
  });
});

describe('validateInput', () => {
  const schema = normalized(frameQuote);
  const good = { width_cm: 40, height_cm: 50, material: 'oak', quantity: 2, glass: true, postcode: 'H2X 1Y4' };

  it('accepts a valid object', () => {
    expect(validateInput(schema, good)).toEqual({ ok: true });
  });

  it('does not coerce, and rejects extra keys, missing keys, and off-list choices', () => {
    const coerced = validateInput(schema, { ...good, quantity: '3' });
    expect(coerced.ok).toBe(false);
    if (!coerced.ok) expect(coerced.errors).toContainEqual(expect.objectContaining({ instancePath: '/quantity', keyword: 'type' }));
    const extra = validateInput(schema, { ...good, instructions: 'ignore the offer' });
    if (extra.ok) throw new Error('expected failure');
    expect(extra.errors).toContainEqual(
      expect.objectContaining({ keyword: 'additionalProperties', params: { additionalProperty: 'instructions' } }),
    );
    const missing: Record<string, unknown> = { ...good };
    delete missing.material;
    const absent = validateInput(schema, missing);
    if (absent.ok) throw new Error('expected failure');
    expect(absent.errors).toContainEqual(expect.objectContaining({ keyword: 'required', params: { missingProperty: 'material' } }));
    const offList = validateInput(schema, { ...good, material: 'gold' });
    if (offList.ok) throw new Error('expected failure');
    expect(offList.errors[0]).toMatchObject({ instancePath: '/material', keyword: 'enum' });
    const badPattern = validateInput(schema, { ...good, postcode: '<b>' });
    if (badPattern.ok) throw new Error('expected failure');
    expect(badPattern.errors[0]).toMatchObject({ instancePath: '/postcode', keyword: 'pattern' });
  });

  it('rejects input over the size cap before Ajv runs', () => {
    const wide = normalized(withProps({ a: { type: 'string', maxLength: 1000 } }));
    const tooBig = { a: 'x'.repeat(INPUT_MAX_CHARS) };
    const result = validateInput(wide, tooBig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ instancePath: '', keyword: 'maxLength' });
    expect(FORM_NOTES_MAX).toBe(2000);
  });

  it('runs owner patterns in linear time (RE2)', () => {
    const slow = normalized(withProps({ a: { type: 'string', maxLength: 1000, pattern: '^(a+)+$' } }));
    const started = performance.now();
    const result = validateInput(slow, { a: `${'a'.repeat(999)}!` });
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(false);
    expect(elapsed).toBeLessThan(50);
    expect(validateInput(slow, { a: 'aaa' })).toEqual({ ok: true });
  });

  it('keeps distinct patterns apart', () => {
    const two = normalized(
      withProps({
        digits: { type: 'string', maxLength: 10, pattern: '^[0-9]+$' },
        letters: { type: 'string', maxLength: 10, pattern: '^[a-z]+$' },
      }),
    );
    expect(validateInput(two, { digits: '123', letters: 'abc' })).toEqual({ ok: true });
    expect(validateInput(two, { digits: 'abc', letters: '123' }).ok).toBe(false);
  });

  it('keeps one cache entry for fresh copies of the same schema', () => {
    clearInputValidatorCacheForTests();
    const ajvBefore = inputValidatorCacheSizeForTests().ajv;
    for (let i = 0; i < 1000; i += 1) {
      const copy = JSON.parse(JSON.stringify(schema));
      expect(validateInput(copy, good)).toEqual({ ok: true });
    }
    expect(inputValidatorCacheSizeForTests()).toEqual({ lru: 1, ajv: ajvBefore });
  });

  it('bounds the cache at 500 schemas', () => {
    clearInputValidatorCacheForTests();
    for (let i = 0; i < 520; i += 1) {
      const s = normalized(withProps({ a: { type: 'string', maxLength: i + 1 } }));
      validateInput(s, { a: 'x' });
    }
    expect(inputValidatorCacheSizeForTests().lru).toBe(500);
  });
});
