import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoSuggestions } from '@/lib/site-assistant/demo';
import { loadRedbotBusinesses } from '@/lib/site-assistant/import';
import { applyQuestionRules, cleanContextText, cleanQuestionText } from '@/lib/site-assistant/question-rules';

// Cases are taken from RedBot's wave-3 hand-off (Nov 2026), trimmed.

const rulesOf = (questions: string[], contextMd: string, language: 'en' | 'fr' = 'en', displayName?: string) =>
  applyQuestionRules(questions, { contextMd, language, displayName });

describe('question cleanup', () => {
  it('decodes escapes and strips numbering and markdown, keeping French spacing', () => {
    expect(cleanQuestionText('Combien co\\u00fbtent vos services d\\u2019homme \\u00e0 tout faire ?', 'fr')).toBe(
      'Combien coûtent vos services d’homme à tout faire ?',
    );
    expect(cleanQuestionText('1\\. How does the consultation and installation process work?', 'en')).toBe(
      'How does the consultation and installation process work?',
    );
    expect(cleanQuestionText('Q. How long does the cleaning take?', 'en')).toBe('How long does the cleaning take?');
    expect(cleanQuestionText('Q1: Do you paint kitchen cabinets ?', 'en')).toBe('Do you paint kitchen cabinets?');
    expect(cleanQuestionText('▸ Can Turnbull Masonry handle commercial projects?', 'en')).toBe(
      'Can Turnbull Masonry handle commercial projects?',
    );
    expect(cleanQuestionText('What are the Most** **Common****Issues Found on Home Inspections?', 'en')).toBe(
      'What are the Most Common Issues Found on Home Inspections?',
    );
    expect(cleanQuestionText('It&#39;s 2 &amp; 3 floors&nbsp;up?', 'en')).toBe("It's 2 & 3 floors up?");
    expect(cleanQuestionText('Quels types de travaux faites-vous ?', 'fr')).toBe(
      'Quels types de travaux faites-vous ?',
    );
  });

  it('removes HTML comments and escapes from the context', () => {
    const md = [
      '## FAQ',
      '- <!-- https://example.ca/faq -->',
      '- **Q:** Have a Question?',
      '  **A:** <!-- https://example.ca/contact',
      '- Fully insured \\u2014 we\\/re WSIB covered &amp; bonded.',
    ].join('\n');
    expect(cleanContextText(md)).toBe(
      '## FAQ\n- **Q:** Have a Question?\n  **A:**\n- Fully insured — we/re WSIB covered & bonded.',
    );
  });

  it('keeps the text after a closing comment on the same line', () => {
    expect(
      cleanContextText('## Service areas\n<!-- note --> We serve Ottawa and Kanata.\n- <!-- src --> Barrhaven'),
    ).toBe('## Service areas\nWe serve Ottawa and Kanata.\n- Barrhaven');
    expect(cleanQuestionText('<!-- q3 --> Do you serve Orleans?', 'en')).toBe('Do you serve Orleans?');
  });

  it('drops a bracket inside a bracket', () => {
    expect(cleanQuestionText('Desservez-vous mon secteur (Longueuil (Montreal area) et environs)?', 'fr')).toBe(
      'Desservez-vous mon secteur (Longueuil et environs)?',
    );
    expect(cleanQuestionText('Do you serve my area (Ottawa (Orleans) and nearby)?', 'en')).toBe(
      'Do you serve my area (Ottawa and nearby)?',
    );
  });
});

describe('rule: not a visitor question', () => {
  const ctx = '## Services\n- Renovations.';
  it.each([
    'Ready to get started?',
    'Ready to Start Your Ottawa Renovation?',
    'Have a project in mind?',
    'Why Choose Us?',
    'Why Choose Westend Bath and Kitchen?',
    "Why Moodie's?",
    'Why Couples Are Choosing Film Wedding Photography?',
    'RIGHT FOR YOU?',
    'IS WATER COMING THROUGH YOUR BASEMENT WINDOW?',
    'What can we do for you?',
    'Not sure which service you need?',
    'Want To Dive Deeper?',
    'Did you know that we do more than bathrooms and kitchens?',
    'But did you know that Peterlepeintre.com // Peterthepainter.ca also paints not so usual objects in and around the house?',
    'What services do we offer for basement waterproofing?',
    'What Areas Do We Serve Around Napanee and Kingston?',
    'Our Services',
    'Need Waterproofing?',
    'Need help?',
    'Need a free quote for your project?',
    'Need roofing work done right?',
  ])('drops the heading or call to action %j', (question) => {
    expect(rulesOf([question], ctx).dropped).toEqual([{ question, rule: 'heading_or_cta' }]);
  });

  it.each([
    'Pourquoi Choisir Metropolispec ?',
    'Prêt à travailler avec nous ?',
    "Besoin d'un homme à tout faire fiable ?",
    'Besoin de travaux de toiture ou de revêtement bien faits?',
    "Besoin d'une soumission ?",
    'Vous préférez détailler vos travaux en ligne ?',
  ])('drops the French heading or call to action %j', (question) => {
    expect(rulesOf([question], ctx, 'fr').dropped).toEqual([{ question, rule: 'heading_or_cta' }]);
  });

  it.each([
    'Why should I choose Blindstore Ltd for my window treatments in Ottawa?',
    'Why do I need professional carpet cleaning?',
    'Why is my basement wet? What causes a wet basement?',
    'What Is the Pre-Construction Process?',
    'Can Turnbull Masonry handle commercial projects?',
    'Need a permit for a fence?',
    'Need to replace just one window, or the whole frame?',
  ])('keeps the visitor question %j', (question) => {
    expect(rulesOf([question], ctx).kept).toEqual([question]);
  });

  it('drops privacy text and login text', () => {
    expect(rulesOf(['How does the Company collect personal information?'], ctx).dropped).toEqual([
      {
        question: 'How does the Company collect personal information?',
        rule: 'policy_or_privacy',
      },
    ]);
    expect(rulesOf(['Have an account?'], ctx, 'fr').dropped).toEqual([
      { question: 'Have an account?', rule: 'login_or_account' },
    ]);
    expect(rulesOf(['Avez-vous un compte client à créer ?'], ctx, 'fr').dropped[0]?.rule).toBe('login_or_account');
  });

  it("drops a question in another language than the business's, keeps one too short to tell", () => {
    const fr = rulesOf(
      [
        'How quickly can I get an estimate?',
        'What types of projects do you take on?',
        'Faites-vous les petits déménagements à Montréal?',
        'Bardeaux?',
      ],
      ctx,
      'fr',
      'Groupe Fortifex',
    );
    expect(fr.dropped.map((d) => d.rule)).toEqual(['wrong_language', 'wrong_language']);
    expect(fr.kept).toEqual(['Faites-vous les petits déménagements à Montréal?', 'Bardeaux?']);
    expect(rulesOf(['Combien coûtent vos services ?'], ctx, 'en').dropped[0]?.rule).toBe('wrong_language');
  });
});

describe('rule: a generic question needs an answer in the context', () => {
  const emperor = [
    '## Service areas',
    '- Interior & exterior renovation specialists serving Mississauga, Brampton, Oakville, Burlington, and Milton since 2015.',
    '## FAQ',
    '- **Q:** Ready to get started?',
    "  **A:** Let's talk about your renovation.",
    '## Contact',
    '- Please complete the form below and we will get back to you within 24 hours.',
    '## Gaps and conflicts',
    '- No job durations, insurance or warranty details on the site.',
  ].join('\n');

  it('Emperor Sami: keeps the answered area question, drops the CTA and the unanswered job-length one', () => {
    const result = rulesOf(
      ['Ready to get started?', 'Do you serve my area (Mississauga and nearby)?', 'How long does a typical job take?'],
      emperor,
    );
    expect(result.kept).toEqual(['Do you serve my area (Mississauga and nearby)?']);
    expect(result.dropped).toEqual([
      { question: 'Ready to get started?', rule: 'heading_or_cta' },
      {
        question: 'How long does a typical job take?',
        rule: 'no_answer_in_context',
      },
    ]);
  });

  it('Groupe T.T: drops both calls to action and keeps the area question', () => {
    const result = rulesOf(
      [
        'Vous préférez détailler vos travaux en ligne ?',
        "Besoin d'un homme à tout faire fiable ?",
        'Desservez-vous mon secteur (Montréal et environs)?',
      ],
      '## Service areas\n- Nous desservons Montréal, Laval et la Rive-Sud.\n## Contact\n- Estimation sous 24h.',
      'fr',
    );
    expect(result.kept).toEqual(['Desservez-vous mon secteur (Montréal et environs)?']);
    expect(result.dropped.map((d) => d.rule)).toEqual(['heading_or_cta', 'heading_or_cta']);
  });

  it('a job length counts only when the context says how long the work takes, not how fast they reply', () => {
    const q = 'How long does a typical job take?';
    expect(rulesOf([q], '- We will get back to you within 24 hours.').kept).toEqual([]);
    expect(rulesOf([q], '- Today we can complete your new well in just one day, usually.').kept).toEqual([q]);
    expect(
      rulesOf(['Combien de temps dure un projet typique?'], '- Une salle de bain prend de 2 à 3 semaines.', 'fr').kept,
    ).toHaveLength(1);
    expect(
      rulesOf(
        ['How long does it take to get my windows after I order?'],
        '- Standard delivery times are 3-4 weeks for white.',
      ).kept,
    ).toHaveLength(1);
  });

  it('a question asking two things needs both answered', () => {
    const q = 'Are you insured, and what warranty do you offer?';
    expect(rulesOf([q], '- We are fully insured to protect your property.').dropped).toEqual([
      { question: q, rule: 'no_answer_in_context' },
    ]);
    expect(rulesOf([q], '- We are fully insured.\n- All work is guaranteed + up to a 15-year warranty.').kept).toEqual([
      q,
    ]);
  });

  it('a heading is not an answer: an empty Service areas section leaves the area question unanswered', () => {
    const q = 'Do you serve my area (Kingston and nearby)?';
    expect(rulesOf([q], '## Service areas\n- (not stated on site)\n## Services\n- Drywall.').kept).toEqual([]);
    expect(rulesOf([q], '## Service areas\n- © Copyright 2014. All Rights Reserved.').kept).toEqual([]);
    expect(rulesOf([q], '## Service areas\n- Proudly serving Kingston, Napanee and Gananoque.').kept).toEqual([q]);
  });

  it('lines about the scrape and placeholders are not answers', () => {
    const q = 'What are your hours?';
    expect(
      rulesOf([q], '## Hours\n- (not stated on site)\n## Gaps and conflicts\n- Hours Monday 9 to 5 unclear.').kept,
    ).toEqual([]);
    expect(rulesOf([q], '## Hours\n- Monday to Friday, 8 am to 5 pm').kept).toEqual([q]);
  });

  it('a question the context itself asks (a FAQ entry) counts as answered', () => {
    const q = 'How long does it take to get our photos back?';
    expect(
      rulesOf([q], `## FAQ\n- **Q:** ${q}\n  **A:** Usually within a couple of months of the wedding.`).kept,
    ).toEqual([q]);
  });

  it('free quotes, deposits and how to prepare need the fact on the page (wave-4 template questions)', () => {
    const quote = 'How soon can you come out for a quote, and is it free?';
    const deposit = 'How do I book, and what deposit do you need?';
    const prepare = 'What do I need to do to prepare before you arrive?';
    const bare =
      '## Services\n- Renovations.\n- Surface preparation and priming.\n- Upfront pricing, a written price before we start.';
    expect(rulesOf([quote, deposit, prepare], bare).dropped.map((d) => d.rule)).toEqual([
      'no_answer_in_context',
      'no_answer_in_context',
      'no_answer_in_context',
    ]);
    const full = [
      '## Pricing and quote process',
      '- Free Estimates',
      '- A 30% deposit secures your date.',
      '## FAQ',
      '- **Q:** How can I prepare my home?',
      '  **A:** We provide guidelines to help you prepare your home, such as clearing out rooms.',
    ].join('\n');
    expect(rulesOf([quote, deposit, prepare], full).kept).toEqual([quote, deposit, prepare]);
    // Soot deposits are not a payment.
    expect(rulesOf([deposit], '## Services\n- Removes soot, deposits and residue.').kept).toEqual([]);
    const fr = 'Combien de temps pour obtenir une soumission, et est-ce gratuit?';
    // A free-quote question, not a job-length one: "Soumission gratuite" answers it.
    expect(rulesOf([fr], '## Contact\n- Soumission gratuite', 'fr').kept).toEqual([fr]);
    expect(rulesOf([fr], '## Services\n- Toitures.', 'fr').kept).toEqual([]);
  });

  it('a question on no generic topic is kept as RedBot wrote it', () => {
    const q = 'Combien de fois par année faut-il tailler une haie de cèdres?';
    expect(rulesOf([q], '## Services\n- Taille de haies.', 'fr').kept).toEqual([q]);
  });

  it('repeats after cleanup are kept once', () => {
    expect(rulesOf(["Why Moodie's?", 'Do you install sprinklers?', '2. Do you install sprinklers ?'], '').kept).toEqual(
      ['Do you install sprinklers?'],
    );
  });
});

describe('loader', () => {
  it('stores only the questions the rules keep, cleans the context, and allows none', () => {
    const root = mkdtempSync(join(tmpdir(), 'site-rules-'));
    const context = join(root, 'context');
    mkdirSync(context);
    const md = (q: string[]) =>
      `# Biz\nSource: https://biz.example/\nLanguage: en\n\n## Suggested questions\n${q.map((x, i) => `${i + 1}. ${i + 1}\\. ${x}`).join('\n')}\n\n## Services\n- Masonry \\u2014 brick and stone.\n- <!-- https://biz.example/x -->\n`;
    writeFileSync(
      join(context, 'cataraqui.md'),
      md(['Why choose Cataraqui Masonry?', 'Ready to discuss _your project?', 'Not sure which service you need?']),
    );
    writeFileSync(
      join(context, 'turnbull.md'),
      md(['Ready to Transform Your Property?', 'Can Turnbull Masonry handle commercial projects?']),
    );
    writeFileSync(
      join(context, 'index.json'),
      JSON.stringify([
        {
          slug: 'cataraqui',
          name: 'Cataraqui Masonry',
          site: 'https://cataraqui.example/',
          language: 'en',
        },
        {
          slug: 'turnbull',
          name: 'Turnbull Masonry',
          site: 'https://turnbull.example/',
          language: 'en',
        },
      ]),
    );
    const [cataraqui, turnbull] = loadRedbotBusinesses(context, join(root, 'shots'));
    expect(cataraqui!.suggestedQuestions).toEqual([]);
    expect(cataraqui!.droppedQuestions.map((d) => d.question)).toEqual([
      'Why choose Cataraqui Masonry?',
      'Ready to discuss your project?',
      'Not sure which service you need?',
    ]);
    expect(cataraqui!.contextMd).toContain('- Masonry — brick and stone.');
    expect(cataraqui!.contextMd).not.toContain('<!--');
    expect(turnbull!.suggestedQuestions).toEqual(['Can Turnbull Masonry handle commercial projects?']);
    // The demo then shows no chips (and no "You can ask") for the first, one chip for the second.
    expect(
      demoSuggestions({
        suggestedQuestions: cataraqui!.suggestedQuestions,
        language: 'en',
      }),
    ).toEqual([]);
    expect(
      demoSuggestions({
        suggestedQuestions: turnbull!.suggestedQuestions,
        language: 'en',
      }),
    ).toHaveLength(1);
  });
});
