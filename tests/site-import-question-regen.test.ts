import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRedbotBusinesses } from '@/lib/site-assistant/import';
import { faqPairs, MIN_SUGGESTED, regenerateQuestions } from '@/lib/site-assistant/question-regen';

// Made-up businesses shaped like RedBot's context files.

const faq = (pairs: [string, string][]) =>
  `## FAQ\n${pairs.map(([q, a]) => `- **Q:** ${q}\n  **A:** ${a}`).join('\n')}\n`;
const regen = (contextMd: string, kept: string[] = [], language: 'en' | 'fr' = 'en') =>
  regenerateQuestions(kept, { contextMd, language, displayName: 'Maple Studio' }).map((a) => a.question);

describe('rule 4: regeneration from the site', () => {
  it('leaves a business that already has enough alone', () => {
    const ctx = faq([['Do you teach beginners?', 'Yes, we teach complete beginners of every age.']]);
    expect(regen(ctx, ['A?', 'B?', 'C?'])).toEqual([]);
    expect(MIN_SUGGESTED).toBe(3);
  });

  it("uses the site's FAQ, but only questions its own answer actually answers", () => {
    const ctx = faq([
      ['FAQ: Do you teach beginners?', 'Yes, we teach complete beginners of every age.'],
      ['Can you recommend a videographer?', 'Eget enim ornare condimentum nibh congue at pulvinar egestas vel.'],
      ['Ready to talk details?', 'General pricing is shown on this website for every session.'],
      ['How much does a lesson cost?', 'Lessons cost $40 per half hour, paid by the month.'],
      ['When is the best time for maternity photos?', 'When is the best time for newborn photos.'],
      ['How long are sessions?', 'These are always included. Extended sessions are a different fee.'],
      ['When can I expect my photos?', 'We work very quickly here and plan our bookings around editing.'],
      ['How Do You Build Patios To Last Through Winters?', 'Patios last through winters with a deep compacted base.'],
      ['Are you planning a renovation project?', 'Our renovation team plans every project with you.'],
      ['Why do we process your data?', 'We process your data to answer your requests and send quotes.'],
      ['Do you use AI?', 'Grab yourself a snack, a hot cup of tea and settle in.'],
      ['2- Which styles do you teach?', 'We teach classical, jazz and pop styles on piano and guitar.'],
      ['Where do lessons take place?', 'Lessons take place in our Verdun studio or online.'],
    ]);
    // The lesson price is in its own answer, so it stays (rule 3 v4).
    expect(regen(ctx)).toEqual([
      'Do you teach beginners?',
      'How much does a lesson cost?',
      'Which styles do you teach?',
    ]);
  });

  it('adds a FAQ price question only when its own answer gives the price (rule 3 v4)', () => {
    const ctx =
      faq([
        ['How much does a deck cost?', 'Every deck is different, contact us for a quote.'],
        ['What are your rates?', 'We offer affordable pricing and free quotes.'],
        ['How much is a fence?', ''],
        ['What does a gutter cleaning cost?', 'Gutter cleaning runs $150–$250 for most homes.'],
        ['Do you charge for travel?', 'No, travel within the city is free.'],
      ]) +
      // A price elsewhere on the page doesn't answer a FAQ whose own answer has none.
      '## Pricing\n- Decks from $40 per square foot.\n';
    // "Affordable pricing and free quotes" doesn't price anything, but it does answer the free-estimate generic.
    expect(regen(ctx)).toEqual([
      'What does a gutter cleaning cost?',
      'Do you charge for travel?',
      'Do you offer free estimates?',
    ]);
  });

  it('keeps a FAQ timing question when the answer gives a time', () => {
    const ctx = faq([['When can I expect my photos?', 'Your photos are delivered within 2 weeks of your session.']]);
    expect(regen(ctx)).toEqual(['When can I expect my photos?']);
  });

  it('asks about short service names, keeping acronyms and skipping names, headings and prices', () => {
    const ctx =
      '## Services\n- Every inspection and piano lesson is done by a certified teacher or sweep.\n- Private Piano Lessons\n- WETT Inspection\n- Tremblant Photography\n- Lesson Pricing\n- type of event or session\n- Why choose us\n- Additional Services\n';
    expect(regen(ctx)).toEqual(['Do you offer private piano lessons?', 'Do you offer WETT inspection?']);
  });

  it('adds a generic question only with plain evidence, and stops at three', () => {
    expect(
      regen('## Hours\n- Monday to Friday 9 am - 5 pm\n## Pricing\n- Insurance\n- many years of experience\n'),
    ).toEqual(['What are your hours?']);
    expect(
      regen(
        '## Hours\n- 8am - 8pm daily\n## Service areas\n- Serving Kingston and Napanee since 2009\n- Fully insured and licensed\n',
        ['Do you clean chimneys?'],
      ),
    ).toEqual(['What are your hours?', 'What areas do you serve?']);
  });

  it('asks French businesses in French and runs the price rule on every candidate', () => {
    const ctx =
      faq([
        ['Combien coûte un ramonage ?', 'Un ramonage coûte 150 $ taxes incluses pour une cheminée.'],
        ['Quels sont vos tarifs ?', 'Nos tarifs sont compétitifs, contactez-nous pour une soumission gratuite.'],
        ['Offrez-vous des cours pour débutants ?', 'Oui, les cours pour débutants commencent chaque mois.'],
      ]) + '## Heures\n- Lundi au vendredi 7 h à 17 h\n';
    expect(regen(ctx, [], 'fr')).toEqual([
      'Combien coûte un ramonage ?',
      'Offrez-vous des cours pour débutants ?',
      "Quelles sont vos heures d'ouverture ?",
    ]);
  });

  it('reads Q/A pairs, including a missing answer', () => {
    expect(faqPairs('- **Q:** Do you travel?\n- **Q:** Do you teach online?\n  **A:** Yes, on Zoom.')).toEqual([
      { question: 'Do you travel?', answer: '' },
      { question: 'Do you teach online?', answer: 'Yes, on Zoom.' },
    ]);
  });

  it('the loader appends regenerated questions after the kept ones and records them', () => {
    const root = mkdtempSync(join(tmpdir(), 'site-regen-'));
    const context = join(root, 'context');
    mkdirSync(context);
    writeFileSync(
      join(context, 'maple.md'),
      `# Maple Studio\nSource: https://maple.example/\nLanguage: en\n\n## Suggested questions\n1. Ready to start?\n2. Do you teach beginners?\n\n` +
        `## Services\n- Private Piano Lessons\n- All piano lessons are one on one.\n\n` +
        faq([['Which styles do you teach?', 'We teach classical, jazz and pop styles on piano and guitar.']]),
    );
    const [maple] = loadRedbotBusinesses(context, join(root, 'shots'));
    expect(maple!.suggestedQuestions).toEqual([
      'Do you teach beginners?',
      'Which styles do you teach?',
      'Do you offer private piano lessons?',
    ]);
    expect(maple!.addedQuestions.map((a) => a.source)).toEqual(['faq', 'service']);
    expect(maple!.droppedQuestions.map((d) => d.question)).toEqual(['Ready to start?']);
  });
});
