import { describe, expect, it } from 'vitest';
import { answerVisitorMessage, SITE_INSTRUCTIONS } from '@/lib/site-assistant/answer';
import { handoffReason } from '@/lib/site-assistant/rules';
import { needsOwnerReply, partialHandoffReply } from '@/lib/site-assistant/replies';
import { SITE_ANSWER_JSON_SCHEMA, siteAnswerSchema } from '@/lib/site-assistant/schema';
import { answer, fakeModel, MAPLE_CONTEXT, TEST_LLM_CONFIG } from './site-fixtures';

// A mixed question: one part the business's pages answer, one part only the business can (spec 4.2, partial handoff).
const base = { businessName: 'Maple Ridge Landscaping', contextMd: MAPLE_CONTEXT, history: [] };
const SERVICES = 'Interlock patios, walkways and driveways';
const PART = 'Yes, we build interlock patios, walkways and driveways.';

async function ask(visitorMessage: string, out: unknown, extra: { businessLanguage?: string } = {}) {
  const model = fakeModel(() => out);
  const result = await answerVisitorMessage({ ...base, ...extra, visitorMessage }, { transport: model.transport, config: TEST_LLM_CONFIG });
  return { result, calls: model.calls };
}

const mixed = (partial: Parameters<typeof answer>[0] = {}) =>
  answer({
    status: 'needs_owner',
    topic: 'price',
    reply: 'ignored',
    sources: [SERVICES],
    owner_question: 'The visitor wants a quote for an interlock patio.',
    answered_part: PART,
    ...partial,
  });

describe('mixed questions: answer what the pages cover, hand off the rest', () => {
  it('shows the answered part, then the fixed handoff line, on a keyword question', async () => {
    const { result, calls } = await ask('Do you build interlock patios, and how do I get a quote?', mixed());
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'needs_owner',
      decidedBy: 'keyword_visitor',
      body: partialHandoffReply(PART, 'en'),
      ownerQuestion: 'The visitor wants a quote for an interlock patio.',
      sourcesKept: [SERVICES],
    });
    expect(result.body).toBe(`${PART}\n\nFor the rest, I'll check with the team and get back to you.`);
    // The demo note still explains the handoff.
    expect(handoffReason(result.decidedBy)).toBe('owner_topic');
  });

  it('works the same without a keyword: an owner topic or a part the pages do not cover', async () => {
    const topic = await ask('Do you build interlock patios, and are you free next week?', mixed({ topic: 'availability' }));
    // "free next week" has no owner keyword: the model's topic decides.
    expect(topic.result).toMatchObject({ status: 'needs_owner', body: partialHandoffReply(PART, 'en') });
    const unknown = await ask('Do you build interlock patios? Do you also build ponds?', mixed({ topic: 'services' }));
    expect(unknown.result).toMatchObject({ status: 'needs_owner', decidedBy: 'model_needs_owner', body: partialHandoffReply(PART, 'en') });
    expect(handoffReason(unknown.result.decidedBy)).toBe('not_in_context');
  });

  it('puts the handoff line in the reply language', async () => {
    const part = 'Oui, nous faisons les patios en pavé uni.';
    const { result } = await ask('Faites-vous les patios en pavé uni, et comment avoir une soumission ?', mixed({ language: 'fr', answered_part: part }));
    expect(result.body).toBe(`${part}\n\nPour le reste, je vérifie avec l’équipe et je vous reviens.`);
  });

  it('hands off the whole question when nothing is answerable', async () => {
    const { result } = await ask('How much is a patio?', mixed({ answered_part: null, sources: [] }));
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'keyword_visitor', body: needsOwnerReply('en') });
    const blank = await ask('How much is a patio?', mixed({ answered_part: '   ' }));
    expect(blank.result.body).toBe(needsOwnerReply('en'));
  });

  it('just answers when everything is answerable (answered_part is ignored)', async () => {
    const { result } = await ask('What areas do you serve?', answer({ answered_part: 'Should not show.' }));
    expect(result).toMatchObject({ status: 'answered', body: 'We serve Ottawa, Kanata and Orleans.' });
  });

  describe('the answered part passes the same checks as an answer, else the whole question goes to the owner', () => {
    it('needs a quote found in the pages', async () => {
      const { result } = await ask('Do you build patios, and how much?', mixed({ sources: ['We build patios for free.'] }));
      expect(result).toMatchObject({ status: 'needs_owner', body: needsOwnerReply('en'), sourcesKept: [] });
    });

    it('never shows an invented price, availability or commitment', async () => {
      for (const part of [
        'Yes, we build interlock patios. A small one costs about $4,000.',
        'Yes, we build interlock patios, and we can book you in next Tuesday.',
        'Yes, we build interlock patios, with a free estimate.',
      ]) {
        const { result } = await ask('Do you build interlock patios, and how much?', mixed({ answered_part: part }));
        expect(result.body, part).toBe(needsOwnerReply('en'));
      }
    });

    it('never shows a URL, email or phone not in the pages', async () => {
      const bad = await ask('Do you build patios, and how much?', mixed({ answered_part: `${PART} Call 613-555-9999.` }));
      expect(bad.result.body).toBe(needsOwnerReply('en'));
      const good = await ask('Do you build patios, and how much?', mixed({ answered_part: `${PART} Call 613-555-0142.` }));
      expect(good.result.body).toBe(partialHandoffReply(`${PART} Call 613-555-0142.`, 'en'));
    });

    it('never answers a message in another language', async () => {
      const { result } = await ask('Patios?', mixed({ language: 'other' }));
      expect(result).toMatchObject({ decidedBy: 'language_other', body: needsOwnerReply('en') });
    });
  });

  it('a keyword question hit by the cost cap is handed off, not refused', async () => {
    const model = fakeModel(() => mixed());
    const result = await answerVisitorMessage(
      { ...base, visitorMessage: 'Do you build patios, and how much?' },
      { transport: model.transport, config: TEST_LLM_CONFIG, reserve: async () => ({ ok: false, decidedBy: 'cap_business_cost' }) },
    );
    expect(model.calls).toHaveLength(0);
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'keyword_visitor', body: needsOwnerReply('en'), llmCalled: false });
  });

  it('asks the model for answered_part, and still parses an output without it', async () => {
    expect(SITE_ANSWER_JSON_SCHEMA.required).toContain('answered_part');
    expect(SITE_INSTRUCTIONS).toMatch(/answered_part/);
    const legacy: Record<string, unknown> = { ...answer({}) };
    delete legacy.answered_part;
    expect(siteAnswerSchema.parse(legacy).answered_part).toBeNull();
    const model = fakeModel(() => legacy);
    const result = await answerVisitorMessage({ ...base, visitorMessage: 'What areas do you serve?' }, { transport: model.transport, config: TEST_LLM_CONFIG });
    expect(result.status).toBe('answered');
    expect(JSON.parse(model.calls[0]!.body).text.format.schema.required).toContain('answered_part');
  });
});
