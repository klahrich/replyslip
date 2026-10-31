import type { ReactNode } from 'react';
import { cn } from '../_lib/utils';

/** A calm full-width message card: waiting, revoked, limits, dead links. */
const heading = 'text-[22px] leading-snug font-semibold tracking-tight';

export function Notice({ icon, title, children, action, className, level = 'h1' }: { icon?: ReactNode; title: string; level?: 'h1' | 'h2'; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8', className)}>
      {icon && <div className="mb-5 grid size-12 place-items-center rounded-full bg-accent text-primary-text [&_svg]:size-6">{icon}</div>}
      {level === 'h1' ? <h1 className={heading}>{title}</h1> : <h2 className={heading}>{title}</h2>}
      {children && <div className="mt-2 grid gap-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>}
      {action && <div className="mt-6 flex flex-col gap-3">{action}</div>}
    </section>
  );
}
