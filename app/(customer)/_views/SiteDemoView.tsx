'use client';

/**
 * /s/demo/<token>: the private site assistant demo (spec Story 1 and 3, slim story 0 cut).
 * Mobile first: banner, a strip of the business's site, then the chat. From 768px the site fills
 * the screen and the chat docks on the right. The page scrolls normally; nothing locks scrolling.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DemoBackdrop } from '../_components/site-demo/DemoBackdrop';
import { DemoChat, LangSwitch, type GoneKind } from '../_components/site-demo/DemoChat';
import { demoApi } from '../_lib/site-demo-api';
import { DemoApiError, type DemoConversation, type Lang } from '../_lib/site-demo-types';
import { SITE_STRINGS } from '../_lib/site-strings';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; conversation: DemoConversation }
  | { kind: 'gone'; why: GoneKind }
  | { kind: 'error'; rateLimited: boolean };

const LANG_KEY = 'vt-demo-lang';

export function SiteDemoView({ token, initialLang }: { token: string; initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const t = SITE_STRINGS[lang];

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'fr') setLang(saved);
  }, []);
  const changeLang = useCallback((l: Lang) => {
    setLang(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  // Only the latest load may set state, so a slow first request can't overwrite a retry.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setState({ kind: 'loading' });
    try {
      const conversation = await demoApi.load(token);
      if (seq === loadSeq.current) setState({ kind: 'ready', conversation });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const err = e instanceof DemoApiError ? e : null;
      if (err?.status === 410) setState({ kind: 'gone', why: 'expired' });
      else if (err?.status === 404) setState({ kind: 'gone', why: 'dead' });
      else setState({ kind: 'error', rateLimited: err?.status === 429 });
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const name = state.kind === 'ready' ? state.conversation.business.name : null;
  useEffect(() => {
    document.title = name ? `${name} · Valetto` : 'Valetto';
  }, [name]);

  if (state.kind === 'gone' || state.kind === 'error') {
    const title = state.kind === 'gone' ? (state.why === 'expired' ? t.expiredTitle : t.deadTitle) : null;
    const body = state.kind === 'gone' ? (state.why === 'expired' ? t.expiredBody : t.deadBody) : state.rateLimited ? t.rateLimited : t.loadFailed;
    return (
      <div lang={lang} className="flex min-h-dvh flex-col px-4">
        <div className="flex justify-end pt-3">
          <LangSwitch lang={lang} onChange={changeLang} />
        </div>
        <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center pb-24">
          <div data-testid={state.kind === 'gone' ? `screen-${state.why}` : 'screen-error'} className="rounded-2xl border border-border bg-card p-6 shadow-sm animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
            {title && <h1 className="mb-2 text-[20px] leading-snug font-semibold tracking-tight">{title}</h1>}
            <p className="text-[15px] text-muted-foreground">{body}</p>
            {state.kind === 'error' && (
              <button type="button" onClick={() => void load()} className="mt-5 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[15px] font-medium text-primary-foreground active:scale-[0.98]">
                {t.tryAgain}
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  const conversation = state.kind === 'ready' ? state.conversation : null;
  return (
    <div lang={lang} className="flex min-h-dvh flex-col md:h-dvh md:min-h-0">
      <p data-testid="banner" className="sticky top-0 z-30 border-b border-border bg-white/95 px-4 py-2 text-center text-[12.5px] leading-snug text-muted-foreground backdrop-blur md:static">
        {conversation ? conversation.banner[lang] : '\u00a0'}
      </p>
      <div className="relative flex flex-1 flex-col md:min-h-0">
        {/* The shot loads only once the token checks out, so a dead or expired link never requests it. */}
        {conversation ? (
          <DemoBackdrop token={token} className="relative h-[120px] shrink-0 md:absolute md:inset-0 md:h-auto" />
        ) : (
          <div aria-hidden className="relative h-[120px] shrink-0 bg-muted md:absolute md:inset-0 md:h-auto" />
        )}
        {conversation ? (
          <DemoChat
            token={token}
            conversation={conversation}
            lang={lang}
            onLangChange={changeLang}
            onGone={(why) => setState({ kind: 'gone', why })}
            className="relative z-10 -mt-4 flex-1 rounded-t-2xl md:absolute md:top-6 md:right-6 md:bottom-6 md:mt-0 md:w-[400px] md:rounded-2xl"
          />
        ) : (
          <div role="status" className="relative z-10 -mt-4 flex flex-1 items-start justify-center rounded-t-2xl bg-card pt-16 md:absolute md:top-6 md:right-6 md:bottom-6 md:mt-0 md:w-[400px] md:rounded-2xl">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            <span className="sr-only">{t.loading}</span>
          </div>
        )}
      </div>
    </div>
  );
}
