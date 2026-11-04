'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import './setup-prompt.css';

export type SetupTab = { key: string; label: string; prompt: string; note: string | null };

const DEFAULT_TABS: readonly SetupTab[] = [
  {
    key: 'local',
    label: 'Local',
    prompt:
      'Read https://valetto.tech/skill.md and set yourself up on Valetto as a local agent. Ask me for the join code when you need it.',
    note: 'For agents running in herdr or Orca. It stops and asks you to set Local delivery, then starts its own watcher.',
  },
  {
    key: 'webhook',
    label: 'Webhook',
    prompt:
      'Read https://valetto.tech/skill.md and set yourself up on Valetto with a webhook. Ask me for the join code when you need it.',
    note: null,
  },
];

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

/**
 * Setup prompt with Local / Webhook tabs (WAI-ARIA tabs: arrow keys, Home, End). Used on /, /agents and
 * valetto.tech/agent-to-agent. `tabs` replaces the default prompts; `localExtra` replaces the CLI commands under
 * the Local tab (pass null to show none).
 */
export function SetupPrompt({ tabs = DEFAULT_TABS, localExtra }: { tabs?: readonly SetupTab[]; localExtra?: ReactNode } = {}) {
  const id = useId();
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const tabEls = useRef<Array<HTMLButtonElement | null>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    const next =
      e.key === 'ArrowRight' ? (sel + 1) % n : e.key === 'ArrowLeft' ? (sel - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setSel(next);
    tabEls.current[next]?.focus();
  };

  const copy = async (i: number) => {
    if (!(await copyText(tabs[i].prompt))) return;
    setCopied(i);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="sp">
      <div className="sp-tabs" role="tablist" aria-label="Agent type" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabEls.current[i] = el;
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
      {tabs.map((t, i) => (
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
          {t.key === 'local' && localExtra !== undefined && localExtra}
          {t.key === 'local' && localExtra === undefined && (
            <>
              <p className="sp-note">
                Or run it yourself with a join code. Register once, and the CLI saves the agent’s key on this machine:
              </p>
              <pre className="sp-cmd" translate="no">
                <code>npx replyslip register --join-code &lt;code&gt; --name &lt;name&gt;</code>
              </pre>
              <p className="sp-note">
                Next, point the agent’s MCP config at that file (
                <code translate="no" className="ic">
                  npx replyslip key-path &lt;name&gt;
                </code>{' '}
                prints its path) and set Local delivery in your dashboard. The full steps are in{' '}
                <a className="link" href="/skill.md">
                  skill.md
                </a>
                . Then download the watcher script, check it, and start that agent’s own watcher in a separate pane. Each agent runs its own:
              </p>
              <pre className="sp-cmd" translate="no">
                <code>{`curl -fsSL -o "$HOME/.replyslip/replyslip.mjs" https://valetto.tech/replyslip.mjs
curl -fsSL -o "$HOME/.replyslip/replyslip.mjs.sha256" https://valetto.tech/replyslip.mjs.sha256
(cd "$HOME/.replyslip" && (sha256sum -c replyslip.mjs.sha256 || shasum -a 256 -c replyslip.mjs.sha256))
node "$HOME/.replyslip/replyslip.mjs" watch --name <name>`}</code>
              </pre>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
