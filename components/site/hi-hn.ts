import { REF_KEY, REF_TTL_MS } from './ref-keep';

/** Set once the visitor closes the note, so it stays closed for the rest of the tab. */
export const HI_HN_OFF_KEY = 'replyslip_hi_hn_off';

/**
 * Adds `hi-hn-on` to <html> when this visitor came from HN: `ref` (or `utm_source`) in the URL first,
 * then the ref SignInLink kept in sessionStorage. Same precedence as SignInLink's currentRef.
 * Kept self-contained because it also runs as an inline script, before first paint.
 */
export function applyHiHn(refKey: string, ttl: number, offKey: string) {
  try {
    const html = document.documentElement;
    if (sessionStorage.getItem(offKey)) return;
    const q = new URLSearchParams(location.search);
    let ref = (q.get('ref') || q.get('utm_source') || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(ref)) {
      const kept = JSON.parse(sessionStorage.getItem(refKey) || 'null');
      ref = kept && typeof kept.at === 'number' && Date.now() - kept.at < ttl ? String(kept.ref) : '';
    }
    if (ref === 'hn') html.classList.add('hi-hn-on');
  } catch {
    // Storage blocked or bad JSON: no note.
  }
}

/** Runs where the note sits in the HTML, so it shows on first paint and nothing below it moves. */
export const HI_HN_SCRIPT = `(${applyHiHn.toString()})(${JSON.stringify(REF_KEY)},${REF_TTL_MS},${JSON.stringify(HI_HN_OFF_KEY)})`;
export const HI_HN_ARGS = [REF_KEY, REF_TTL_MS, HI_HN_OFF_KEY] as const;
