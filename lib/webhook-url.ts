import { HttpError } from './errors';

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata.internal') return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map((part) => Number(part));
    if (parts.some((part) => part > 255)) return true;
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (host === '::1' || host === '::') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
}

export function assertPublicWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'invalid_webhook_url', 'Webhook URL must be an absolute http(s) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_webhook_url', 'Webhook URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'invalid_webhook_url', 'Put webhook credentials in the auth config, not the URL.');
  }
  if (!url.hostname) {
    throw new HttpError(400, 'invalid_webhook_url', 'Webhook URL must include a host.');
  }
  const allowPrivate = process.env.REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS === '1';
  if (!allowPrivate && isPrivateHostname(url.hostname)) {
    throw new HttpError(
      400,
      'invalid_webhook_url',
      'Webhook URL must be a public host. Private and loopback addresses are rejected.',
    );
  }
  if (raw.length > 2000) {
    throw new HttpError(400, 'invalid_webhook_url', 'Webhook URL is too long.');
  }
  return url;
}
