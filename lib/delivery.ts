import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { AgentRow } from '@/db/schema';
import { DRIVER_ID_PATTERN, PANE_NAME_PATTERN } from './constants';
import { decryptSecret, encryptSecret } from './crypto';
import { HttpError } from './errors';
import { assertPublicWebhookUrl } from './webhook-url';

const BLOCKED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'cookie',
  'content-type',
  'authorization',
]);

const requiredSecret = z.string().min(1).max(2000);
const optionalSecret = z.union([z.string().max(2000), z.null()]).optional();

export const webhookAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: requiredSecret }),
  z.object({
    type: z.literal('hmac'),
    secret: requiredSecret,
  }),
  z.object({
    type: z.literal('headers'),
    headers: z.record(z.string(), z.string()).refine((headers) => Object.keys(headers).length > 0, {
      message: 'Provide at least one header.',
    }),
  }),
]);

/** PUT body. Omitted secrets stay stored. Empty string or null does not clear a secret the chosen auth type still needs. */
export const webhookAuthUpdateSchema = z.object({
  type: z.enum(['none', 'bearer', 'hmac', 'headers']),
  token: optionalSecret,
  secret: optionalSecret,
  headers: z.union([z.record(z.string(), z.string()), z.null()]).optional(),
});

const localTargetSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f]/.test(value), 'Target must be a single line.');

/** Orca's pane key is `tabId:leafId`: one colon, no whitespace, no control characters. */
const ORCA_PANE_KEY_PATTERN = /^[^\s:]+:[^\s:]+$/;
const ORCA_PANE_KEY_MESSAGE = 'The Orca pane key looks like tabId:leafId.';

function orcaPaneKey(target: string): boolean {
  return target.length <= 200 && !/[\u0000-\u001f]/.test(target) && ORCA_PANE_KEY_PATTERN.test(target);
}

const localDeliverySchema = z
  .object({
    mode: z.literal('local'),
    driver: z
      .string()
      .regex(DRIVER_ID_PATTERN, 'Driver id must be 1-32 lowercase letters, numbers, or hyphens.'),
    target: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.driver === 'orca') {
      if (!orcaPaneKey(value.target)) {
        ctx.addIssue({ code: 'custom', path: ['target'], message: ORCA_PANE_KEY_MESSAGE });
      }
      return;
    }
    const parsed = localTargetSchema.safeParse(value.target);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['target', ...issue.path], message: issue.message });
    }
  });

const legacyHerdrSchema = z
  .object({
    mode: z.literal('herdr'),
    pane: z.string().regex(PANE_NAME_PATTERN, 'Pane name must be 1-64 letters, numbers, dots, underscores, or hyphens.'),
  })
  .transform((value) => ({
    mode: 'local' as const,
    driver: 'herdr',
    target: value.pane,
  }));

const webhookDeliverySchema = z.object({
  mode: z.literal('webhook'),
  url: z.string().min(1).max(2000),
  auth: webhookAuthSchema,
});

export const deliveryInputSchema = z.union([
  z.object({ mode: z.literal('none') }),
  localDeliverySchema,
  legacyHerdrSchema,
  webhookDeliverySchema,
]);

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

export const deliveryUpdateSchema = z.union([
  z.object({ mode: z.literal('none') }),
  localDeliverySchema,
  legacyHerdrSchema,
  z.object({
    mode: z.literal('webhook'),
    url: z.union([z.string().max(2000), z.null()]).optional(),
    auth: webhookAuthUpdateSchema,
  }),
]);

export type DeliveryUpdate = z.infer<typeof deliveryUpdateSchema>;

export type StoredDelivery = {
  deliveryMode: 'none' | 'webhook' | 'local';
  webhookUrl: string | null;
  webhookAuthMode: string | null;
  webhookSecretCiphertext: string | null;
  webhookHeadersCiphertext: string | null;
  herdrPane: string | null;
  localDriver: string | null;
  localTarget: string | null;
};

const emptyLocal = { localDriver: null, localTarget: null, herdrPane: null };

export function deliveryColumns(input: DeliveryInput): StoredDelivery {
  if (input.mode === 'none') {
    return {
      deliveryMode: 'none',
      webhookUrl: null,
      webhookAuthMode: null,
      webhookSecretCiphertext: null,
      webhookHeadersCiphertext: null,
      ...emptyLocal,
    };
  }
  if (input.mode === 'local') {
    return {
      deliveryMode: 'local',
      webhookUrl: null,
      webhookAuthMode: null,
      webhookSecretCiphertext: null,
      webhookHeadersCiphertext: null,
      localDriver: input.driver,
      localTarget: input.target,
      herdrPane: input.driver === 'herdr' && PANE_NAME_PATTERN.test(input.target) ? input.target : null,
    };
  }

  const url = assertPublicWebhookUrl(input.url);
  const base: StoredDelivery = {
    deliveryMode: 'webhook',
    webhookUrl: url.toString(),
    webhookAuthMode: input.auth.type,
    webhookSecretCiphertext: null,
    webhookHeadersCiphertext: null,
    ...emptyLocal,
  };
  if (input.auth.type === 'bearer') {
    base.webhookSecretCiphertext = encryptSecret(input.auth.token);
  } else if (input.auth.type === 'hmac') {
    base.webhookSecretCiphertext = encryptSecret(input.auth.secret);
  } else if (input.auth.type === 'headers') {
    assertHeaderMap(input.auth.headers);
    base.webhookHeadersCiphertext = encryptSecret(JSON.stringify(input.auth.headers));
  }
  return base;
}

type ExistingDelivery = Pick<
  AgentRow,
  | 'deliveryMode'
  | 'webhookUrl'
  | 'webhookAuthMode'
  | 'webhookSecretCiphertext'
  | 'webhookHeadersCiphertext'
>;

function secretStillRequired(label: string): never {
  throw new HttpError(
    400,
    'secret_required',
    `${label} is still required for this auth type. An empty value does not clear it. Switch auth type to clear a secret that type no longer needs.`,
  );
}

function resolveRequiredSecret(input: {
  provided: string | null | undefined;
  sameKind: boolean;
  stored: string | null;
  label: string;
}): string {
  if (input.provided === undefined) {
    if (input.sameKind && input.stored) return input.stored;
    throw new HttpError(400, 'secret_required', `${input.label} is required.`);
  }
  if (input.provided === null || input.provided === '') secretStillRequired(input.label);
  if (input.provided.length > 2000) {
    throw new HttpError(400, 'validation_error', `${input.label} is too long.`);
  }
  return encryptSecret(input.provided);
}

/** Apply a delivery PUT. Omitted webhook secrets are copied from the stored ciphertext. */
export function applyDeliveryUpdate(existing: ExistingDelivery, input: DeliveryUpdate): StoredDelivery {
  if (input.mode !== 'webhook') return deliveryColumns(input);

  let urlString: string;
  if (input.url === undefined) {
    if (existing.deliveryMode !== 'webhook' || !existing.webhookUrl) {
      throw new HttpError(400, 'invalid_webhook_url', 'Webhook URL is required.');
    }
    urlString = assertPublicWebhookUrl(existing.webhookUrl).toString();
  } else if (input.url === null || input.url === '') {
    throw new HttpError(400, 'invalid_webhook_url', 'Webhook URL is required for webhook delivery.');
  } else {
    urlString = assertPublicWebhookUrl(input.url).toString();
  }

  const sameWebhook = existing.deliveryMode === 'webhook';
  const base: StoredDelivery = {
    deliveryMode: 'webhook',
    webhookUrl: urlString,
    webhookAuthMode: input.auth.type,
    webhookSecretCiphertext: null,
    webhookHeadersCiphertext: null,
    ...emptyLocal,
  };

  if (input.auth.type === 'bearer') {
    base.webhookSecretCiphertext = resolveRequiredSecret({
      provided: input.auth.token,
      sameKind: sameWebhook && existing.webhookAuthMode === 'bearer',
      stored: existing.webhookSecretCiphertext,
      label: 'Bearer token',
    });
  } else if (input.auth.type === 'hmac') {
    base.webhookSecretCiphertext = resolveRequiredSecret({
      provided: input.auth.secret,
      sameKind: sameWebhook && existing.webhookAuthMode === 'hmac',
      stored: existing.webhookSecretCiphertext,
      label: 'HMAC secret',
    });
  } else if (input.auth.type === 'headers') {
    if (input.auth.headers === undefined) {
      if (sameWebhook && existing.webhookAuthMode === 'headers' && existing.webhookHeadersCiphertext) {
        base.webhookHeadersCiphertext = existing.webhookHeadersCiphertext;
      } else {
        throw new HttpError(400, 'secret_required', 'Static headers are required.');
      }
    } else if (input.auth.headers === null || Object.keys(input.auth.headers).length === 0) {
      secretStillRequired('Static headers');
    } else {
      for (const value of Object.values(input.auth.headers)) {
        if (value === '') secretStillRequired('Header value');
      }
      assertHeaderMap(input.auth.headers);
      base.webhookHeadersCiphertext = encryptSecret(JSON.stringify(input.auth.headers));
    }
  }
  return base;
}

function assertHeaderMap(headers: Record<string, string>): void {
  const entries = Object.entries(headers);
  if (entries.length > 20) {
    throw new HttpError(400, 'invalid_webhook_headers', 'At most 20 static headers are allowed.');
  }
  for (const [name, value] of entries) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || BLOCKED_HEADERS.has(name.toLowerCase())) {
      throw new HttpError(400, 'invalid_webhook_headers', `Header "${name}" is not allowed.`);
    }
    if (value.length > 2000) {
      throw new HttpError(400, 'invalid_webhook_headers', `Header "${name}" is too long.`);
    }
  }
}

export type LocalNudge = { driver: string; target: string };

type DeliveryRow = Pick<
  AgentRow,
  | 'deliveryMode'
  | 'webhookUrl'
  | 'webhookAuthMode'
  | 'webhookSecretCiphertext'
  | 'webhookHeadersCiphertext'
  | 'herdrPane'
  | 'localDriver'
  | 'localTarget'
>;

/** Resolve a local nudge from the new columns or a legacy herdr row. */
export function localNudgeOf(agent: {
  deliveryMode: string;
  localDriver?: string | null;
  localTarget?: string | null;
  herdrPane?: string | null;
}): LocalNudge | null {
  if (agent.deliveryMode === 'local') {
    const driver = agent.localDriver?.trim() ?? '';
    const storedTarget = agent.localTarget?.trim() ?? '';
    const target = storedTarget || (driver === 'herdr' ? (agent.herdrPane ?? '') : '');
    if (!driver || !target) return null;
    return { driver, target };
  }
  if (agent.deliveryMode === 'herdr') {
    const target = agent.localTarget?.trim() || agent.herdrPane || '';
    if (!target) return null;
    return { driver: 'herdr', target };
  }
  return null;
}

export type SecretMask = { set: boolean; last4: string | null };

export type MaskedHeader = { name: string; value: SecretMask };

export type MaskedDelivery = {
  mode: 'none' | 'webhook' | 'local';
  driver: string | null;
  target: string | null;
  /** scheme://host only. The path is not returned. */
  url: string | null;
  url_set: boolean;
  url_path_last4: string | null;
  auth_type: string | null;
  secret_set: boolean;
  token: SecretMask;
  secret: SecretMask;
  headers: MaskedHeader[];
  /** Deprecated alias of `target` for local delivery. */
  pane: string | null;
};

const unsetSecret: SecretMask = { set: false, last4: null };

function maskSecret(value: string | null | undefined): SecretMask {
  if (!value) return unsetSecret;
  return { set: true, last4: value.slice(-4) };
}

function decryptOrNull(payload: string | null): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

export function maskWebhookUrl(raw: string | null): {
  url: string | null;
  url_set: boolean;
  url_path_last4: string | null;
} {
  if (!raw) return { url: null, url_set: false, url_path_last4: null };
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname;
    const url_path_last4 = path.length > 1 ? path.slice(-4) : null;
    return { url: `${parsed.protocol}//${parsed.host}`, url_set: true, url_path_last4 };
  } catch {
    return { url: null, url_set: true, url_path_last4: null };
  }
}

function maskedHeaders(ciphertext: string | null): MaskedHeader[] {
  const plain = decryptOrNull(ciphertext);
  if (!plain) return ciphertext ? [] : [];
  try {
    const parsed = JSON.parse(plain) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => ({ name, value: maskSecret(value) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function publicDelivery(agent: DeliveryRow): MaskedDelivery {
  const nudge = localNudgeOf(agent);
  const urlMask = maskWebhookUrl(agent.deliveryMode === 'webhook' ? agent.webhookUrl : null);
  if (nudge || agent.deliveryMode === 'local' || agent.deliveryMode === 'herdr') {
    return {
      mode: 'local',
      driver: nudge?.driver ?? (agent.deliveryMode === 'herdr' ? 'herdr' : agent.localDriver),
      target: nudge?.target ?? null,
      ...maskWebhookUrl(null),
      auth_type: null,
      secret_set: false,
      token: unsetSecret,
      secret: unsetSecret,
      headers: [],
      pane: nudge?.target ?? null,
    };
  }
  const auth = agent.deliveryMode === 'webhook' ? agent.webhookAuthMode : null;
  const storedSecret = (ciphertext: string | null): SecretMask => {
    if (!ciphertext) return unsetSecret;
    const plain = decryptOrNull(ciphertext);
    return plain === null ? { set: true, last4: null } : maskSecret(plain);
  };
  const token = auth === 'bearer' ? storedSecret(agent.webhookSecretCiphertext) : unsetSecret;
  const secret = auth === 'hmac' ? storedSecret(agent.webhookSecretCiphertext) : unsetSecret;
  const headers = auth === 'headers' ? maskedHeaders(agent.webhookHeadersCiphertext) : [];
  const secret_set = token.set || secret.set || headers.some((header) => header.value.set) || Boolean(agent.webhookHeadersCiphertext);
  return {
    mode: agent.deliveryMode === 'webhook' ? 'webhook' : 'none',
    driver: null,
    target: null,
    ...urlMask,
    auth_type: auth,
    secret_set,
    token,
    secret,
    headers,
    pane: null,
  };
}

export function whoamiDelivery(agent: DeliveryRow):
  | { mode: 'local'; driver: string; target: string }
  | { mode: 'webhook'; host: string }
  | { mode: 'none' } {
  const nudge = localNudgeOf(agent);
  if (nudge || agent.deliveryMode === 'local' || agent.deliveryMode === 'herdr') {
    return {
      mode: 'local',
      driver: nudge?.driver ?? (agent.deliveryMode === 'herdr' ? 'herdr' : agent.localDriver) ?? '',
      target: nudge?.target ?? '',
    };
  }
  if (agent.deliveryMode === 'webhook') {
    let host = '';
    if (agent.webhookUrl) {
      try {
        host = new URL(agent.webhookUrl).host;
      } catch {
        host = '';
      }
    }
    return { mode: 'webhook', host };
  }
  return { mode: 'none' };
}

export type WebhookCall = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export function buildWebhookCall(
  agent: AgentRow,
  body: string,
  wakeId: string,
): WebhookCall {
  if (agent.deliveryMode !== 'webhook' || !agent.webhookUrl) {
    throw new Error('Agent has no webhook delivery config');
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'ReplySlip/0.1',
    'x-replyslip-wake-id': wakeId,
  };
  if (agent.webhookAuthMode === 'bearer') {
    if (!agent.webhookSecretCiphertext) throw new Error('Webhook bearer token is missing');
    headers.authorization = `Bearer ${decryptSecret(agent.webhookSecretCiphertext)}`;
  } else if (agent.webhookAuthMode === 'hmac') {
    if (!agent.webhookSecretCiphertext) throw new Error('Webhook HMAC secret is missing');
    const secret = decryptSecret(agent.webhookSecretCiphertext);
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    headers['x-replyslip-signature'] = `sha256=${signature}`;
  } else if (agent.webhookAuthMode === 'headers') {
    if (!agent.webhookHeadersCiphertext) throw new Error('Webhook headers are missing');
    const parsed = JSON.parse(decryptSecret(agent.webhookHeadersCiphertext)) as Record<string, string>;
    for (const [name, value] of Object.entries(parsed)) {
      if (!BLOCKED_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
    }
  }
  headers['content-type'] = 'application/json';
  headers['x-replyslip-wake-id'] = wakeId;
  return { url: agent.webhookUrl, headers, body };
}
