/** Next.js server start hook: a malformed APP_ORIGIN fails here with a clear error. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { validateOriginConfig } = await import('./lib/origin');
  validateOriginConfig();
}
