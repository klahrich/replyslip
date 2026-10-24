'use client';

import { useRef, useState } from 'react';
import { MARKETING_CONSENT_TEXT } from '@/components/site/marketing-consent';
import { api, errorText } from './api';

type MeResponse = { user: { marketing_opt_in: boolean } };

/**
 * Marketing email choice (PATCH /api/v1/auth/me). The switch flips right away
 * and goes back if the request fails. Turning it on sends the same wording the
 * sign-in checkbox shows, because the API keeps that wording as the consent.
 */
export function EmailPrefs({ initialOptIn }: { initialOptIn: boolean }) {
  const [on, setOn] = useState(initialOptIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  async function change(next: boolean) {
    const prev = on;
    const req = ++latest.current;
    setOn(next);
    setBusy(true);
    setError('');
    try {
      const { user } = await api<MeResponse>('/api/v1/auth/me', {
        method: 'PATCH',
        body: next ? { marketing_opt_in: true, consent_text: MARKETING_CONSENT_TEXT } : { marketing_opt_in: false },
      });
      if (req === latest.current) setOn(user.marketing_opt_in);
    } catch (err) {
      if (req === latest.current) {
        setOn(prev);
        setError(`Couldn’t save that. ${errorText(err)}`);
      }
    } finally {
      if (req === latest.current) setBusy(false);
    }
  }

  return (
    <section className="dash-card" aria-labelledby="emails-h">
      <h2 id="emails-h">Emails</h2>
      <div className="dash-switch-row">
        <input
          id="marketing-opt-in"
          className="dash-switch"
          type="checkbox"
          role="switch"
          checked={on}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
          aria-describedby="marketing-msg"
        />
        <label htmlFor="marketing-opt-in">{MARKETING_CONSENT_TEXT}</label>
      </div>
      <p className={error ? 'dash-err' : 'dash-muted'} id="marketing-msg" role="status" aria-live="polite">
        {error || 'Sign-in codes always arrive, whatever you pick here.'}
      </p>
    </section>
  );
}
