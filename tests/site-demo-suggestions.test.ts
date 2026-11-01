import { describe, expect, it } from 'vitest';
import { pickSuggestions, suggestionsOf } from '@/app/(customer)/_lib/site-demo-suggestions';
import type { SuggestedQuestion } from '@/app/(customer)/_lib/site-demo-types';

/** A row in the new shape (no id, no stored answer). The question text doubles as the row's name. */
const row = (id: string, language: string, position?: number): SuggestedQuestion => ({
  ...(position === undefined ? {} : { position }),
  question: id,
  language,
});

/** A row as older servers send it, with an id, a stored answer and checked_at. */
const oldRow = (id: string, language: string, position?: number) => ({
  ...row(id, language, position),
  id: `id-${id}`,
  answer: `answer ${id}`,
  checked_at: '2026-01-01T00:00:00.000Z',
});

const ids = (rows: SuggestedQuestion[]) => rows.map((s) => s.question);

describe('site demo suggestion chips', () => {
  it('shows no chips when no row is in the current language', () => {
    expect(pickSuggestions([row('a', 'en'), row('b', 'en')], 'fr')).toEqual([]);
  });

  it('shows only the rows in the current language', () => {
    const rows = [row('e1', 'en'), row('f1', 'fr'), row('o1', 'other'), row('e2', 'en'), row('f2', 'fr')];
    expect(pickSuggestions(rows, 'fr')).toEqual([row('f1', 'fr'), row('f2', 'fr')]);
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['e1', 'e2']);
  });

  it('keeps the server order and shows at most three', () => {
    const rows = ['1', '2', '3', '4'].map((id) => row(id, 'en'));
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['1', '2', '3']);
  });

  it('picks old-shape rows the same way; their id and stored answer are just extra fields', () => {
    const rows = [oldRow('e1', 'en', 1), oldRow('f0', 'fr', 0), oldRow('e0', 'en', 0)];
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['e0', 'e1']);
  });

  it('orders chips by position when the server sends them out of order', () => {
    const rows = [row('p2', 'en', 2), row('p0', 'en', 0), row('p1', 'en', 1)];
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['p0', 'p1', 'p2']);
  });

  it('sorts by position before the cap, so a low position past the third row still shows', () => {
    const rows = [row('p4', 'en', 4), row('p3', 'en', 3), row('p2', 'en', 2), row('p1', 'en', 1), row('p0', 'en', 0)];
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['p0', 'p1', 'p2']);
  });

  it('keeps the server order for rows without a position, after the ones with one', () => {
    const rows = [row('n1', 'en'), row('p1', 'en', 1), row('n2', 'en'), row('p0', 'en', 0)];
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['p0', 'p1', 'n1']);
    expect(ids(pickSuggestions([row('n1', 'en'), row('n2', 'en'), row('n3', 'en')], 'en'))).toEqual(['n1', 'n2', 'n3']);
  });

  it('filters by language before ordering by position, and still caps at three', () => {
    const rows = [
      row('e1', 'en', 1),
      row('f1', 'fr', 1),
      row('e0', 'en', 0),
      row('f0', 'fr', 0),
      row('o0', 'other', 0),
      row('e3', 'en', 3),
      row('e2', 'en', 2),
    ];
    expect(ids(pickSuggestions(rows, 'en'))).toEqual(['e0', 'e1', 'e2']);
    expect(ids(pickSuggestions(rows, 'fr'))).toEqual(['f0', 'f1']);
  });

  it('shows no chips when nothing is in the current language, positions or not', () => {
    expect(pickSuggestions([], 'en')).toEqual([]);
    expect(pickSuggestions([row('e0', 'en', 0), row('e1', 'en', 1)], 'fr')).toEqual([]);
  });
});

describe('site demo suggestion rows from the payload', () => {
  it('reads `suggestions` from newer servers', () => {
    expect(suggestionsOf({ suggestions: [row('a', 'en', 0), row('b', 'fr', 0)] })).toEqual([row('a', 'en', 0), row('b', 'fr', 0)]);
  });

  it('reads `suggested_questions` from older servers', () => {
    expect(ids(suggestionsOf({ suggested_questions: [oldRow('a', 'en', 0)] }))).toEqual(['a']);
  });

  it('prefers `suggestions` when both are present, and is empty when neither is', () => {
    expect(ids(suggestionsOf({ suggestions: [row('new', 'en')], suggested_questions: [oldRow('old', 'en')] }))).toEqual(['new']);
    expect(suggestionsOf({})).toEqual([]);
  });

  it('drops rows with no question text, since a tap would have nothing to send', () => {
    expect(ids(suggestionsOf({ suggestions: [row('', 'en'), row('  ', 'en'), row('ok', 'en')] }))).toEqual(['ok']);
  });
});
