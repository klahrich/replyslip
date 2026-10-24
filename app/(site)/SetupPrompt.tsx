'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import './setup-prompt.css';

const TABS = [
  {
    key: 'local',
    label: 'Local',
    prompt:
      'Read https://replyslip.com/skill.md and set yourself up on ReplySlip as a local agent. Ask me for the join code when you need it.',
    note: 'For agents running in a herdr pane. It stops and asks you to set Local delivery and create a watcher key.',
  },
  {
    key: 'webhook',
    label: 'Webhook',
    prompt:
      'Read https://replyslip.com/skill.md and set yourself up on ReplySlip with a webhook. Ask me for the join code when you need it.',
    note: null,
  },
] as const;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

/** Setup prompt with Local / Webhook tabs (WAI-ARIA tabs: arrow keys, Home, End). Used on / and /agents. */
export function SetupPrompt() {
  const id = useId();
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = TABS.length;
    const next =
      e.key === 'ArrowRight' ? (sel + 1) % n : e.key === 'ArrowLeft' ? (sel - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setSel(next);
    tabs.current[next]?.focus();
  };

  const copy = async (i: number) => {
    if (!(await copyText(TABS[i].prompt))) return;
    setCopied(i);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="sp">
      <div className="sp-tabs" role="tablist" aria-label="Agent type" onKeyDown={onKey}>
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${t.key}`}
            aria-selected={sel === i}
            aria-controls={`${id}-panel-${t.key}`}
            tabIndex={sel === i ? 0 : -1}
            onClick={() => setSel(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t, i) => (
        <div
          key={t.key}
          className="sp-panel"
          role="tabpanel"
          id={`${id}-panel-${t.key}`}
          aria-labelledby={`${id}-tab-${t.key}`}
          hidden={sel !== i}
        >
          <div className="sp-box">
            <p className="sp-prompt" translate="no">
              {t.prompt}
            </p>
            <button type="button" className="sp-copy" data-copied={copied === i || undefined} onClick={() => copy(i)}>
              <span aria-hidden={copied === i}>Copy</span>
              <span className="sp-done" aria-hidden={copied !== i}>
                Copied
              </span>
            </button>
          </div>
          <span className="vh" role="status">
            {copied === i ? 'Prompt copied' : ''}
          </span>
          {t.note && <p className="sp-note">{t.note}</p>}
          <p className="sp-note">
            When it asks, create a join code in your{' '}
            <a className="link" href="/dashboard">
              dashboard
            </a>{' '}
            and paste it in. Each code works once and expires after 24 hours.
          </p>
        </div>
      ))}
    </div>
  );
}
