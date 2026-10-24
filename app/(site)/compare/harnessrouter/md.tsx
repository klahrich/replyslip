import type { ReactNode } from 'react';

/** A small Markdown reader for this article: headings, paragraphs, lists, one table, and inline bold, code and links. */
export type Block =
  | { t: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parse(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      out.push({ t: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], text: h[2] });
    } else if (line.startsWith('| ')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2; // skip the --- row
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      out.push({ t: 'table', head, rows });
    } else if (/^(- |\d+\. )/.test(line)) {
      const t = line.startsWith('- ') ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, ''));
      i--;
      out.push({ t, items });
    } else {
      out.push({ t: 'p', text: line });
    }
  }
  return out;
}

const SITE = 'https://replyslip.com';

/** Site links become relative so previews stay on the preview; the copy keeps its absolute URLs. */
function href(url: string) {
  if (url === `${SITE}/`) return '/';
  return url.startsWith(`${SITE}/`) ? url.slice(SITE.length) : url;
}

export function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((s, k) => {
    if (s.startsWith('**') && s.endsWith('**')) return <strong key={k}>{inline(s.slice(2, -2))}</strong>;
    if (s.startsWith('`') && s.endsWith('`'))
      return (
        <code key={k} translate="no">
          {s.slice(1, -1)}
        </code>
      );
    const a = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s);
    if (a) {
      const to = href(a[2]);
      return (
        <a key={k} className="link" href={to} {...(to.startsWith('http') ? { rel: 'noopener' } : {})}>
          {inline(a[1])}
        </a>
      );
    }
    return s;
  });
}

/** Plain text of a Markdown string, for JSON-LD. The FAQ answers carry no Markdown, so this is the identity there. */
export const plain = (text: string) =>
  text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
