import { describe, expect, it } from 'vitest';
import { endSentence } from '@/app/(customer)/_lib/sentence';
import { SITE_STRINGS } from '@/app/(customer)/_lib/site-strings';

describe('endSentence', () => {
  it('adds a period after a plain name', () => {
    expect(endSentence('Acme Plumbing')).toBe('Acme Plumbing.');
  });
  it('keeps a single period when the name already ends in one', () => {
    expect(endSentence('613 Fencing Inc.')).toBe('613 Fencing Inc.');
    expect(endSentence('613 Fencing Inc. ')).toBe('613 Fencing Inc.');
  });
});

describe('demoNote', () => {
  it('has no doubled period in English or French', () => {
    const en = SITE_STRINGS.en.demoNote('613 Fencing Inc.');
    const fr = SITE_STRINGS.fr.demoNote('613 Fencing Inc.');
    expect(en).toContain('to 613 Fencing Inc. On the live site');
    expect(fr).toContain('à 613 Fencing Inc. Sur le vrai site');
    expect(en).not.toContain('..');
    expect(fr).not.toContain('..');
  });
});
