import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getDb } from '@/db';
import { siteBusinesses } from '@/db/schema';
import type { SiteLlmConfig } from '@/lib/site-assistant/config';
import { createDemoLink } from '@/lib/site-assistant/demo';
import type { SiteLlmHttpRequest, SiteLlmTransport } from '@/lib/site-assistant/llm';
import type { SiteModelAnswer } from '@/lib/site-assistant/schema';

export const FIXTURE_DIR = join(__dirname, 'fixtures', 'site-demo');

export const TEST_LLM_CONFIG: SiteLlmConfig = {
  apiKey: 'test-not-a-real-key',
  model: 'test-model',
  fallbackModel: null,
  baseUrl: 'https://llm.invalid/v1',
  maxOutputTokens: 800,
  reasoningEffort: 'none',
  timeoutMs: 2_000,
  priceInPerM: 0.1,
  priceOutPerM: 0.5,
};

/** Fails the test if anything reaches for a real model. */
export const NO_MODEL: SiteLlmTransport = async () => {
  throw new Error('a test tried to call the model');
};

export function responsesPayload(output: unknown, usage = { input_tokens: 1_000, output_tokens: 100 }) {
  return {
    id: 'resp_test',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
      },
    ],
    usage,
  };
}

export function answer(partial: Partial<SiteModelAnswer>): SiteModelAnswer {
  return {
    status: 'answered',
    reply: 'We serve Ottawa, Kanata and Orleans.',
    topic: 'general',
    sources: ['serving Ottawa, Kanata and Orleans since 2009'],
    owner_question: null,
    language: 'en',
    ...partial,
  };
}

/** A fake Responses API that records every request and answers from `reply`. */
export function fakeModel(reply: (req: SiteLlmHttpRequest, n: number) => unknown = () => answer({})) {
  const calls: SiteLlmHttpRequest[] = [];
  const transport: SiteLlmTransport = async (req) => {
    calls.push(req);
    const out = reply(req, calls.length);
    if (out && typeof out === 'object' && 'httpStatus' in out) {
      const o = out as { httpStatus: number; text?: string };
      return { status: o.httpStatus, text: o.text ?? '' };
    }
    return { status: 200, text: JSON.stringify(responsesPayload(out)) };
  };
  return { transport, calls };
}

export const MAPLE_CONTEXT = `# Maple Ridge Landscaping

Maple Ridge Landscaping is a family-run landscaping company serving Ottawa, Kanata and Orleans since 2009.

## Services

- Interlock patios, walkways and driveways
- Snow removal for residential driveways (November to April)

We offer a 5-year workmanship warranty on all hardscaping projects.
We work Monday to Saturday, 7 am to 6 pm.
Contact: info@maple-ridge-landscaping.example or 613-555-0142.`;

export async function createSiteBusiness(overrides: Partial<typeof siteBusinesses.$inferInsert> = {}) {
  const slug = overrides.slug ?? `biz-${randomUUID().slice(0, 8)}`;
  const [business] = await getDb()
    .insert(siteBusinesses)
    .values({
      slug,
      displayName: 'Maple Ridge Landscaping',
      sourceUrl: 'https://maple-ridge-landscaping.example/',
      contextMd: MAPLE_CONTEXT,
      ...overrides,
    })
    .returning();
  return business!;
}

export async function createSiteDemo(overrides: Partial<typeof siteBusinesses.$inferInsert> = {}) {
  const business = await createSiteBusiness(overrides);
  const { token, link } = await createDemoLink(getDb(), business.id);
  return { business, token, link };
}
