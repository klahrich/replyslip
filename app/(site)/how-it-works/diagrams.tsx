import type { ReactNode } from 'react';

/* Hand-built diagrams for /how-it-works. Plain HTML boxes and CSS arrows, no client JS. */

type Kind = 'agent' | 'relay' | 'human' | 'plain';

export function Box({ kind = 'agent', title, sub }: { kind?: Kind; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className={`hw-box hw-${kind}`}>
      <span className="hw-box-t">{title}</span>
      {sub ? <span className="hw-box-s">{sub}</span> : null}
    </div>
  );
}

export function Arrow({ label, back = false }: { label?: ReactNode; back?: boolean }) {
  return (
    <div className={back ? 'hw-arrow hw-back' : 'hw-arrow'} aria-hidden="true">
      {label ? <span className="hw-arrow-l">{label}</span> : null}
      <span className="hw-arrow-line" />
    </div>
  );
}

/** A left-to-right chain on wide screens, top-to-bottom on phones. */
export function Flow({ children, label, back = false }: { children: ReactNode; label: string; back?: boolean }) {
  return (
    <div className={back ? 'hw-flow hw-flow-back' : 'hw-flow'} role="img" aria-label={label}>
      {children}
    </div>
  );
}

export function Pill({ s }: { s: 'open' | 'needs_info' | 'done' | 'failed' }) {
  return (
    <code translate="no" className={`hw-pill hw-pill-${s}`}>
      {s}
    </code>
  );
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code translate="no" className="ic">
      {children}
    </code>
  );
}

export function Fig({ children }: { children: ReactNode }) {
  return <div className="hw-fig">{children}</div>;
}
