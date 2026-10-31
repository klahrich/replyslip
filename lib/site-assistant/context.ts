/**
 * RedBot's context markdown: the source URL and scrape date near the top, page text, and a "Suggested questions"
 * section. The suggested questions are split off and stored in their own column; they are never part of the
 * context the model sees or the verbatim source check uses.
 */
export type ParsedContext = {
  title: string | null;
  sourceUrl: string | null;
  scrapedAt: Date | null;
  /** From a `Language: en|fr` line near the top, if any. */
  language: 'en' | 'fr' | null;
  /** Markdown without the Suggested questions section. */
  contextMd: string;
  suggestedQuestions: string[];
};

const SUGGESTED_HEADING = /^(#{1,6})\s*(suggested questions|questions sugg[ée]r[ée]es)\b.*$/i;

function cleanListItem(line: string): string | null {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  const text = m[1]!
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^["“«]\s*|\s*["”»]$/g, '')
    .trim();
  return text || null;
}

export function parseContextMarkdown(markdown: string): ParsedContext {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  const suggested: string[] = [];
  let inSuggested = false;
  let suggestedLevel = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s/.exec(line);
    const suggestedHeading = SUGGESTED_HEADING.exec(line);
    if (suggestedHeading) {
      inSuggested = true;
      suggestedLevel = suggestedHeading[1]!.length;
      continue;
    }
    if (inSuggested && heading && heading[1]!.length <= suggestedLevel) inSuggested = false;
    if (inSuggested) {
      const item = cleanListItem(line);
      if (item) suggested.push(item);
      continue;
    }
    kept.push(line);
  }

  const head = lines.slice(0, 20).join('\n');
  const title = /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? null;
  const sourceUrl = /\bsource(?:\s*url)?\s*\**\s*[:：]\s*\**\s*<?(https?:\/\/[^\s>)]+)/i.exec(head)?.[1] ?? null;
  const dateMatch = /\b(?:scraped|scrape date|scraped at|retrieved|fetched|crawled)\b[^\n\d]{0,20}(\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?)/i.exec(head);
  const scrapedAt = dateMatch ? new Date(dateMatch[1]!.replace(' ', 'T')) : null;

  const lang = /^\s*\**\s*(?:language|langue)\s*\**\s*[:：]\s*\**\s*(en|fr)\b/im.exec(head)?.[1]?.toLowerCase();
  return {
    language: lang === 'en' || lang === 'fr' ? lang : null,
    title,
    sourceUrl,
    scrapedAt: scrapedAt && !Number.isNaN(scrapedAt.getTime()) ? scrapedAt : null,
    contextMd: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    suggestedQuestions: [...new Set(suggested)].slice(0, 10),
  };
}
