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

  it('drops placeholder phone numbers and a \\u003e that lost its backslash', () => {
    const md = [
      '## Contact',
      '- Phone: (416) 000-0000',
      '- Phone: (437) 477-5185',
      '- Other emails seen: u003einfo',
      '## Gaps and conflicts',
      '- 2 different phone numbers on site: (416) 000-0000, (437) 477-5185',
      '- 3 different phone numbers on site: (416) 542-8000, (647) 000-0000, (647) 835-7757',
    ].join('\n');
    expect(cleanContextText(md)).toBe(
      [
        '## Contact',
        '- Phone: (437) 477-5185',
        '- Other emails seen: info',
        '## Gaps and conflicts',
        '- 2 different phone numbers on site: (437) 477-5185',
        '- 3 different phone numbers on site: (416) 542-8000, (647) 835-7757',
      ].join('\n'),
    );
  });

  it('keeps the text after a comment that spans lines, and never swallows past a blank line', () => {
    expect(cleanContextText('## Services\n<!-- scraped from\n /services --> Drywall and taping.')).toBe(
      '## Services\nDrywall and taping.',
    );
    expect(cleanContextText('- <!-- https://example.ca/a\n\n## Services\n- Drywall. <!-- x --> Taping.')).toBe(
      '## Services\n- Drywall. Taping.',
    );
  });

  it('placeholder phones: only real placeholder formats, and the label and joiners go with them', () => {
    expect(cleanContextText('- Phone: +1 (613) 000-0000 · Email: on the form')).toBe('- Email: on the form');
    expect(cleanContextText('- Call 555-000-0000 or email us.')).toBe('- Email us.');
    expect(cleanContextText('- call us at 000-0000 or write to us.')).toBe('- write to us.');
    expect(cleanContextText('- Tel: 555 000 0000\n- Hours: 9 to 5')).toBe('- Hours: 9 to 5');
    expect(cleanContextText('- Licence ID 1230000000; RBQ 5555-0000-00')).toBe(
      '- Licence ID 1230000000; RBQ 5555-0000-00',
    );
    expect(cleanContextText('- Mobile\n- Phone: (437) 477-5185')).toBe('- Mobile\n- Phone: (437) 477-5185');
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
    'Need help with your move?',
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
    'Need permits?',
    'Need help choosing a paint colour?',
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

  it("hours need opening times: a 24 hours' notice is not hours", () => {
    const q = 'What are your hours, and can I reach you on weekends?';
    expect(rulesOf([q], "## FAQ\n- We ask for at least 24 hours' notice for cancellations.").kept).toEqual([]);
    expect(rulesOf([q], '## Hours\n- Open 24 hours a day, 7 days a week.').kept).toEqual([q]);
    expect(rulesOf(['What are your hours?'], '## Hours\n- Available 24 hours, 7 days a week.').kept).toHaveLength(1);
    const weekends = 'Are you open on weekends?';
    expect(rulesOf([weekends], '## Services\n- 24-hour emergency service.').kept).toEqual([weekends]);
    expect(rulesOf([weekends], '## Services\n- We work 7 days a week.').kept).toEqual([weekends]);
    expect(rulesOf([weekends], "## FAQ\n- Please give 24 hours' notice.").kept).toEqual([]);
    expect(
      rulesOf(['Êtes-vous ouverts la fin de semaine?'], '## Heures\n- Service 7 jours sur 7.', 'fr').kept,
    ).toHaveLength(1);
  });

  it('a price question is kept when the page gives the price, dropped when it does not (v4)', () => {
    const ctx =
      '## Pricing and quote process\n- Drywall repair from $150. Free estimates.\n## FAQ\n- **Q:** What are your rates?';
    const result = rulesOf(
      [
        'Roughly what does a typical drywall job cost?',
        'What are your rates?',
        'How much do you charge for a small repair?',
        'How much does a new deck cost?',
        'How soon can you come out for a quote, and is it free?',
        'How much notice do you need?',
        'Who is in charge of the permits?',
        'Do you offer first-rate finishes?',
      ],
      ctx,
    );
    expect(result.dropped).toEqual([{ question: 'How much does a new deck cost?', rule: 'price_question' }]);
    expect(
      rulesOf(['Combien coûte une soumission typique?'], ctx.replace('Free', 'Gratuit'), 'fr').dropped[0]?.rule,
    ).toBe('price_question');
  });

  it('"prepare" is the customer\'s part only', () => {
    const ctx = '## Services\n- Catering, tax returns, painting.';
    for (const q of [
      'Do you prepare food on-site?',
      'Do you prepare tax returns?',
      'Do you prepare surfaces before painting?',
    ])
      expect(rulesOf([q], ctx).kept).toEqual([q]);
    for (const [q, lang] of [
      ['How should I prepare for the move?', 'en'],
      ['How do I prepare my lawn?', 'en'],
      ['What should I do before you arrive?', 'en'],
      ['Do I need to prepare my vehicle before you arrive?', 'en'],
      ['Que dois-je préparer avant votre arrivée?', 'fr'],
      ['Comment me préparer pour la séance?', 'fr'],
      ['Que dois-je faire avant le ramonage?', 'fr'],
    ] as const)
      expect(rulesOf([q], ctx, lang).dropped).toEqual([{ question: q, rule: 'no_answer_in_context' }]);
  });

  it('deposit evidence needs payment or booking words, not "no", "take", "date" or "order"', () => {
    const q = 'How do I book, and what deposit do you need?';
    expect(
      rulesOf([q], '## Services\n- We remove soot deposits, no mess, and take care of your date and order.').kept,
    ).toEqual([]);
    expect(rulesOf([q], '## Booking\n- A non-refundable deposit is required to book.').kept).toEqual([q]);
    expect(rulesOf([q], '## FAQ\n- We Do Not Take Deposits').kept).toEqual([q]);
    expect(rulesOf([q], '## About\n- Rates up front. No deposits, ever.').kept).toEqual([q]);
  });

  it('a free estimate question asking how long goes to the duration check; gluten-free is not a free quote', () => {
    const q = 'How long does a free estimate take?';
    expect(rulesOf([q], '## Pricing and quote process\n- Free estimates.').kept).toEqual([]);
    expect(rulesOf([q], '## Pricing and quote process\n- A free estimate takes about 1 hour.').kept).toEqual([q]);
    expect(
      rulesOf(['Do you offer free quotes?'], '## Services\n- Gluten-free menus and quotes for large events.').kept,
    ).toEqual([]);
    expect(rulesOf(['Do you offer free quotes?'], '## Contact\n- Free quotes, no obligation.').kept).toHaveLength(1);
  });

  it("a bracket stays when it's the question's object, and plurals match singulars", () => {
    expect(rulesOf(['Do you serve (Kingston)?'], '## Services\n- Drywall.').dropped[0]?.question).toBe(
      'Do you serve (Kingston)?',
    );
    expect(
      rulesOf(['Do you install sliding doors (windows/doors)?'], '## Services\n- New window and door installs.').kept,
    ).toEqual(['Do you install sliding doors (windows/doors)?']);
  });

  it('header lines are not evidence, with a list marker or bold too', () => {
    const q = 'Do you serve my area (Ottawa and nearby)?';
    for (const header of ['- City: Ottawa, ON', '**City:** Ottawa, ON', '- **Niche:** Ottawa movers'])
      expect(rulesOf([q], `${header}\n## Service areas\n- We serve the region.`).kept).toEqual([
        'Do you serve my area?',
      ]);
  });

  it("a bare 24 hours' notice does not answer the hours question", () => {
    expect(rulesOf(['What are your hours?'], "- 24 hours' notice please.").kept).toEqual([]);
  });

  it("a bracket naming nothing on the site goes (RedBot's English niche in a French question)", () => {
    const ctx = [
      '# Iso-Thermo',
      'City: Longueuil (Montreal area), QC · Niche: insulation',
      '## Service areas',
      '- Nous desservons Longueuil et la Rive-Sud.',
      '## Pricing and quote process',
      '- Isolation des combles à partir de 1,50 $ le pied carré.',
    ].join('\n');
    expect(
      rulesOf(
        ['Quels travaux faites-vous (insulation)?', 'Desservez-vous mon secteur (Longueuil et environs)?'],
        ctx,
        'fr',
      ).kept,
    ).toEqual(['Quels travaux faites-vous?', 'Desservez-vous mon secteur (Longueuil et environs)?']);
    // Accents don't matter, and the header line is not the site's text.
    expect(
      rulesOf(['Do you serve my area (Montreal and nearby)?'], '## Service areas\n- We serve Montréal.').kept,
    ).toEqual(['Do you serve my area (Montreal and nearby)?']);
    expect(
      rulesOf(
        ['Do you serve my area (Ottawa and nearby)?'],
        'City: Ottawa, ON\n## Service areas\n- We serve the region.',
      ).kept,
    ).toEqual(['Do you serve my area?']);
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

describe('review nits on rules v3', () => {
  const page = '# X\n\n## Services\n- Tile and stone. Free estimates.\n';
  const kept = (qs: string[], language: 'en' | 'fr' = 'en', ctx = page) => rulesOf(qs, ctx, language).kept;
  const ruleOf = (q: string, language: 'en' | 'fr' = 'en', ctx = page) => rulesOf([q], ctx, language).dropped[0]?.rule;

  it('price words inside other words or meanings are not price', () => {
    const en = [
      'Are your products cost-effective?',
      'How do you keep costs low?',
      'What are your success rates?',
      'How much of the yard do you mow?',
      'Can you charge my car battery?',
    ];
    expect(kept(en)).toEqual(en);
    const fr = ['Vos fruits sont-ils frais ?', 'Faites-vous de la couture ?'];
    expect(kept(fr, 'fr')).toEqual(fr);
    for (const q of [
      'Do you charge for travel?',
      'What are your rates?',
      'How much is a tile job?',
      'Is there an extra charge on weekends?',
    ])
      expect(ruleOf(q)).toBe('price_question');
    for (const q of ['Quels sont vos frais de déplacement ?', 'Ça coûte combien ?', 'Combien coûtent vos services ?'])
      expect(ruleOf(q, 'fr')).toBe('price_question');
  });

  it('a price question with a free-quote clause is still a price question', () => {
    expect(ruleOf('How much does it cost, and is the estimate free?')).toBe('price_question');
    expect(ruleOf('Is the quote free, or is there a fee?')).toBe('price_question');
    expect(kept(['How soon can you come out for a quote, and is it free?', 'Do quotes cost anything?'])).toHaveLength(
      2,
    );
  });

  it('"free?" is a free-quote question only with a quote word', () => {
    // Not free_quote, so they need no free-estimate line and are kept as RedBot wrote them.
    expect(kept(['Is parking free?', 'Is the menu gluten-free?'], 'en', '# X\n\n## Services\n- Tile\n')).toHaveLength(
      2,
    );
    expect(ruleOf('Is the inspection free?', 'en', '# X\n\n## Services\n- Tile\n')).toBe('no_answer_in_context');
  });

  it('a placeholder before a real number keeps the label or the verb', () => {
    expect(cleanContextText('Call (613) 000-0000, 514-555-1234')).toBe('Call 514-555-1234');
    expect(cleanContextText('Phone: 000-0000, 514-555-1234')).toBe('Phone: 514-555-1234');
    expect(cleanContextText('Call us at 555-000-0000 or 613-555-1234 today')).toBe('Call us at 613-555-1234 today');
    expect(cleanContextText('Call 000-0000 or email us')).toBe('Email us');
    expect(cleanContextText('Phone: 000-0000 · Email: x')).toBe('Email: x');
  });

  it('"Need to check / know …" is the visitor\'s question', () => {
    expect(kept(['Need to know the best time to aerate?', 'Need to check if quality matters?'])).toHaveLength(2);
    expect(ruleOf('Need reliable movers?')).toBe('heading_or_cta');
    expect(ruleOf('Need To Know?')).toBe('heading_or_cta');
  });

  it('"within 24 hours, 7 days after" is not hours; soot deposits are not a down payment', () => {
    const ctx =
      '# X\n\n## Services\n- Replies within 24 hours, 7 days after booking.\n- Book now: soot deposits removed.\n';
    expect(ruleOf('What are your hours?', 'en', ctx)).toBe('no_answer_in_context');
    expect(ruleOf('What deposit do you need?', 'en', ctx)).toBe('no_answer_in_context');
    expect(
      kept(['What are your hours?'], 'en', '# X\n\n## Hours\n- Available 24 hours, 7 days a week.\n'),
    ).toHaveLength(1);
    expect(kept(['Do you remove soot deposits?'], 'en', ctx)).toHaveLength(1);
  });

  it('a worked-example bracket stays', () => {
    const ctx = '# X\n\n## Services\n- Tile. Most jobs take 2 days to complete.\n';
    expect(kept(['How long does a typical tile job take (typical bungalow)?'], 'en', ctx)).toEqual([
      'How long does a typical tile job take (typical bungalow)?',
    ]);
  });
});

describe('rule 3 v4: a price question needs the price on the page', () => {
  const ruleOf = (q: string, ctx: string, language: 'en' | 'fr' = 'en', displayName?: string) =>
    rulesOf([q], ctx, language, displayName).dropped[0]?.rule ?? 'kept';

  it('keeps it for a $ amount, a range, a fee or a price per hour', () => {
    expect(ruleOf('How much does drywall repair cost?', '## Pricing\n- Drywall repair from $99.')).toBe('kept');
    expect(ruleOf('What are your prices?', '## Services\n- Lessons: $120 a month.')).toBe('kept');
    expect(ruleOf('What is your hourly rate?', '## Pricing\n- Interior painting: $80–$150/hour.')).toBe('kept');
    expect(ruleOf('What is your consultation fee?', '## Pricing\n- Consultation fee $50.')).toBe('kept');
    // "Is the consultation free?" is a free-quote question; the consultation's price answers it too.
    expect(ruleOf('Is the consultation free?', '## Pricing\n- Consultation fee $50.')).toBe('kept');
    expect(
      ruleOf(
        'How much does a spring replacement cost?',
        '## FAQ\n- **Q:** How much does a spring replacement cost?\n  **A:** $220 to $350, parts and labour.',
      ),
    ).toBe('kept');
  });

  it('drops it when the page only says "pricing", "quote", "affordable" or "contact us"', () => {
    const ctx = [
      '## Pricing and quote process',
      '- Affordable, upfront pricing.',
      '- Contact us for a quote.',
      '- Free estimates. Competitive rates and honest quotes.',
      '- No surprises: a fixed price in writing.',
    ].join('\n');
    for (const q of [
      'What are your prices?',
      'How much does a typical job cost?',
      'Roughly what does a deck cost?',
      'What are your rates?',
      'How much do you charge?',
    ])
      expect(ruleOf(q, ctx)).toBe('price_question');
  });

  it('drops it with no site text, or when the only amount is in a scrape note or placeholder', () => {
    expect(ruleOf('What are your prices?', '')).toBe('price_question');
    expect(ruleOf('What are your prices?', '# X\n\n## Pricing\n- (not stated on site)')).toBe('price_question');
    expect(ruleOf('What are your prices?', '# X\n\n## Gaps and conflicts\n- Pricing around $100 is unconfirmed.')).toBe(
      'price_question',
    );
    expect(ruleOf('What are your prices?', '# X\n\nSite: https://example.ca/?p=$100\n')).toBe('price_question');
  });

  it('French: "à partir de 99 $" and "45 $/h" answer it; "tarifs" or "soumission gratuite" alone do not', () => {
    expect(ruleOf('Combien coûte un ramonage ?', '## Tarifs\n- Ramonage de cheminée à partir de 99 $.', 'fr')).toBe(
      'kept',
    );
    expect(ruleOf('Quels sont vos tarifs ?', '## Tarifs\n- Tarif horaire : 45 $/h.', 'fr')).toBe('kept');
    expect(ruleOf('Quel est votre tarif horaire ?', '## Tarifs\n- Massage 60 minutes : 1 017,63 $.', 'fr')).toBe(
      'price_question',
    );
    const words = '## Tarifs\n- Tarifs compétitifs.\n- Soumission gratuite.\n- Contactez-nous pour connaître nos prix.';
    for (const q of ['Combien coûtent vos services ?', 'Quels sont vos tarifs ?', 'Quel est le prix d’une toiture ?'])
      expect(ruleOf(q, words, 'fr')).toBe('price_question');
    expect(ruleOf('Combien coûtent vos services ?', '', 'fr')).toBe('price_question');
  });

  it('the price has to be for what the question asks about', () => {
    const ctx = '## Pricing\n- Gutter cleaning from $99.\n- Kitchens from $25,000.';
    expect(ruleOf('How much does gutter cleaning cost?', ctx)).toBe('kept');
    expect(ruleOf('How much does window cleaning cost?', ctx)).toBe('price_question');
    expect(ruleOf('What is your hourly rate?', ctx)).toBe('price_question');
    // A heading names what the lines under it price.
    expect(ruleOf('How much does window cleaning cost?', '## Window cleaning\n- From $8 per window.')).toBe('kept');
  });

  it("the business's own trade is not a subject: Acme Painting's price for a room answers a painting job", () => {
    const q = 'Roughly what does a typical painting job cost?';
    const ctx = '# Acme Painting\n\n## Pricing\n- Most rooms run $350 to $600.';
    expect(ruleOf(q, ctx, 'en', 'Acme Painting')).toBe('kept');
    expect(
      ruleOf(q, ctx.replace('# Acme Painting\n', '# Acme\n\nCity: Ottawa, ON · Niche: painting\n'), 'en', 'Acme'),
    ).toBe('kept');
    expect(ruleOf(q, ctx, 'en', 'Acme')).toBe('price_question');
  });

  it('"free" or "no charge" answers only a question about that same thing', () => {
    const ctx = '## Service areas\n- No travel charges within 40 km.\n- Free estimates.';
    expect(ruleOf('Do you charge for travel?', ctx)).toBe('kept');
    expect(ruleOf('Do you charge for estimates?', ctx)).toBe('kept');
    expect(ruleOf('How much do you charge?', ctx)).toBe('price_question');
    expect(ruleOf('What are your prices?', ctx)).toBe('price_question');
    expect(ruleOf('How much does it cost, and is the estimate free?', ctx)).toBe('price_question');
    expect(ruleOf('Y a-t-il des frais pour une soumission ?', '## Tarifs\n- Soumission gratuite.', 'fr')).toBe('kept');
    // "How much…?" needs an amount: a free consultation doesn't answer what a first visit costs.
    expect(ruleOf('Combien coûte une soumission ?', '## Tarifs\n- Soumission gratuite.', 'fr')).toBe('price_question');
    expect(
      ruleOf('What does a first visit or consultation cost?', '## Services\n- Free consultation for new patients.'),
    ).toBe('price_question');
  });

  it('insurance cover, credits, gift cards, a $0 cart and deposits are not the price of the work', () => {
    const ctx = [
      '## Services',
      '- Licensed and $5M insured.',
      '- Gift cards from $25.',
      '- A $75 credit toward your next visit if we are late.',
      '- Cart $0.00',
      '- Moins de 70 000 $ : couverture complète.',
      '- A $200 deposit secures your date.',
      '- Cancellations within 24 hours: $50 fee.',
    ].join('\n');
    expect(ruleOf('What are your prices?', ctx)).toBe('price_question');
    expect(ruleOf('How much do you charge?', ctx)).toBe('price_question');
    expect(ruleOf('How much is the deposit?', ctx)).toBe('kept');
    expect(ruleOf('Is there a cancellation fee?', ctx)).toBe('kept');
  });

  it('thresholds, surcharges, travel fees, quote fees and $1.00 placeholders are not the price of the work', () => {
    const ctx = [
      '## Services',
      '- Orders over $75 ship with tracking.',
      '- Saturday surcharge $10.',
      '- Travel fee $45 outside the city.',
      '- $199 in-person consultation.',
      '- Carpet Cleaning $1.00',
      '- Your first visit, made simple and stress‑free.',
    ].join('\n');
    expect(ruleOf('How much does a typical job cost?', ctx)).toBe('price_question');
    expect(ruleOf('Do you charge for travel?', ctx)).toBe('kept');
    expect(ruleOf('Is there an extra charge on Saturdays?', ctx)).toBe('kept');
    expect(ruleOf('What does a consultation cost?', ctx)).toBe('kept');
    // "stress‑free" is not free.
    expect(ruleOf('Do you charge for the first visit?', ctx)).toBe('price_question');
    // The hourly rate counts even with a travel fee in the same sentence.
    expect(
      ruleOf('Combien coûtent vos services ?', '## Tarifs\n- À la carte : 85 $/h, frais de déplacement 45 $.\n', 'fr'),
    ).toBe('kept');
  });
});
