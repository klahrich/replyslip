import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { sha256 } from './crypto';
import { getEmailSender } from './email';
import { HttpError } from './errors';
import { clientIp } from './origin';
import { consumeKeyedRateLimit } from './rate-limit';
import {
  EARLY_ACCESS_EMAIL_WINDOW_MS,
  EARLY_ACCESS_IP_LIMIT,
  INDUSTRIES,
  TEAM_SIZES,
  USES_GROK_BOT,
  VALETTO_EARLY_ACCESS_TO,
} from './valetto-constants';

const IP_KIND = 'valetto_early_access_ip';
const EMAIL_KIND = 'valetto_early_access_email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const CONTROL_SINGLE_LINE = /[\u0000-\u001f\u007f\u2028\u2029]/;
// Multi-line text may keep tabs and line breaks.
const CONTROL_MULTI_LINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type EarlyAccessField =
  | 'name'
  | 'email'
  | 'business'
  | 'website'
  | 'industry'
  | 'teamSize'
  | 'usesGrokBot'
  | 'customerJobs'
  | 'heardFrom';

export type EarlyAccessRequest = {
  name: string;
  email: string;
  business: string;
  website: string | null;
  industry: (typeof INDUSTRIES)[number];
  teamSize: (typeof TEAM_SIZES)[number];
  usesGrokBot: (typeof USES_GROK_BOT)[number];
  customerJobs: string;
  heardFrom: string | null;
};

export type EarlyAccessValidation =
  | { ok: true; value: EarlyAccessRequest }
  | { ok: false; errors: Partial<Record<EarlyAccessField, string>> };

type TextRule = {
  required: boolean;
  min?: number;
  max: number;
  multiLine?: boolean;
  missing: string;
  tooLong: string;
  pattern?: RegExp;
  invalid?: string;
};

const TEXT_RULES = {
  name: { required: true, max: 100, missing: 'Enter your name.', tooLong: 'Keep your name to 100 characters.' },
  email: {
    required: true,
    max: 254,
    missing: 'Enter your email.',
    tooLong: "That email doesn't look right.",
    pattern: EMAIL_RE,
    invalid: "That email doesn't look right.",
  },
  business: {
    required: true,
    max: 120,
    missing: 'Enter your business name.',
    tooLong: 'Keep the business name to 120 characters.',
  },
  website: {
    required: false,
    max: 200,
    missing: '',
    tooLong: 'Keep the website to 200 characters.',
    pattern: WEBSITE_RE,
    invalid: "That website doesn't look right.",
  },
  customerJobs: {
    required: true,
    max: 1000,
    multiLine: true,
    missing: 'Tell us what your customers would ask.',
    tooLong: 'Keep this to 1000 characters.',
  },
  heardFrom: { required: false, max: 200, missing: '', tooLong: 'Keep this to 200 characters.' },
} satisfies Record<string, TextRule>;

const ENUM_RULES = {
  industry: { values: INDUSTRIES, message: 'Pick the closest match.' },
  teamSize: { values: TEAM_SIZES, message: 'Pick your team size.' },
  usesGrokBot: { values: USES_GROK_BOT, message: 'Pick one.' },
} as const;

/** Re-checks every rule the form checks. Unknown keys are ignored. Strings are trimmed; empty optional text is null. */
export function validateEarlyAccess(input: unknown): EarlyAccessValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  const body = input as Record<string, unknown>;
  const errors: Partial<Record<EarlyAccessField, string>> = {};
  const value: Record<string, string | null> = {};

  for (const [field, rule] of Object.entries(TEXT_RULES) as [EarlyAccessField, TextRule][]) {
    const raw = body[field];
    if (raw === undefined || raw === null) {
      if (rule.required) errors[field] = rule.missing;
      else value[field] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      errors[field] = rule.required ? rule.missing : (rule.invalid ?? rule.tooLong);
      continue;
    }
    const text = raw.trim();
    if (text.length === 0) {
      if (rule.required) errors[field] = rule.missing;
      else value[field] = null;
      continue;
    }
    if (text.length > rule.max) {
      errors[field] = rule.tooLong;
      continue;
    }
    if ((rule.multiLine ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE).test(text)) {
      errors[field] = rule.invalid ?? 'Remove the special characters.';
      continue;
    }
    if (rule.pattern && !rule.pattern.test(text)) {
      errors[field] = rule.invalid ?? rule.missing;
      continue;
    }
    value[field] = text;
  }

  for (const [field, rule] of Object.entries(ENUM_RULES) as [EarlyAccessField, (typeof ENUM_RULES)[keyof typeof ENUM_RULES]][]) {
    const raw = body[field];
    if (typeof raw !== 'string' || !(rule.values as readonly string[]).includes(raw)) {
      errors[field] = rule.message;
      continue;
    }
    value[field] = raw;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: value as unknown as EarlyAccessRequest };
}

async function lockKey(tx: Db, kind: string, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${kind}:${key}`}, 0))`);
}

export async function consumeEarlyAccessIpLimit(req: Request): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const ip = clientIp(req);
  return getDb().transaction(async (tx) => {
    await lockKey(tx, IP_KIND, ip);
    return consumeKeyedRateLimit(tx, { kind: IP_KIND, key: ip, ...EARLY_ACCESS_IP_LIMIT });
  });
}

/**
 * Emails the request to Karim once per address per window. A repeat returns normally and sends nothing, so the
 * response never says whether the address signed up before. A failed send rolls back, so a retry can send.
 */
export async function submitEarlyAccess(request: EarlyAccessRequest): Promise<{ notified: boolean }> {
  // Hash, so rate_events never holds the submitter's address.
  const key = sha256(request.email.toLowerCase());
  return getDb().transaction(async (tx) => {
    await lockKey(tx, EMAIL_KIND, key);
    const seen = await consumeKeyedRateLimit(tx, {
      kind: EMAIL_KIND,
      key,
      limit: 1,
      windowMs: EARLY_ACCESS_EMAIL_WINDOW_MS,
    });
    if (seen.limited) return { notified: false };
    await getEmailSender().sendEarlyAccessNotice({
      to: VALETTO_EARLY_ACCESS_TO,
      replyTo: request.email,
      name: request.name,
      business: request.business,
      website: request.website,
      industry: request.industry,
      teamSize: request.teamSize,
      usesGrokBot: request.usesGrokBot,
      customerJobs: request.customerJobs,
      heardFrom: request.heardFrom,
      createdAt: new Date(),
    });
    return { notified: true };
  });
}
