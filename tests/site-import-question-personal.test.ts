import { describe, expect, it } from 'vitest';
import { regenerateQuestions } from '@/lib/site-assistant/question-regen';
import { applyQuestionRules } from '@/lib/site-assistant/question-rules';

// Rule 5, with made-up clinics, brokers and notaries.

const ctx =
  '## Services\n- Physiotherapy for back pain, sports injuries and post-surgery rehab.\n- We direct-bill most insurance plans.\n' +
  '## Hours\n- Monday to Friday 8 am - 7 pm\n## Service areas\n- Serving Brampton and Mississauga since 2011\n';
const rules = (questions: string[], language: 'en' | 'fr' = 'en') =>
  applyQuestionRules(questions, { contextMd: ctx, language, displayName: 'Maple Physio' });

describe("rule 5: no preset question asks for the visitor's personal details", () => {
  it('drops questions that ask for health, pet-medical, financial or legal details', () => {
    const asks = [
      'What are your symptoms?',
      'Describe your pain',
      'Tell us about your condition',
      "What's your policy number?",
      'Where is your pain located?',
      'What medications are you taking?',
      "What are your pet's symptoms?",
      'How long has my dog had this condition?',
      'Have you been injured in a car accident?',
      'Are you experiencing back pain?',
      'What is your annual income?',
      'Can you look at my tax return?',
      'What is your legal situation?',
      'Share your medical history before your visit',
      'What is your date of birth?',
    ];
    const result = rules(asks);
    expect(result.kept).toEqual([]);
    expect(new Set(result.dropped.map((d) => d.rule))).toEqual(new Set(['personal_details']));
  });

  it('drops the French equivalents', () => {
    const result = rules(
      [
        'Quels sont vos symptômes ?',
        'Décrivez votre douleur',
        'Quel est votre numéro de police ?',
        'Ressentez-vous de la douleur au dos ?',
        'Quelle est votre situation financière ?',
      ],
      'fr',
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped.every((d) => d.rule === 'personal_details')).toBe(true);
  });

  it('keeps factual questions about the business', () => {
    const facts = [
      'Do you accept new patients?',
      'Do you direct-bill insurance?',
      'What are your hours?',
      'Do you treat back pain?',
      'Do you treat sports injuries?',
      'Have you ever treated whiplash?',
      'What should I bring to my first appointment?',
      'Do you need a referral from my doctor?',
    ];
    expect(rules(facts).kept).toEqual(facts);
    expect(
      rules(['Acceptez-vous de nouveaux patients ?', 'Traitez-vous les douleurs au dos ?'], 'fr').kept,
    ).toHaveLength(2);
  });

  it('applies to regenerated candidates, and offers health-practice questions only with evidence', () => {
    const faq =
      '## FAQ\n- **Q:** What are your symptoms when you first come in?\n  **A:** Your symptoms are reviewed by the physiotherapist at your first visit.\n' +
      '- **Q:** Do you see patients on weekends?\n  **A:** Yes, we see patients on Saturdays from 9 am to 1 pm.\n';
    const added = regenerateQuestions([], { contextMd: faq + ctx + '- Now accepting new patients.\n', language: 'en' });
    expect(added.map((a) => a.question)).toEqual([
      'Do you see patients on weekends?',
      'Do you accept new patients?',
      'Do you direct-bill insurance?',
    ]);
    // No evidence of emergency visits or direct billing: not offered.
    const plain = regenerateQuestions([], { contextMd: '## Hours\n- 9 am - 5 pm\n', language: 'fr' });
    expect(plain.map((a) => a.question)).toEqual(["Quelles sont vos heures d'ouverture ?"]);
  });
});

describe("rule 5 narrowed (EvaluatorBot review of #163)", () => {
  const ruleOf = (q: string, language: "en" | "fr" = "en") =>
    rules([q], language).dropped[0]?.rule;

  it("keeps questions about the business that only look personal", () => {
    for (const q of [
      "Are you licensed and experienced?",
      "Where is your pain clinic located?",
      "Do you offer pain management?",
      "Can you help with my divorce?",
      "Can you help with my back pain?",
      "Do I need to bring my health card?",
      "List your services?",
      "Explain your process",
      "Explain your cancellation process",
      "Describe your services",
      "Tell us about your team",
      "What symptoms do you treat?",
      "How old is your company?",
    ])
      expect(ruleOf(q), q).not.toBe("personal_details");
    // Rule 5 never reports these; rules 1-3 (unchanged) still apply, e.g. a bare imperative is a heading.
    for (const q of [
      "Pouvez-vous m’aider avec mon divorce ?",
      "Expliquez votre processus",
    ])
      expect(ruleOf(q, "fr"), q).not.toBe("personal_details");
    expect(
      rules([
        "Can you help with my divorce?",
        "Where is your pain clinic located?",
        "List your services?",
      ]).kept,
    ).toHaveLength(3);
  });

  it('"terms and conditions" is not a personal condition', () => {
    // It can still be a policy question (rule 1, unchanged); rule 5 never reports it.
    expect(ruleOf("What are your terms and conditions?")).not.toBe(
      "personal_details",
    );
    expect(ruleOf("Do you have terms and conditions for rentals?")).not.toBe(
      "personal_details",
    );
  });

  it("drops questions about the visitor's allergies, symptoms, medications and age", () => {
    for (const q of [
      "Do you have any allergies?",
      "Are you allergic to latex?",
      "What medications do you take?",
      "Do you take any medications?",
      "How old are you?",
      "What's your age?",
      "Do you have any symptoms?",
      "What symptoms do you have?",
      "Are you experiencing symptoms?",
      "Tell us about yourself",
      "Describe your situation",
      "Explain your legal situation",
      "Tell us more about your case",
      "Where is your pain located?",
    ])
      expect(ruleOf(q), q).toBe("personal_details");
    for (const q of [
      "Avez-vous des allergies ?",
      "Quels médicaments prenez-vous ?",
      "Quel âge avez-vous ?",
      "Avez-vous des symptômes ?",
      "Décrivez votre situation",
    ])
      expect(ruleOf(q, "fr"), q).toBe("personal_details");
  });
});
