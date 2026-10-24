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

export const webhookAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('hmac'),
    secret: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal('headers'),
    headers: z.record(z.string(), z.string()).refine((headers) => Object.keys(headers).length > 0, {
      message: 'Provide at least one header.',
    }),
  }),
]);

const localTargetSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f]/.test(value), 'Target must be a single line.');

const localDeliverySchema = z.object({
  mode: z.literal('local'),
  driver: z
    .string()
    .regex(DRIVER_ID_PATTERN, 'Driver id must be 1-32 lowercase letters, numbers, or hyphens.'),
  target: localTargetSchema,
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

export const deliveryInputSchema = z.union([
  z.object({ mode: z.literal('none') }),
  localDeliverySchema,
  legacyHerdrSchema,
  z.object({
    mode: z.literal('webhook'),
    url: z.string().min(1).max(2000),
    auth: webhookAuthSchema,
  }),
]);

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

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

export function publicDelivery(agent: DeliveryRow) {
  const nudge = localNudgeOf(agent);
  if (nudge || agent.deliveryMode === 'local' || agent.deliveryMode === 'herdr') {
    return {
      mode: 'local' as const,
      driver: nudge?.driver ?? (agent.deliveryMode === 'herdr' ? 'herdr' : agent.localDriver),
      target: nudge?.target ?? null,
      url: null,
      auth_type: null,
      secret_set: false,
      pane: nudge?.target ?? null,
    };
  }
  return {
    mode: agent.deliveryMode,
    driver: null,
    target: null,
    url: agent.webhookUrl,
    auth_type: agent.webhookAuthMode,
    secret_set: Boolean(agent.webhookSecretCiphertext || agent.webhookHeadersCiphertext),
    pane: null,
  };
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
