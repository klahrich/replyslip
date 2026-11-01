import { describe, expect, it } from 'vitest';
import { pickSuggestions } from '@/app/(customer)/_lib/site-demo-suggestions';
import type { SuggestedQuestion } from '@/app/(customer)/_lib/site-demo-types';

const row = (id: string, language: string): SuggestedQuestion => ({
  id,
  question: `question ${id}`,
  answer: `answer ${id}`,
  language,
  checked_at: '2026-01-01T00:00:00.000Z',
});

describe('site demo suggestion chips', () => {
  it('shows no chips when no row is in the current language', () => {
    expect(pickSuggestions([row('a', 'en'), row('b', 'en')], 'fr')).toEqual([]);
  });

  it('shows only the rows in the current language, each with its own answer', () => {
    const rows = [row('e1', 'en'), row('f1', 'fr'), row('o1', 'other'), row('e2', 'en'), row('f2', 'fr')];
    expect(pickSuggestions(rows, 'fr')).toEqual([row('f1', 'fr'), row('f2', 'fr')]);
    expect(pickSuggestions(rows, 'en').map((s) => [s.id, s.answer])).toEqual([
      ['e1', 'answer e1'],
      ['e2', 'answer e2'],
    ]);
  });

  it('keeps the server order and shows at most three', () => {
    const rows = ['1', '2', '3', '4'].map((id) => row(id, 'en'));
    expect(pickSuggestions(rows, 'en').map((s) => s.id)).toEqual(['1', '2', '3']);
  });
});
