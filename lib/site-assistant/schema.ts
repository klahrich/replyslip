import { z } from 'zod';

/** Answer schema v0.1 (spec 4.1). */
export const SITE_STATUSES = ['answered', 'needs_owner', 'off_topic'] as const;
export const SITE_TOPICS = [
  'general', 'hours_location', 'services', 'price', 'availability', 'booking', 'complaint', 'other',
] as const;
export const SITE_LANGUAGES = ['en', 'fr', 'other'] as const;
export const OWNER_ONLY_TOPICS = new Set<string>(['price', 'availability', 'booking', 'complaint']);

export const SITE_REPLY_MAX = 1_200;
export const SITE_SOURCE_MAX = 300;
export const SITE_SOURCES_MAX = 5;

/** Strict JSON schema sent to the provider (text.format json_schema, strict: true). */
export const SITE_ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reply', 'topic', 'sources', 'owner_question', 'language'],
  properties: {
    status: { type: 'string', enum: [...SITE_STATUSES] },
    reply: { type: 'string', description: `Shown to the visitor. At most ${SITE_REPLY_MAX} characters.` },
    topic: { type: 'string', enum: [...SITE_TOPICS] },
    sources: {
      type: 'array',
      maxItems: SITE_SOURCES_MAX,
      description: `Exact quotes copied from <business_context>, each at most ${SITE_SOURCE_MAX} characters.`,
      items: { type: 'string' },
    },
    owner_question: {
      type: ['string', 'null'],
      description: 'One sentence for the business owner when status is needs_owner, else null.',
    },
    language: { type: 'string', enum: [...SITE_LANGUAGES] },
  },
} as const;

/** Server-side validation: the provider's strict mode is not trusted. */
export const siteAnswerSchema = z
  .object({
    status: z.enum(SITE_STATUSES),
    reply: z.string().max(SITE_REPLY_MAX),
    topic: z.enum(SITE_TOPICS),
    sources: z.array(z.string().max(SITE_SOURCE_MAX)).max(SITE_SOURCES_MAX),
    owner_question: z.string().max(500).nullable(),
    language: z.enum(SITE_LANGUAGES),
  })
  .strict();

export type SiteModelAnswer = z.infer<typeof siteAnswerSchema>;
export type SiteLanguage = (typeof SITE_LANGUAGES)[number];
