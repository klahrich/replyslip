/**
 * Reading an input shape (spec 5.2 profile) for the form: labels, control kinds, and the same
 * field messages the server sends in `details.fields` (spec 15.6). The server's decision is final;
 * this only gives quick feedback.
 */
import type { ChoiceField, InputField, InputObject, InputSchema, InputValue, MultiChoiceField } from './types';

export type ControlKind = 'text' | 'textarea' | 'radio' | 'select' | 'number' | 'boolean' | 'multi';

/** `title`, or the key with `_` as spaces and the first letter capitalized. */
export function labelFor(key: string, field?: { title?: string }): string {
  if (field?.title) return field.title;
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isChoice(f: InputField): f is ChoiceField {
  return f.type === 'string' && Array.isArray((f as ChoiceField).enum);
}

/** Option values with their titles. Multi-choice titles may sit on the array or on `items`. */
export function optionsFor(f: ChoiceField | MultiChoiceField): { value: string; label: string }[] {
  const values = f.type === 'array' ? f.items.enum : f.enum;
  const titles = f.type === 'array' ? (f.items['x-enum-titles'] ?? f['x-enum-titles']) : f['x-enum-titles'];
  return values.map((value, i) => ({ value, label: titles?.[i] ?? value }));
}

export function controlFor(f: InputField): ControlKind {
  switch (f.type) {
    case 'boolean':
      return 'boolean';
    case 'number':
    case 'integer':
      return 'number';
    case 'array':
      return 'multi';
    case 'string':
      if (isChoice(f)) return f.enum.length <= 4 ? 'radio' : 'select';
      return f.maxLength > 120 ? 'textarea' : 'text';
  }
}

export function orderedFields(schema: InputSchema): [string, InputField][] {
  const order = schema['x-order']?.length ? schema['x-order'] : Object.keys(schema.properties);
  return order.filter((k) => schema.properties[k]).map((k) => [k, schema.properties[k]]);
}

const fmt = (n: number) => n.toLocaleString('en-CA');

export function rangeMessage(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `Must be between ${fmt(min)} and ${fmt(max)}.`;
  if (min !== undefined) return `Must be at least ${fmt(min)}.`;
  return `Must be ${fmt(max as number)} or less.`;
}

function patternOk(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(value);
  } catch {
    return true; // HTML/JS regex is only a hint; the server uses RE2.
  }
}

/** One message for one field value, or null when it passes. `undefined` means left empty. */
export function checkField(f: InputField, value: InputValue | undefined, required: boolean): string | null {
  const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) return required && f.type !== 'boolean' ? 'Required.' : null;
  switch (f.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Must be yes or no.';
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Must be a number.';
      if (f.type === 'integer' && !Number.isInteger(value)) return 'Must be a whole number.';
      if ((f.minimum !== undefined && value < f.minimum) || (f.maximum !== undefined && value > f.maximum)) return rangeMessage(f.minimum, f.maximum);
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return 'Pick from the list.';
      const allowed = new Set(f.items.enum);
      if (value.some((v) => !allowed.has(v))) return `Choose from: ${optionsFor(f).map((o) => o.label).join(', ')}.`;
      if (f.maxItems !== undefined && value.length > f.maxItems) return `Pick up to ${f.maxItems}.`;
      if (f.minItems !== undefined && value.length < f.minItems) return `Pick at least ${f.minItems}.`;
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return 'Must be text.';
      if (isChoice(f)) return f.enum.includes(value) ? null : `Choose one of: ${optionsFor(f).map((o) => o.label).join(', ')}.`;
      if (value.length > f.maxLength) return `Use ${fmt(f.maxLength)} characters or fewer.`;
      if (f.minLength !== undefined && value.length < f.minLength) return `Use at least ${fmt(f.minLength)} characters.`;
      if (f.pattern && !patternOk(f.pattern, value)) return "Doesn't match the expected format.";
      return null;
    }
  }
}

/** Server-style `details.fields` for a whole input object. `_form` holds unknown-key errors. */
export function checkInput(schema: InputSchema, input: InputObject): Record<string, string> {
  const fields: Record<string, string> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, f] of Object.entries(schema.properties)) {
    const msg = checkField(f, input[key], required.has(key));
    if (msg) fields[key] = msg;
  }
  const unknown = Object.keys(input).find((k) => !(k in schema.properties));
  if (unknown) fields._form = `Remove unknown field "${unknown}".`;
  return fields;
}

/** The label and plain-text value for one input field, as in `input_display` (spec 15.7). */
export function displayValue(f: InputField, value: InputValue): string {
  if (f.type === 'boolean') return value ? 'Yes' : 'No';
  if (f.type === 'number' || f.type === 'integer') return typeof value === 'number' ? fmt(value) : String(value);
  if (f.type === 'array') {
    const labels = new Map(optionsFor(f).map((o) => [o.value, o.label]));
    return (value as string[]).map((v) => labels.get(v) ?? v).join(', ');
  }
  if (isChoice(f)) return optionsFor(f).find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}
