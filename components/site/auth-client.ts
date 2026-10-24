/** Browser helpers for the sign-in routes in app/api/v1/auth. */

type ApiError = { error?: { code?: string; message?: string } };

export type AuthResult = { ok: true; message?: string } | { ok: false; code: string; message: string };

async function post(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const NETWORK_ERROR: AuthResult = {
  ok: false,
  code: 'network_error',
  message: 'We couldn’t reach ReplySlip. Check your connection and try again.',
};

function failure(status: number, data: unknown, messages: Record<string, string>): AuthResult {
  const err = (data as ApiError | null)?.error;
  const code = err?.code ?? (status === 429 ? 'rate_limited' : 'unknown');
  const message =
    messages[code] ??
    (status === 429
      ? 'Too many requests. Wait a few minutes and try again.'
      : err?.message ?? 'Something went wrong. Try again.');
  return { ok: false, code, message };
}

export async function requestSignInCode(email: string): Promise<AuthResult> {
  try {
    const { status, data } = await post('/api/v1/auth/request-code', { email });
    if (status === 200) return { ok: true, message: (data as { message?: string } | null)?.message };
    return failure(status, data, { validation_error: 'Enter a valid email address.' });
  } catch {
    return NETWORK_ERROR;
  }
}

export async function verifySignInCode(email: string, code: string): Promise<AuthResult> {
  try {
    const { status, data } = await post('/api/v1/auth/verify-code', { email, code });
    if (status === 200) return { ok: true };
    return failure(status, data, {
      invalid_code: 'That code isn’t right. Check the latest email and try again.',
      expired_code: 'That code has expired. Codes last 10 minutes. Send a new one.',
      code_exhausted: 'Too many wrong tries for this code. Send a new one.',
      code_already_used: 'That code was already used. Send a new one.',
      validation_error: 'Enter the email address the code was sent to.',
    });
  } catch {
    return NETWORK_ERROR;
  }
}
