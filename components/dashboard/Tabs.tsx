'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type Tab = { id: string; label: string; content: ReactNode };

/**
 * Hash-synced tabs. #<tab id> opens that tab. Any other hash (an anchor like #agents) opens the first tab,
 * so existing in-page links keep working.
 */
export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const first = tabs[0]?.id ?? '';
  const [active, setActive] = useState(first);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      setActive(tabs.some((t) => t.id === hash) ? hash : first);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [tabs, first]);

  function select(id: string, focus = false) {
    setActive(id);
    // replaceState keeps tab switches out of the back-button history.
    history.replaceState(null, '', id === first ? window.location.pathname + window.location.search : `#${id}`);
    if (focus) refs.current[id]?.focus();
  }

  function onKey(ev: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      ev.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : ev.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : ev.key === 'Home' ? 0
      : ev.key === 'End' ? last
      : null;
    if (next === null) return;
    ev.preventDefault();
    select(tabs[next]!.id, true);
  }

  return (
    <>
      <div className="dash-tabs" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-controls={`panel-${t.id}`}
            aria-selected={active === t.id}
            tabIndex={active === t.id ? 0 : -1}
            className="dash-tab"
            onClick={() => select(t.id)}
            onKeyDown={(ev) => onKey(ev, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={active !== t.id}
          className="dash-tabpanel"
        >
          {t.content}
        </div>
      ))}
    </>
  );
}
