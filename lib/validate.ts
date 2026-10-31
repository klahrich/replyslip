import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { RESULT_SCHEMA_MAX_CHARS } from './constants';
import { HttpError } from './errors';

/** Most compiled result validators kept in memory. Least recently used is dropped first. */
export const RESULT_VALIDATOR_CACHE_MAX = 500;

const ajv07 = new Ajv({ allErrors: true, strict: false, validateSchema: true });
const ajv2020 = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });

export type SchemaError = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
};

type Compiler = Ajv | Ajv2020;

function declaredDialect(schema: Record<string, unknown>): string {
  return typeof schema.$schema === 'string' ? schema.$schema : '';
}

/** draft-07 unless $schema names 2020-12. 2019-09 is refused in assertResultSchema, so it never reaches here. */
function compilerFor(schema: Record<string, unknown>): Compiler {
  return declaredDialect(schema).includes('2020-12') ? ajv2020 : ajv07;
}

/** Compile without leaving the schema (or its $id) in Ajv's registry, so repeat compiles neither grow nor clash. */
function compileOnce(ajv: Compiler, schema: Record<string, unknown>): ValidateFunction {
  try {
    return ajv.compile(schema);
  } finally {
    ajv.removeSchema(schema);
  }
}

function invalid(message: string, details?: unknown): HttpError {
  return new HttpError(400, 'invalid_result_schema', message, details);
}

export function assertResultSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw invalid('result_schema must be a JSON Schema object.');
  }
  const record = schema as Record<string, unknown>;
  const encoded = JSON.stringify(record);
  if (encoded.length > RESULT_SCHEMA_MAX_CHARS) {
    throw invalid('result_schema is too large.');
  }
  if (declaredDialect(record).includes('2019-09')) {
    throw invalid('result_schema uses draft 2019-09, which is not supported. Use draft-07 (the default) or 2020-12 in $schema.');
  }
  const ajv = compilerFor(record);
  try {
    const valid = ajv.validateSchema(record);
    if (!valid) {
      throw invalid('result_schema is not a valid JSON Schema.', { validation_errors: mapErrors(ajv.errors) });
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw invalid('result_schema is not a valid JSON Schema.');
  }
  // A schema can pass the meta-schema and still fail to compile (an unresolvable $ref, for one).
  // Catch that now, so no task or offer is saved with a schema complete_task can never satisfy.
  try {
    cachedValidator(record);
  } catch (err) {
    throw invalid(
      `result_schema could not be compiled: ${err instanceof Error ? err.message : 'unknown error'}. Schemas must be self-contained: no remote $ref.`,
    );
  }
  return record;
}

/**
 * Postgres jsonb does not keep object key order, so a stored result_schema loses the order its properties were
 * written in. Like input_schema, the root gets an `x-order` list (Ajv ignores the keyword): the sender's own
 * `x-order` when it sends one (unknown and repeated names dropped, missing ones appended), else the property order
 * of the JSON as sent. Call it on the parsed request, before the schema is stored. Schemas without root
 * `properties` are returned as is.
 */
export function withResultOrder(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return schema;
  const names = Object.keys(properties);
  const sent = Array.isArray(schema['x-order']) ? (schema['x-order'] as unknown[]) : [];
  const order: string[] = [];
  for (const name of sent) {
    if (typeof name === 'string' && names.includes(name) && !order.includes(name)) order.push(name);
  }
  for (const name of names) if (!order.includes(name)) order.push(name);
  return { ...schema, 'x-order': order };
}

/** The display order of a stored result_schema's root properties: x-order first, then any others. */
export function resultOrder(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const record = schema as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties) ? record.properties : {};
  const names = Object.keys(properties);
  const listed = Array.isArray(record['x-order'])
    ? (record['x-order'] as unknown[]).filter((key): key is string => typeof key === 'string' && names.includes(key))
    : [];
  return [...new Set(listed), ...names.filter((name) => !listed.includes(name))];
}

/** Least-recently-used compiled validators keyed by the schema's JSON text (which includes $schema). */
const validators = new Map<string, ValidateFunction>();

function cachedValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = validators.get(key);
  if (hit) {
    validators.delete(key);
    validators.set(key, hit);
    return hit;
  }
  const validate = compileOnce(compilerFor(schema), schema);
  validators.set(key, validate);
  while (validators.size > RESULT_VALIDATOR_CACHE_MAX) {
    const oldest = validators.keys().next().value;
    if (oldest === undefined) break;
    validators.delete(oldest);
  }
  return validate;
}

export function validateResult(
  schema: Record<string, unknown>,
  data: unknown,
): { ok: true } | { ok: false; errors: SchemaError[] } {
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
          message: err instanceof Error ? err.message : 'result_schema could not be compiled',
        },
      ],
    };
  }
  const ok = validate(data);
  if (ok) return { ok: true };
  return { ok: false, errors: mapErrors(validate.errors) };
}

function mapErrors(errors: ErrorObject[] | null | undefined): SchemaError[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'is invalid',
  }));
}

/** Test hooks: the LRU size and the size of each Ajv instance's own schema cache. */
export function resultValidatorCacheSizeForTests(): { lru: number; ajv: number } {
  const ajvSize = [ajv07, ajv2020].reduce(
    (sum, ajv) => sum + (ajv as unknown as { _cache: Map<unknown, unknown> })._cache.size,
    0,
  );
  return { lru: validators.size, ajv: ajvSize };
}

export function clearResultValidatorCacheForTests(): void {
  validators.clear();
}
