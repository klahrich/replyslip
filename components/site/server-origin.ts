import { headers } from 'next/headers';
import { requestOrigin } from '@/lib/origin';

/** Public origin of the current request (same logic the generated docs use). */
export async function serverOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return requestOrigin(new Request(`${proto}://${host}/`, { headers: h }));
}
