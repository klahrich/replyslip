export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function errorCode(err: unknown, code: string): boolean {
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if ('code' in current && (current as { code?: unknown }).code === code) return true;
    if ('cause' in current) queue.push((current as { cause?: unknown }).cause);
  }
  return false;
}

export function isUniqueViolation(err: unknown): boolean {
  return errorCode(err, '23505');
}

export function isForeignKeyViolation(err: unknown): boolean {
  return errorCode(err, '23503');
}

/** 42P01: the query names a table that does not exist (for example before its migration is applied). */
export function isUndefinedTable(err: unknown): boolean {
  return errorCode(err, '42P01');
}
