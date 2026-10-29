/**
 * Offer input shape: a small, fixed profile of JSON Schema that can always be drawn as a form.
 *
 * Save time: checkInputSchema walks an allow-list, normalizes, and compiles, so a schema that
 * cannot compile is never stored. Create time: validateInput checks a guest's `input` with a
 * bounded cache of compiled validators. No server-only imports, so a browser form can reuse it.
 */
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { RE2JS } from 're2js';
import { HttpError } from './errors';
import {
  INPUT_DESCRIPTION_MAX,
  INPUT_ENUM_MAX,
  INPUT_ENUM_VALUE_MAX,
  INPUT_MAX_CHARS,
  INPUT_MAX_PROPERTIES,
  INPUT_PATTERN_MAX,
  INPUT_PROPERTY_PATTERN,
  INPUT_SCHEMA_MAX_CHARS,
  INPUT_STRING_MAX,
  INPUT_TITLE_MAX,
  INPUT_VALIDATOR_CACHE_MAX,
} from './constants';

export type InputSchemaRule =
  | 'too_large'
  | 'root_not_object'
  | 'root_keyword_not_allowed'
  | 'dialect_not_allowed'
  | 'additional_properties_must_be_false'
  | 'property_count'
  | 'bad_property_name'
  | 'required_invalid'
  | 'order_invalid'
  | 'text_too_long'
  | 'property_not_object'
  | 'property_type_not_allowed'
  | 'property_keyword_not_allowed'
  | 'string_needs_max_length'
  | 'max_length_too_large'
  | 'length_range_invalid'
  | 'pattern_invalid'
  | 'enum_invalid'
  | 'enum_titles_invalid'
  | 'range_invalid'
  | 'array_items_must_be_enum'
  | 'items_range_invalid'
  | 'default_invalid'
  | 'compile_failed';

export type InputSchemaProblem = { path: string; rule: InputSchemaRule; message: string };

export type InputError = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
};

export type InputSchema = Record<string, unknown>;

const ALLOWED_DIALECTS = new Set([
  'http://json-schema.org/draft-07/schema#',
  'http://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft/2020-12/schema',
]);
const ROOT_KEYS = new Set(['$schema', 'type', 'title', 'description', 'properties', 'required', 'additionalProperties', 'x-order']);
const COMMON_KEYS = ['type', 'title', 'description', 'default'];
const KIND_KEYS: Record<string, Set<string>> = {
  text: new Set([...COMMON_KEYS, 'maxLength', 'minLength', 'pattern']),
  choice: new Set([...COMMON_KEYS, 'enum', 'x-enum-titles']),
  number: new Set([...COMMON_KEYS, 'minimum', 'maximum']),
  boolean: new Set(COMMON_KEYS),
  multi: new Set([...COMMON_KEYS, 'items', 'minItems', 'maxItems', 'uniqueItems', 'x-enum-titles']),
};
const RESERVED_NAMES = new Set(['notes']);

/** Ajv's `code.regExp` hook. RE2 runs in linear time, so an owner pattern can't hang on stranger input. */
function re2(pattern: string): { test: (value: string) => boolean; toString: () => string } {
  const compiled = RE2JS.compile(pattern);
  // Ajv dedupes compiled patterns by toString(), so it must be unique per pattern.
  return { test: (value: string) => compiled.test(value), toString: () => `re2:${pattern}` };
}

function newAjv() {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateFormats: false,
    code: { regExp: re2 as never },
  });
  ajv.addKeyword({ keyword: 'x-order', schemaType: 'array' });
  ajv.addKeyword({ keyword: 'x-enum-titles', schemaType: 'array' });
  return ajv;
}

const ajv = newAjv();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function pointer(...parts: string[]): string {
  return parts.map((part) => `/${part.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

type Walk = { problems: InputSchemaProblem[] };

function problem(walk: Walk, path: string, rule: InputSchemaRule, message: string): void {
  walk.problems.push({ path, rule, message });
}

function checkText(walk: Walk, path: string, value: unknown, max: number, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > max) {
    problem(walk, path, 'text_too_long', `${label} must be a string of at most ${max} characters.`);
  }
}

function checkEnum(walk: Walk, path: string, values: unknown): values is string[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > INPUT_ENUM_MAX ||
    !values.every((v) => typeof v === 'string' && v.length >= 1 && v.length <= INPUT_ENUM_VALUE_MAX) ||
    new Set(values).size !== values.length
  ) {
    problem(
      walk,
      path,
      'enum_invalid',
      `enum must list 1-${INPUT_ENUM_MAX} unique strings, each 1-${INPUT_ENUM_VALUE_MAX} characters.`,
    );
    return false;
  }
  return true;
}

function checkEnumTitles(walk: Walk, path: string, titles: unknown, count: number): void {
  if (titles === undefined) return;
  if (
    !Array.isArray(titles) ||
    titles.length !== count ||
    !titles.every((t) => typeof t === 'string' && t.length >= 1 && t.length <= INPUT_TITLE_MAX)
  ) {
    problem(walk, path, 'enum_titles_invalid', `x-enum-titles must have ${count} strings, each 1-${INPUT_TITLE_MAX} characters.`);
  }
}

function kindOf(prop: Record<string, unknown>): keyof typeof KIND_KEYS | null {
  if (prop.type === 'string') return prop.enum !== undefined ? 'choice' : 'text';
  if (prop.type === 'number' || prop.type === 'integer') return 'number';
  if (prop.type === 'boolean') return 'boolean';
  if (prop.type === 'array') return 'multi';
  return null;
}

/** Returns the normalized property, or null when it has problems. */
function checkProperty(walk: Walk, name: string, raw: unknown): Record<string, unknown> | null {
  const path = pointer('properties', name);
  if (!isRecord(raw)) {
    problem(walk, path, 'property_not_object', 'Each property must be a JSON object.');
    return null;
  }
  const kind = kindOf(raw);
  if (!kind) {
    problem(
      walk,
      pointer('properties', name, 'type'),
      'property_type_not_allowed',
      'type must be "string", "number", "integer", "boolean", or "array" (multi-choice). Nested objects are not allowed.',
    );
    return null;
  }
  const before = walk.problems.length;
  const allowed = KIND_KEYS[kind]!;
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      problem(walk, pointer('properties', name, key), 'property_keyword_not_allowed', `${key} is not allowed on a ${kind} field.`);
    }
  }
  checkText(walk, pointer('properties', name, 'title'), raw.title, INPUT_TITLE_MAX, 'title');
  checkText(walk, pointer('properties', name, 'description'), raw.description, INPUT_DESCRIPTION_MAX, 'description');

  if (kind === 'text') {
    if (raw.maxLength === undefined) {
      problem(walk, pointer('properties', name), 'string_needs_max_length', 'A text field needs maxLength.');
    } else if (!isNonNegativeInteger(raw.maxLength) || raw.maxLength < 1 || raw.maxLength > INPUT_STRING_MAX) {
      problem(walk, pointer('properties', name, 'maxLength'), 'max_length_too_large', `maxLength must be an integer from 1 to ${INPUT_STRING_MAX}.`);
    }
    if (raw.minLength !== undefined) {
      const max = isNonNegativeInteger(raw.maxLength) ? raw.maxLength : INPUT_STRING_MAX;
      if (!isNonNegativeInteger(raw.minLength) || raw.minLength > max) {
        problem(walk, pointer('properties', name, 'minLength'), 'length_range_invalid', 'minLength must be a whole number no larger than maxLength.');
      }
    }
    if (raw.pattern !== undefined) {
      let ok = typeof raw.pattern === 'string' && raw.pattern.length >= 1 && raw.pattern.length <= INPUT_PATTERN_MAX;
      if (ok) {
        try {
          RE2JS.compile(raw.pattern as string);
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        problem(
          walk,
          pointer('properties', name, 'pattern'),
          'pattern_invalid',
          `pattern must be a regular expression of at most ${INPUT_PATTERN_MAX} characters that RE2 accepts (no lookaround or backreferences).`,
        );
      }
    }
  } else if (kind === 'choice') {
    if (checkEnum(walk, pointer('properties', name, 'enum'), raw.enum)) {
      checkEnumTitles(walk, pointer('properties', name, 'x-enum-titles'), raw['x-enum-titles'], raw.enum.length);
    }
  } else if (kind === 'number') {
    for (const key of ['minimum', 'maximum'] as const) {
      if (raw[key] !== undefined && !isFiniteNumber(raw[key])) {
        problem(walk, pointer('properties', name, key), 'range_invalid', `${key} must be a finite number.`);
      }
    }
    if (isFiniteNumber(raw.minimum) && isFiniteNumber(raw.maximum) && raw.minimum > raw.maximum) {
      problem(walk, pointer('properties', name, 'minimum'), 'range_invalid', 'minimum must not be larger than maximum.');
    }
  } else if (kind === 'multi') {
    const items = raw.items;
    let enumCount = 0;
    if (
      !isRecord(items) ||
      items.type !== 'string' ||
      Object.keys(items).some((key) => key !== 'type' && key !== 'enum') ||
      items.enum === undefined
    ) {
      problem(
        walk,
        pointer('properties', name, 'items'),
        'array_items_must_be_enum',
        'A multi-choice field needs items: { "type": "string", "enum": [...] } and nothing else.',
      );
    } else if (checkEnum(walk, pointer('properties', name, 'items', 'enum'), items.enum)) {
      enumCount = (items.enum as string[]).length;
      checkEnumTitles(walk, pointer('properties', name, 'x-enum-titles'), raw['x-enum-titles'], enumCount);
    }
    if (raw.uniqueItems !== undefined && raw.uniqueItems !== true) {
      problem(walk, pointer('properties', name, 'uniqueItems'), 'array_items_must_be_enum', 'uniqueItems must be true.');
    }
    for (const key of ['minItems', 'maxItems'] as const) {
      const value = raw[key];
      if (value !== undefined && (!isNonNegativeInteger(value) || (enumCount > 0 && value > enumCount))) {
        problem(walk, pointer('properties', name, key), 'items_range_invalid', `${key} must be a whole number no larger than the number of choices.`);
      }
    }
    if (isNonNegativeInteger(raw.minItems) && isNonNegativeInteger(raw.maxItems) && raw.minItems > raw.maxItems) {
      problem(walk, pointer('properties', name, 'minItems'), 'items_range_invalid', 'minItems must not be larger than maxItems.');
    }
  }
  if (walk.problems.length > before) return null;
  const normalized: Record<string, unknown> = { ...raw };
  if (kind === 'multi') normalized.uniqueItems = true;
  return normalized;
}

export type CheckedInputSchema = { ok: true; schema: InputSchema } | { ok: false; problems: InputSchemaProblem[] };

/** Save-time check. Returns the normalized schema to store, or every problem found. */
export function checkInputSchema(raw: unknown): CheckedInputSchema {
  const walk: Walk = { problems: [] };
  if (!isRecord(raw)) {
    return { ok: false, problems: [{ path: '', rule: 'root_not_object', message: 'input_schema must be a JSON object.' }] };
  }
  if (JSON.stringify(raw).length > INPUT_SCHEMA_MAX_CHARS) {
    return { ok: false, problems: [{ path: '', rule: 'too_large', message: `input_schema must be at most ${INPUT_SCHEMA_MAX_CHARS} characters of JSON.` }] };
  }
  if (raw.type !== 'object') {
    problem(walk, '/type', 'root_not_object', 'The root must have "type": "object".');
  }
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      problem(walk, pointer(key), 'root_keyword_not_allowed', `${key} is not allowed at the root of input_schema.`);
    }
  }
  if (raw.$schema !== undefined && (typeof raw.$schema !== 'string' || !ALLOWED_DIALECTS.has(raw.$schema))) {
    problem(walk, '/$schema', 'dialect_not_allowed', '$schema may be left out, or set to the draft-07 or 2020-12 URI.');
  }
  if (raw.additionalProperties !== undefined && raw.additionalProperties !== false) {
    problem(walk, '/additionalProperties', 'additional_properties_must_be_false', 'additionalProperties must be false or left out.');
  }
  checkText(walk, '/title', raw.title, INPUT_TITLE_MAX, 'title');
  checkText(walk, '/description', raw.description, INPUT_DESCRIPTION_MAX, 'description');

  const properties = raw.properties;
  const names = isRecord(properties) ? Object.keys(properties) : [];
  if (!isRecord(properties) || names.length < 1 || names.length > INPUT_MAX_PROPERTIES) {
    problem(walk, '/properties', 'property_count', `properties must be an object with 1-${INPUT_MAX_PROPERTIES} fields.`);
  }
  const normalizedProps: Record<string, unknown> = {};
  for (const name of names) {
    if (!INPUT_PROPERTY_PATTERN.test(name) || RESERVED_NAMES.has(name)) {
      problem(
        walk,
        pointer('properties', name),
        'bad_property_name',
        RESERVED_NAMES.has(name)
          ? `${name} is reserved. Notes are sent as description.`
          : 'Field names start with a lowercase letter, then lowercase letters, numbers, or underscores (max 40).',
      );
      continue;
    }
    const prop = checkProperty(walk, name, (properties as Record<string, unknown>)[name]);
    if (prop) normalizedProps[name] = prop;
  }

  const nameSet = new Set(names);
  if (raw.required !== undefined) {
    const req = raw.required;
    if (
      !Array.isArray(req) ||
      !req.every((r) => typeof r === 'string' && nameSet.has(r)) ||
      new Set(req).size !== req.length
    ) {
      problem(walk, '/required', 'required_invalid', 'required must list unique field names from properties.');
    }
  }
  let order = names;
  if (raw['x-order'] !== undefined) {
    const sent = raw['x-order'];
    if (
      !Array.isArray(sent) ||
      sent.length !== names.length ||
      new Set(sent).size !== sent.length ||
      !sent.every((n) => typeof n === 'string' && nameSet.has(n))
    ) {
      problem(walk, '/x-order', 'order_invalid', 'x-order must list every field in properties exactly once.');
    } else {
      order = sent as string[];
    }
  }
  if (walk.problems.length > 0) return { ok: false, problems: walk.problems };

  // Stored without $schema: one dialect (2020-12) is used for every input_schema.
  const normalized: InputSchema = { type: 'object' };
  if (raw.title !== undefined) normalized.title = raw.title;
  if (raw.description !== undefined) normalized.description = raw.description;
  normalized.properties = normalizedProps;
  if (Array.isArray(raw.required) && raw.required.length > 0) normalized.required = raw.required;
  normalized.additionalProperties = false;
  normalized['x-order'] = order;

  let validate: ValidateFunction;
  try {
    validate = compileOnce(normalized);
  } catch (err) {
    return {
      ok: false,
      problems: [{ path: '', rule: 'compile_failed', message: err instanceof Error ? err.message : 'input_schema could not be compiled.' }],
    };
  }
  for (const name of order) {
    const prop = normalizedProps[name] as Record<string, unknown>;
    if (prop.default === undefined) continue;
    const ok = validate({ [name]: prop.default });
    const fieldErrors = (validate.errors ?? []).filter(
      (error) => error.instancePath === `/${name}` || error.instancePath.startsWith(`/${name}/`),
    );
    if (!ok && fieldErrors.length > 0) {
      problem(walk, pointer('properties', name, 'default'), 'default_invalid', `default does not match the ${name} field.`);
    }
  }
  if (walk.problems.length > 0) return { ok: false, problems: walk.problems };
  return { ok: true, schema: normalized };
}

/** Compile without leaving the schema in Ajv's own identity-keyed cache. */
function compileOnce(schema: InputSchema): ValidateFunction {
  const validate = ajv.compile(schema);
  ajv.removeSchema(schema);
  return validate;
}

/** Least-recently-used map of compiled validators, keyed by the schema's JSON text. */
const validators = new Map<string, ValidateFunction>();

function cachedValidator(schema: InputSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = validators.get(key);
  if (hit) {
    validators.delete(key);
    validators.set(key, hit);
    return hit;
  }
  const validate = compileOnce(schema);
  validators.set(key, validate);
  while (validators.size > INPUT_VALIDATOR_CACHE_MAX) {
    const oldest = validators.keys().next().value;
    if (oldest === undefined) break;
    validators.delete(oldest);
  }
  return validate;
}

function mapErrors(errors: ErrorObject[] | null | undefined): InputError[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'is invalid',
    params: (error.params ?? {}) as Record<string, unknown>,
  }));
}

/** Create-time check of a guest's input against a stored input_schema. */
export function validateInput(schema: InputSchema, input: unknown): { ok: true } | { ok: false; errors: InputError[] } {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(input);
  } catch {
    encoded = undefined;
  }
  if (encoded === undefined || encoded.length > INPUT_MAX_CHARS) {
    return {
      ok: false,
      errors: [
        {
          instancePath: '',
          schemaPath: '',
          keyword: 'maxLength',
          message: `input must be at most ${INPUT_MAX_CHARS} characters of JSON`,
          params: { limit: INPUT_MAX_CHARS },
        },
      ],
    };
  }
  let validate: ValidateFunction;
  try {
    validate = cachedValidator(schema);
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          instancePath: '',
          schemaPath: '',
          keyword: 'schema',
          message: err instanceof Error ? err.message : 'input_schema could not be compiled',
          params: {},
        },
      ],
    };
  }
  if (validate(input)) return { ok: true };
  return { ok: false, errors: mapErrors(validate.errors) };
}

/** Test hooks: sizes of the validator LRU and of Ajv's internal schema cache. */
export function inputValidatorCacheSizeForTests(): { lru: number; ajv: number } {
  return { lru: validators.size, ajv: (ajv as unknown as { _cache: Map<unknown, unknown> })._cache.size };
}

export function clearInputValidatorCacheForTests(): void {
  validators.clear();
}

/** Offer-save guard: returns the normalized schema to store, or a 400 listing every problem. */
export function assertInputSchema(raw: unknown): InputSchema {
  const checked = checkInputSchema(raw);
  if (!checked.ok) {
    throw new HttpError(
      400,
      'invalid_input_schema',
      'input_schema does not fit the allowed form profile. See details.problems.',
      { problems: checked.problems },
    );
  }
  return checked.schema;
}
