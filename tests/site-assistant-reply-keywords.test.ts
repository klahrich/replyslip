import { describe, expect, it } from 'vitest';
import { answerVisitorMessage } from '@/lib/site-assistant/answer';
import { findOwnerKeyword, splitSentences, timedBookingKeyword, ungroundedOwnerKeyword } from '@/lib/site-assistant/keywords';
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
- The small van is $77 per hour.
- There is no extra cost for seniors.
- Il n'y a aucun coût supplémentaire pour les aînés.
- Quotes are available in French.
- When booking, bring your ID.
- There are no additional delivery charges in town.
- Padding is included in the rental cost.
- Stairs come at no extra charge.
- Les imprévus, on vous le dit franchement dès la soumission.`;

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

describe('grounding one word does not let an invented price or time through', () => {
  const handoffs = [
    { reply: 'It costs forty dollars per visit.', sources: ['There is no extra cost for seniors.'] },
    { reply: 'Ça coûte quarante dollars par visite.', sources: ["Il n'y a aucun coût supplémentaire pour les aînés."], language: 'fr' as const },
    { reply: 'About 40 bucks per visit.', sources: ['There is no extra cost for seniors.'] },
    { reply: 'We are available this Saturday at 3pm.', sources: ['Quotes are available in French.'] },
    { reply: 'You can book us for tomorrow morning.', sources: ['When booking, bring your ID.'] },
    { reply: 'Quotes are available in French. We are available Monday.', sources: ['Quotes are available in French.'] },
    { reply: 'When booking, bring your ID. Booking opens at 15h30.', sources: ['When booking, bring your ID.'] },
  ];

  it.each(handoffs)('hands off: $reply', async ({ reply, sources, language }) => {
    const result = await ask('Tell me more', { reply, sources, topic: 'services', language: language ?? 'en' });
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'keyword_reply', body: needsOwnerReply(language ?? 'en') });
  });

  // The six phrasings from real answers, reused in synthetic replies.
  const passes = [
    { reply: 'Yes, there are no additional delivery charges in town.', sources: ['There are no additional delivery charges in town.'] },
    { reply: 'Padding is included in the rental cost.', sources: ['Padding is included in the rental cost.'] },
    { reply: 'Yes, stairs come at no extra charge.', sources: ['Stairs come at no extra charge.'] },
    { reply: 'Yes, quotes are available in French.', sources: ['Quotes are available in French.'] },
    { reply: 'When booking, bring your ID.', sources: ['When booking, bring your ID.'] },
    {
      reply: 'Les imprévus, on vous le dit franchement dès la soumission.',
      sources: ['Les imprévus, on vous le dit franchement dès la soumission.'],
      language: 'fr' as const,
    },
  ];

  it.each(passes)('still answers: $reply', async ({ reply, sources, language }) => {
    const result = await ask('Tell me more', { reply, sources, topic: 'services', language: language ?? 'en' });
    expect(result).toMatchObject({ status: 'answered', decidedBy: 'answered', body: reply });
  });
});

describe('currency words', () => {
  it.each([
    'forty dollars', 'one dollar', 'about 40 bucks', 'a buck', '40 CAD', 'USD only', 'une piasse', 'deux piasses',
    'une piastre', 'trois piastres', 'quarante DOLLARS', '40dollars', '40cad',
  ])('counts "%s" as a price, with no digit needed', (text) => {
    expect(findOwnerKeyword(text)?.category).toBe('currency');
    expect(ungroundedOwnerKeyword(text, [text])?.category).toBe('currency');
  });

  it.each(['the cadence is weekly', 'a belt buckle', 'USDA approved', 'Buckingham Street', 'les piasseurs'])(
    'only matches whole words: "%s"',
    (text) => {
      expect(findOwnerKeyword(text)).toBeNull();
    },
  );
});

describe('booking words next to a day, date or time', () => {
  const timed = [
    'available today', 'available tomorrow', 'book tonight', 'book this weekend', "disponible aujourd'hui",
    'disponible aujourd’hui', 'réserver demain', 'disponible ce soir', 'available Monday', 'available on SUNDAY',
    'disponible mardi', 'disponible samedi', 'available in January', 'book for December', 'réserver en février',
    'disponible en août', 'available at 3pm', 'available 3 p.m.', 'book for 10 am', 'disponible à 15h',
    'disponible à 3h', 'disponible à 15h30', 'available at 3:00', 'book at 14:30', 'available on the 12th',
    'available in 2 days',
  ];
  it.each(timed)('hands off "%s" even when the booking word is grounded', (text) => {
    expect(timedBookingKeyword(text)?.category).toBe('availability_booking');
    expect(ungroundedOwnerKeyword(text, ['quotes are available, when booking, disponible, reserver'])).not.toBeNull();
  });

  it.each([
    'Quotes are available in French.',
    'When booking, bring your ID.',
    'You may book online.',
    'Booking is easy. We have 3 trucks.',
    'We work Monday. Booking is by phone.',
  ])('keeps "%s": no day or time in the booking sentence', (text) => {
    expect(timedBookingKeyword(text)).toBeNull();
  });

  it('a day with no booking word is fine', () => {
    expect(timedBookingKeyword('We move furniture on Saturday at 3pm.')).toBeNull();
  });

  it('splits sentences on end punctuation and line breaks, not inside times or decimals', () => {
    expect(splitSentences('Booking is easy. Open at 3:00! Really? Yes; 2.5 hours\nNew line')).toEqual([
      'Booking is easy.', 'Open at 3:00!', 'Really?', 'Yes;', '2.5 hours', 'New line',
    ]);
  });
});
