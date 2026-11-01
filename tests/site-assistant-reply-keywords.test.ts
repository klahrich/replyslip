import { describe, expect, it } from 'vitest';
import { answerVisitorMessage } from '@/lib/site-assistant/answer';
import { ungroundedOwnerKeyword } from '@/lib/site-assistant/keywords';
import { needsOwnerReply } from '@/lib/site-assistant/replies';
import { answer, fakeModel, TEST_LLM_CONFIG } from './site-fixtures';

/** Synthetic business: every owner-only word below appears in its own page text, in a non-price, non-booking answer. */
const HARBOUR_CONTEXT = `# Harbour Lane Movers

Harbour Lane Movers is a small moving company in a made-up town.

- Tape and blankets come at no extra charge.
- Collect the hand trucks at our depot and skip the van charges.
- Washing the straps is part of the hire costs.
- Key drop-off is sorted out when booking.
- Site visits and quotes come in either language.
- Le stationnement se règle au moment de la soumission.
- The small van is $77 per hour.`;

const base = { businessName: 'Harbour Lane Movers', contextMd: HARBOUR_CONTEXT, history: [] };

async function ask(visitorMessage: string, out: Parameters<typeof answer>[0]) {
  const model = fakeModel(() => answer(out));
  return answerVisitorMessage({ ...base, visitorMessage }, { transport: model.transport, config: TEST_LLM_CONFIG });
}

describe('reply keyword rule only overrides words the kept sources do not back', () => {
  const grounded = [
    {
      question: 'Do you bring tape?',
      reply: 'Yes. Tape and blankets come at no extra charge.',
      sources: ['Tape and blankets come at no extra charge.'],
    },
    {
      question: 'Can I collect the hand trucks?',
      reply: 'Yes, and you skip the van charges.',
      sources: ['Collect the hand trucks at our depot and skip the van charges.'],
    },
    {
      // Singular in the reply, plural in the source.
      question: 'Do I wash the straps?',
      reply: 'No, washing is part of the hire cost.',
      sources: ['Washing the straps is part of the hire costs.'],
    },
    {
      question: 'Do I need to be there?',
      reply: 'Not always. Key drop-off is sorted out when booking.',
      sources: ['Key drop-off is sorted out when booking.'],
    },
    {
      question: 'Is there a bilingual service?',
      reply: 'Yes. Site visits and quotes come in either language.',
      sources: ['Site visits and quotes come in either language.'],
    },
    {
      question: 'Où se garer?',
      reply: 'Oui. Le stationnement se règle au moment de la soumission.',
      sources: ['Le stationnement se règle au moment de la soumission.'],
      language: 'fr' as const,
    },
  ];

  it.each(grounded)('keeps a grounded answer: $question', async ({ question, reply, sources, language }) => {
    const result = await ask(question, { reply, sources, topic: 'services', language: language ?? 'en' });
    expect(result).toMatchObject({ status: 'answered', decidedBy: 'answered', body: reply });
  });

  it('still hands off a keyword the sources do not use', async () => {
    const result = await ask('Do you bring tape?', {
      reply: 'Yes, and our prices are the lowest in town.',
      sources: ['Tape and blankets come at no extra charge.'],
    });
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'keyword_reply', body: needsOwnerReply('en') });
  });

  it('a grounded keyword does not cover another one in the same reply', async () => {
    const result = await ask('Do you bring tape?', {
      reply: 'Yes, at no extra charge. Book an appointment to get it.',
      sources: ['Tape and blankets come at no extra charge.'],
    });
    expect(result.decidedBy).toBe('keyword_reply');
  });

  it('always hands off a currency amount, even one quoted from the page', async () => {
    const result = await ask('What truck do you use?', {
      reply: 'The small van is $77 per hour.',
      sources: ['The small van is $77 per hour.'],
    });
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'keyword_reply' });
  });

  it('keeps genuine handoffs: price questions, owner topics and model needs_owner', async () => {
    const visitor = await ask('How much for a van?', { reply: 'It depends.', sources: ['Tape and blankets come at no extra charge.'] });
    expect(visitor.decidedBy).toBe('keyword_visitor');
    const topic = await ask('Is Tuesday open?', { topic: 'booking', reply: 'Key drop-off is sorted out when booking.', sources: ['Key drop-off is sorted out when booking.'] });
    expect(topic.decidedBy).toBe('owner_topic');
    const unsure = await ask('Do you move aquariums?', { status: 'needs_owner', reply: 'Not sure.', sources: [] });
    expect(unsure.decidedBy).toBe('model_needs_owner');
  });

  it('dropped sources do not ground a keyword', async () => {
    // The second quote is not in the page, so it is dropped and cannot vouch for "charge".
    const result = await ask('Do you bring tape?', {
      reply: 'Yes, at no extra charge.',
      sources: ['Harbour Lane Movers is a small moving company', 'Tape never carries a charge here.'],
    });
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'keyword_reply', sourcesDropped: ['Tape never carries a charge here.'] });
  });

  it('matches word families within the same category only', () => {
    expect(ungroundedOwnerKeyword('when you book', ['go over details when booking'])).toBeNull();
    expect(ungroundedOwnerKeyword('the price is fair', ['go over details when booking'])).toMatchObject({ category: 'price' });
    expect(ungroundedOwnerKeyword('no refund', ['no extra charge'])).toMatchObject({ category: 'complaint' });
  });
});
