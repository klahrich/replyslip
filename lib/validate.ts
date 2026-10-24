import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { RESULT_SCHEMA_MAX_CHARS } from './constants';
import { HttpError } from './errors';

const ajv07 = new Ajv({ allErrors: true, strict: false, validateSchema: true });
const ajv2020 = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });

export type SchemaError = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
};

function compilerFor(schema: Record<string, unknown>) {
  const declared = typeof schema.$schema === 'string' ? schema.$schema : '';
  if (declared.includes('2020-12') || declared.includes('2019-09')) return ajv2020;
  return ajv07;
}

export function assertResultSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new HttpError(400, 'invalid_result_schema', 'result_schema must be a JSON Schema object.');
  }
  const record = schema as Record<string, unknown>;
  const encoded = JSON.stringify(record);
  if (encoded.length > RESULT_SCHEMA_MAX_CHARS) {
    throw new HttpError(400, 'invalid_result_schema', 'result_schema is too large.');
  }
  const ajv = compilerFor(record);
  try {
    const valid = ajv.validateSchema(record);
    if (!valid) {
      throw new HttpError(400, 'invalid_result_schema', 'result_schema is not a valid JSON Schema.', {
        validation_errors: mapErrors(ajv.errors),
      });
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'invalid_result_schema', 'result_schema is not a valid JSON Schema.');
  }
  return record;
}

export function validateResult(
  schema: Record<string, unknown>,
  data: unknown,
): { ok: true } | { ok: false; errors: SchemaError[] } {
  let validate: ValidateFunction;
  try {
    validate = compilerFor(schema).compile(schema);
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
