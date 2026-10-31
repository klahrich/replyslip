'use client';

/**
 * Site assistant demo chat (spec Story 3, slim story 0 cut). Self-contained: give it the loaded
 * conversation and the token; it sends through `demoApi` and keeps its own state.
 * No contact capture anywhere in the demo. Replies aren't streamed: one checked reply per message.
 * Message text, the banner and the notice are always React text nodes, never HTML.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, RotateCw } from 'lucide-react';
import { LogoTile } from '../Frame';
import { brandStyle } from '../../_lib/brand';
import { demoApi } from '../../_lib/site-demo-api';
import { DemoApiError, type DemoConversation, type DemoMessage, type Lang, type ReplyStatus, type SuggestedQuestion } from '../../_lib/site-demo-types';
import { SITE_STRINGS } from '../../_lib/site-strings';
import { cn } from '../../_lib/utils';

export type GoneKind = 'dead' | 'expired';

type Item = {
  key: string;
  role: 'visitor' | 'assistant' | 'owner';
  body: string;
  status: ReplyStatus | null;
  /** Visitor rows only: set when the send failed and can be retried with the same id. */
  failed?: boolean;
  /** New in this visit: animate in. Restored rows don't. */
  fresh?: boolean;
  /** needs_owner only: the server's demo note (why it went to the owner). */
  note?: string | null;
};

const DEFAULT_MAX = 1000;

function toItem(m: DemoMessage, fresh?: boolean): Item {
  return { key: m.id, role: m.role, body: m.body, status: m.status, note: m.demo_note ?? null, fresh };
}

function pickSuggestions(all: SuggestedQuestion[], lang: Lang): SuggestedQuestion[] {
  const own = all.filter((s) => s.language === lang);
  return (own.length ? own : all).slice(0, 3);
}

export function DemoChat({
  token,
  conversation,
  lang,
  onLangChange,
  onGone,
  className,
}: {
  token: string;
  conversation: DemoConversation;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  onGone: (kind: GoneKind) => void;
  className?: string;
}) {
  const t = SITE_STRINGS[lang];
  const { business } = conversation;
  const demo = business.status === 'unclaimed';
  const max = conversation.message_max_chars && conversation.message_max_chars > 0 ? conversation.message_max_chars : DEFAULT_MAX;
  const notice = conversation.notice?.[lang] ?? null;
  const [items, setItems] = useState<Item[]>(() => conversation.messages.map((m) => toItem(m)));
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [capped, setCapped] = useState(false);
  const [inline, setInline] = useState<'tooLong' | 'rateLimited' | 'busy' | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => pickSuggestions(conversation.suggested_questions, lang), [conversation.suggested_questions, lang]);
  const branding = useMemo(
    () => ({
      display_name: business.name,
      logo_url: business.tile.logo_url,
      logo_width: null,
      logo_height: null,
      primary_color: business.tile.color,
      primary_foreground: '#FFFFFF',
      accent_color: null,
      accent_foreground: null,
      show_footer: true as const,
    }),
    [business],
  );

  useEffect(() => {
    if (items.length || thinking) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [items.length, thinking]);

  const disabled = thinking || capped;

  function fail(e: unknown, clientId: string) {
    const err = e instanceof DemoApiError ? e : new DemoApiError(0, 'network_error', '');
    if (err.status === 410) return onGone('expired');
    if (err.status === 404) return onGone('dead');
    if (err.status === 429 && err.code === 'daily_limit') {
      // Daily cap: the server kept nothing, so drop the unsent question, close the input, explain.
      setItems((xs) => xs.filter((x) => x.key !== clientId));
      return setCapped(true);
    }
    if (err.status === 429) setInline('rateLimited');
    if (err.status === 400 && err.code === 'message_too_long') setInline('tooLong');
    if (err.status === 409) setInline('busy');
    // Each message has its own client_message_id and Try again reuses it. If the server says the id
    // already belongs to another question, Try again sends this one under a fresh id instead.
    const key = err.status === 409 && err.code === 'client_message_id_reused' ? crypto.randomUUID() : clientId;
    setItems((xs) => xs.map((x) => (x.key === clientId ? { ...x, key, failed: true } : x)));
  }

  async function post(clientId: string, body: string) {
    setThinking(true);
    setInline(null);
    setItems((xs) => xs.map((x) => (x.key === clientId ? { ...x, failed: false } : x)));
    try {
      const { message } = await demoApi.send(token, { client_message_id: clientId, text: body });
      setItems((xs) => [...xs, toItem(message, true)]);
    } catch (e) {
      fail(e, clientId);
    } finally {
      setThinking(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function submit(ev?: FormEvent) {
    ev?.preventDefault();
    if (disabled) return;
    const body = text.trim();
    if (!body) return;
    if (body.length > max) return setInline('tooLong');
    const clientId = crypto.randomUUID();
    setItems((xs) => [...xs, { key: clientId, role: 'visitor', body, status: null, fresh: true }]);
    setText('');
    void post(clientId, body);
  }

  function tap(sq: SuggestedQuestion) {
    if (disabled) return;
    const clientId = crypto.randomUUID();
    // The stored answer is already checked: show it at once, record the tap in the background (no model call).
    setItems((xs) => [
      ...xs,
      { key: clientId, role: 'visitor', body: sq.question, status: null, fresh: true },
      { key: `${clientId}-a`, role: 'assistant', body: sq.answer, status: 'answered', fresh: true },
    ]);
    demoApi.send(token, { client_message_id: clientId, suggested_question_id: sq.id }).catch((e: unknown) => {
      if (!(e instanceof DemoApiError)) return;
      if (e.status === 410) onGone('expired');
      // Only a dead link ends the page; a suggestion withdrawn since the page loaded keeps the answer on screen.
      else if (e.status === 404 && e.code !== 'suggested_question_not_found') onGone('dead');
    });
  }

  function onKey(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      submit();
    }
  }

  const speaker = (it: Item) => (it.role === 'visitor' ? t.you : business.name);

  return (
    <section
      aria-label={business.name}
      style={brandStyle(branding)}
      className={cn(
        'flex flex-col bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.08)] md:shadow-2xl md:ring-1 md:ring-black/5',
        'animate-in fade-in slide-in-from-bottom-6 duration-300 ease-out motion-reduce:animate-none md:slide-in-from-bottom-0 md:slide-in-from-right-8',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <LogoTile branding={branding} size={36} />
          <h1 className="min-w-0 text-[16px] leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">{business.name}</h1>
        </div>
        <LangSwitch lang={lang} onChange={onLangChange} />
      </header>

      <div className="flex-1 px-4 pt-4 pb-2 md:min-h-0 md:overflow-y-auto">
        <div role="log" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2.5">
          <Bubble role="assistant" speaker={business.name}>
            {t.greeting(business.name)}
          </Bubble>
          {items.map((it) => (
            <div key={it.key} className="flex flex-col gap-1.5">
              <Bubble role={it.role} speaker={speaker(it)} fresh={it.fresh}>
                {it.body}
              </Bubble>
              {it.failed && (
                <div className="flex items-center justify-end gap-2 text-[13px] text-destructive">
                  <span>{t.notSent}</span>
                  <button
                    type="button"
                    disabled={thinking}
                    onClick={() => void post(it.key, it.body)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 font-medium underline underline-offset-4 disabled:opacity-50"
                  >
                    <RotateCw className="size-3.5" aria-hidden />
                    {t.tryAgain}
                  </button>
                </div>
              )}
              {demo && it.role === 'assistant' && it.status === 'needs_owner' && (
                <p data-testid="demo-note" className="mr-8 rounded-lg bg-muted px-3 py-2 text-[13px] leading-snug text-muted-foreground animate-in fade-in duration-300 motion-reduce:animate-none">
                  {it.note || t.demoNote}
                </p>
              )}
            </div>
          ))}
        </div>

        {thinking && (
          <div role="status" className="mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground animate-in fade-in duration-150">
            <span aria-hidden className="flex gap-1 rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2.5">
              {[0, 150, 300].map((d) => (
                <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            <span>{t.thinking}</span>
          </div>
        )}

        {items.length === 0 && suggestions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[13px] text-muted-foreground">{t.youCanAsk}</p>
            <div className="flex flex-col items-start gap-2">
              {suggestions.map((sq) => (
                <button
                  key={sq.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => tap(sq)}
                  className="max-w-full rounded-full border border-border bg-background px-3.5 py-2 text-left text-[14px] leading-snug transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-50 [overflow-wrap:anywhere]"
                >
                  {sq.question}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-0 border-t border-border bg-card px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {capped && <p className="mb-2 px-1 text-[13px] text-muted-foreground">{t.demoCap}</p>}
        {inline && (
          <p role="alert" className="mb-2 px-1 text-[13px] text-destructive">
            {inline === 'tooLong' ? t.tooLong(max) : inline === 'busy' ? t.busy : t.rateLimited}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="vt-demo-input" className="sr-only">
            {t.inputLabel}
          </label>
          <textarea
            id="vt-demo-input"
            ref={inputRef}
            value={text}
            rows={1}
            disabled={disabled}
            placeholder={t.inputLabel}
            onChange={(e) => {
              setText(e.target.value);
              if (inline === 'tooLong' && e.target.value.trim().length <= max) setInline(null);
            }}
            onKeyDown={onKey}
            aria-describedby={[notice && items.length === 0 ? 'vt-demo-notice' : null, text.length > max - 100 ? 'vt-demo-count' : null].filter(Boolean).join(' ') || undefined}
            className="max-h-[7.5rem] min-h-11 flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-base leading-6 [field-sizing:content] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || !text.trim()}
            aria-label={t.send}
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-transform active:scale-95 disabled:opacity-40"
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </div>
        {text.length > max - 100 && (
          <p id="vt-demo-count" className={cn('mt-1 px-1 text-right text-[12px]', text.length > max ? 'text-destructive' : 'text-muted-foreground')}>
            {t.chars(text.length, max)}
          </p>
        )}
        {/* The server's notice, as a plain text node, until the first message. */}
        {notice && items.length === 0 && (
          <p id="vt-demo-notice" data-testid="notice" className="mt-2 px-1 text-[12px] leading-snug text-muted-foreground">
            {notice}
          </p>
        )}
      </form>
    </section>
  );
}

function Bubble({ role, speaker, fresh, children }: { role: Item['role']; speaker: string; fresh?: boolean; children: string }) {
  const mine = role === 'visitor';
  return (
    <div className={cn('flex', mine ? 'justify-end pl-10' : 'justify-start pr-8')}>
      <p
        data-role={role}
        className={cn(
          'max-w-full rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]',
          mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-background text-foreground',
          fresh && 'animate-in fade-in zoom-in-95 duration-200 ease-out motion-reduce:animate-none',
          fresh && (mine ? 'origin-bottom-right' : 'origin-bottom-left'),
        )}
      >
        <span className="sr-only">{speaker}: </span>
        {children}
      </p>
    </div>
  );
}

export function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  return (
    <div className="flex shrink-0 items-center text-[13px]">
      {(['en', 'fr'] as const).map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span aria-hidden className="px-0.5 text-muted-foreground">·</span>}
          <button
            type="button"
            lang={l}
            aria-pressed={lang === l}
            onClick={() => onChange(l)}
            className={cn('min-h-9 rounded-md px-1.5', lang === l ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {l === 'en' ? 'English' : 'Français'}
          </button>
        </span>
      ))}
    </div>
  );
}
