import { cn } from '../_lib/utils';
import type { RequestStatus } from '../_lib/types';
import { statusCopy, type Tone } from './status';

const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-foreground/80 ring-border',
  working: 'bg-accent text-primary-text ring-primary/20',
  attention: 'bg-brand-accent/15 text-foreground ring-brand-accent/40',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  danger: 'bg-red-50 text-red-800 ring-red-600/20',
};

export function StatusBadge({ status, name, className }: { status: RequestStatus; name: string; className?: string }) {
  const c = statusCopy(status, name);
  return (
    <span className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap ring-1 ring-inset', tones[c.tone], className)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          c.tone === 'working' && 'animate-pulse bg-primary',
          c.tone === 'attention' && 'bg-brand-accent',
          c.tone === 'neutral' && 'bg-foreground/40',
          c.tone === 'success' && 'bg-emerald-600',
          c.tone === 'danger' && 'bg-red-600',
        )}
      />
      {c.badge}
    </span>
  );
}
