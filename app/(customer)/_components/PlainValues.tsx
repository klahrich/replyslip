import type { DisplayRow, ResultDisplayRow } from '../_lib/types';

/** Bot output is untrusted (spec 15.7): rendered as React text only. An https URL may become a link. */
function Value({ row }: { row: DisplayRow | ResultDisplayRow }) {
  const kind = 'kind' in row ? row.kind : 'text';
  if (kind === 'json') return <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-3 text-[13px] leading-relaxed">{row.value}</pre>;
  if (kind === 'text' && /^https:\/\/\S+$/.test(row.value)) {
    return (
      <a href={row.value} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary-text underline underline-offset-4">
        {row.value}
      </a>
    );
  }
  return <span className="break-words whitespace-pre-wrap">{row.value}</span>;
}

export function PlainValues({ rows, emphasize = false }: { rows: (DisplayRow | ResultDisplayRow)[]; emphasize?: boolean }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div key={row.key} className="grid gap-0.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className={emphasize ? 'text-[16px] font-medium' : 'text-[15px]'}>
            <Value row={row} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
