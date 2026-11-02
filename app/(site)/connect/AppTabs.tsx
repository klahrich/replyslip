'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type AppTab = { key: string; label: string; body: ReactNode };

/** Small tabs for "paste it into your app": one panel per app, arrow keys move between tabs. */
export function AppTabs({ tabs }: { tabs: AppTab[] }) {
  const [active, setActive] = useState(0);
  const ids = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="cx-tabs">
      <div className="cx-tablist" role="tablist" aria-label="Your app" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${ids}-t-${t.key}`}
            aria-controls={`${ids}-p-${t.key}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.key}
          className="cx-panel"
          role="tabpanel"
          id={`${ids}-p-${t.key}`}
          aria-labelledby={`${ids}-t-${t.key}`}
          hidden={i !== active}
          data-app={t.key}
        >
          {t.body}
        </div>
      ))}
    </div>
  );
}
