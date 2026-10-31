/**
 * Text normalization for the verbatim source check (spec 4.2 rule 1): Unicode NFC, case-fold, curly quotes to
 * straight, every whitespace run to one space. Markdown emphasis markers are dropped too, so a quote of
 * "**Open** Monday" still matches "Open Monday" in the scraped markdown.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[*_]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** normalizeForMatch plus accents stripped (NFD, combining marks removed), for keyword matching (spec 4.3). */
export function normalizeForKeywords(text: string): string {
  return normalizeForMatch(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
