'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type TabDef = { id: string; label: string; panel: ReactNode };

/**
 * Page tabs synced to location.hash (WAI-ARIA tabs: arrow keys, Home, End).
 * Every panel is in the server HTML, so crawlers and no-JS readers get all of them.
 * A hash naming an element inside a panel (#join, #share-offers) opens that panel too.
 */
export function Tabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const [sel, setSel] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const fromHash = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      if (!hash) return;
      const direct = tabs.findIndex((t) => t.id === hash);
      if (direct >= 0) {
        setSel(direct);
        // Land on the tab bar, not the hidden anchor, so the tabs stay in view.
        requestAnimationFrame(() => document.getElementById(`${hash}-tab`)?.scrollIntoView());
        return;
      }
      const target = document.getElementById(hash);
      const owner = target?.closest<HTMLElement>('[role=tabpanel]');
      const inner = owner ? tabs.findIndex((t) => `${t.id}-panel` === owner.id) : -1;
      if (inner < 0) return;
      setSel(inner);
      // The panel was hidden when the browser tried to scroll, so scroll once it shows.
      requestAnimationFrame(() => target?.scrollIntoView());
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [tabs]);

  const choose = (i: number) => {
    setSel(i);
    const id = tabs[i]?.id;
    if (id) history.replaceState(null, '', i === 0 ? location.pathname + location.search : `#${id}`);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    const next =
      e.key === 'ArrowRight' ? (sel + 1) % n : e.key === 'ArrowLeft' ? (sel - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(next);
    buttons.current[next]?.focus();
  };

  return (
    <>
      <div className="hw-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${t.id}-tab`}
            aria-selected={sel === i}
            aria-controls={`${t.id}-panel`}
            tabIndex={sel === i ? 0 : -1}
            onClick={() => choose(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.id} className="hw-panel" role="tabpanel" id={`${t.id}-panel`} aria-labelledby={`${t.id}-tab`} hidden={sel !== i}>
          <span id={t.id} className="hw-anchor" aria-hidden="true" />
          {t.panel}
        </div>
      ))}
    </>
  );
}
