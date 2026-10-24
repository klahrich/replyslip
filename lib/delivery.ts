import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { AgentRow } from '@/db/schema';
import { PANE_NAME_PATTERN } from './constants';
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

export const deliveryInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal('herdr'),
    pane: z.string().regex(PANE_NAME_PATTERN, 'Pane name must be 1-64 letters, numbers, dots, underscores, or hyphens.'),
  }),
  z.object({
    mode: z.literal('webhook'),
    url: z.string().min(1).max(2000),
    auth: webhookAuthSchema,
  }),
]);

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

export type StoredDelivery = {
  deliveryMode: 'none' | 'webhook' | 'herdr';
  webhookUrl: string | null;
  webhookAuthMode: string | null;
  webhookSecretCiphertext: string | null;
  webhookHeadersCiphertext: string | null;
  herdrPane: string | null;
};

export function deliveryColumns(input: DeliveryInput): StoredDelivery {
  if (input.mode === 'none') {
    return {
      deliveryMode: 'none',
      webhookUrl: null,
      webhookAuthMode: null,
      webhookSecretCiphertext: null,
      webhookHeadersCiphertext: null,
      herdrPane: null,
    };
  }
  if (input.mode === 'herdr') {
    return {
      deliveryMode: 'herdr',
      webhookUrl: null,
      webhookAuthMode: null,
      webhookSecretCiphertext: null,
      webhookHeadersCiphertext: null,
      herdrPane: input.pane,
    };
  }

  const url = assertPublicWebhookUrl(input.url);
  const base: StoredDelivery = {
    deliveryMode: 'webhook',
    webhookUrl: url.toString(),
    webhookAuthMode: input.auth.type,
    webhookSecretCiphertext: null,
    webhookHeadersCiphertext: null,
    herdrPane: null,
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

export function publicDelivery(agent: Pick<
  AgentRow,
  | 'deliveryMode'
  | 'webhookUrl'
  | 'webhookAuthMode'
  | 'webhookSecretCiphertext'
  | 'webhookHeadersCiphertext'
  | 'herdrPane'
>) {
  return {
    mode: agent.deliveryMode,
    url: agent.webhookUrl,
    auth_type: agent.webhookAuthMode,
    secret_set: Boolean(agent.webhookSecretCiphertext || agent.webhookHeadersCiphertext),
    pane: agent.herdrPane,
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
