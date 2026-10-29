'use client';
/**
 * The Valetto early-access form. Validates in the browser, then POSTs JSON to /api/valetto/early-access
 * (contract: /workspace/valetto-early-access-contract.md). Shows success only on a 200 with { ok: true };
 * a 400 maps the server's per-field errors inline; anything else offers a prefilled email to Karim instead.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';

const ENDPOINT = '/api/valetto/early-access';
const CONTACT = 'karim@valetto.ai';

const INDUSTRIES = [
  ['retail', 'Retail / e-commerce'],
  ['services', 'Services / trades'],
  ['manufacturing', 'Manufacturing'],
  ['professional', 'Professional services'],
  ['other', 'Other'],
] as const;
const TEAM = [
  ['solo', 'Just me'],
  ['2-10', '2–10'],
  ['11-50', '11–50'],
  ['50+', '50+'],
] as const;
const GROK = [
  ['yes', 'Yes'],
  ['not_yet', 'Not yet'],
] as const;

type Key =
  | 'name'
  | 'email'
  | 'business'
  | 'website'
  | 'industry'
  | 'teamSize'
  | 'usesGrokBot'
  | 'customerJobs'
  | 'heardFrom';
type Values = Record<Key, string>;
type Errors = Partial<Record<Key, string>>;
type Status = 'idle' | 'sending' | 'sent' | 'failed';

const EMPTY: Values = {
  name: '',
  email: '',
  business: '',
  website: '',
  industry: '',
  teamSize: '',
  usesGrokBot: '',
  customerJobs: '',
  heardFrom: '',
};
const ORDER = Object.keys(EMPTY) as Key[];
const MAX: Record<Key, number> = {
  name: 100,
  email: 254,
  business: 120,
  website: 200,
  industry: 20,
  teamSize: 10,
  usesGrokBot: 10,
  customerJobs: 1000,
  heardFrom: 200,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.name) e.name = 'Add your name.';
  if (!v.email) e.email = 'Add your work email.';
  else if (!EMAIL_RE.test(v.email)) e.email = 'That email doesn’t look right.';
  if (!v.business) e.business = 'Add your business name.';
  if (v.website && !SITE_RE.test(v.website)) e.website = 'Use a web address like yourshop.com.';
  if (!v.industry) e.industry = 'Pick the closest match.';
  if (!v.teamSize) e.teamSize = 'Pick your team size.';
  if (!v.usesGrokBot) e.usesGrokBot = 'Pick Yes or Not yet.';
  if (!v.customerJobs) e.customerJobs = 'Tell us one or two things your customers would ask.';
  for (const k of ORDER) if (!e[k] && v[k].length > MAX[k]) e[k] = `Keep this under ${MAX[k]} characters.`;
  return e;
}

/** A mailto with the answers filled in, so a failed send loses nothing. */
function mailto(v: Values) {
  const label = (list: readonly (readonly [string, string])[], x: string) => list.find(([k]) => k === x)?.[1] ?? '';
  const body = [
    `Name: ${v.name}`,
    `Business: ${v.business}`,
    v.website && `Website: ${v.website}`,
    `What the business does: ${label(INDUSTRIES, v.industry)}`,
    `Team size: ${label(TEAM, v.teamSize)}`,
    `Uses a Grok bot: ${label(GROK, v.usesGrokBot)}`,
    `What customers would ask: ${v.customerJobs}`,
    v.heardFrom && `Heard about Valetto: ${v.heardFrom}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `mailto:${CONTACT}?subject=${encodeURIComponent('Valetto early access')}&body=${encodeURIComponent(body)}`;
}

export function EarlyAccessForm() {
  const [v, setV] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>('idle');
  const form = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLDivElement>(null);

  // Move focus (and the view) to the confirmation once it replaces the form.
  useEffect(() => {
    if (status === 'sent') done.current?.focus();
  }, [status]);

  const set = (k: Key, x: string) => {
    setV((old) => ({ ...old, [k]: x }));
    if (errors[k]) setErrors((old) => ({ ...old, [k]: undefined }));
  };

  const focusFirst = (e: Errors) => {
    const first = ORDER.find((k) => e[k]);
    if (first) form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const clean = Object.fromEntries(ORDER.map((k) => [k, v[k].trim()])) as Values;
    const e = validate(clean);
    setErrors(e);
    if (Object.keys(e).length) return focusFirst(e);
    setStatus('sending');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...clean,
          website: clean.website || null,
          heardFrom: clean.heardFrom || null,
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      const body = (data ?? {}) as { ok?: boolean; errors?: Errors };
      if (res.ok && body.ok === true) return setStatus('sent');
      if (res.status === 400 && body.errors && typeof body.errors === 'object') {
        const se: Errors = {};
        for (const k of ORDER) if (typeof body.errors[k] === 'string') se[k] = body.errors[k];
        if (Object.keys(se).length) {
          setErrors(se);
          setStatus('idle');
          return focusFirst(se);
        }
      }
      setStatus('failed');
    } catch {
      setStatus('failed');
    }
  }

  if (status === 'sent') {
    return (
      <div ref={done} className="vt-ea-done" role="status" tabIndex={-1}>
        <span className="vt-ea-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2>Thanks, {v.name.trim().split(/\s+/)[0]}. We got your request.</h2>
        <p>
          Karim will reply from <b>{CONTACT}</b>. Add that address to your contacts so his email doesn’t land in spam.
        </p>
      </div>
    );
  }

  const err = (k: Key) =>
    errors[k] ? (
      <span className="vt-ea-err" id={`${k}-err`}>
        {errors[k]}
      </span>
    ) : null;
  const aria = (k: Key) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${k}-err` : undefined,
  });
  const text = (k: Key, label: string, opts: { type?: string; auto?: string; optional?: boolean; ph?: string } = {}) => (
    <div className="vt-ea-f">
      <label htmlFor={k}>
        {label}
        {opts.optional ? <small>Optional</small> : null}
      </label>
      <input
        id={k}
        name={k}
        type={opts.type ?? 'text'}
        autoComplete={opts.auto}
        placeholder={opts.ph}
        value={v[k]}
        onChange={(e) => set(k, e.target.value)}
        {...aria(k)}
      />
      {err(k)}
    </div>
  );
  const pills = (k: Key, legend: string, list: readonly (readonly [string, string])[]) => (
    <fieldset className="vt-ea-f" {...aria(k)}>
      <legend>{legend}</legend>
      <span className="vt-ea-pills">
        {list.map(([val, lab]) => (
          <label key={val} className={v[k] === val ? 'on' : undefined}>
            <input
              type="radio"
              name={k}
              value={val}
              checked={v[k] === val}
              onChange={() => set(k, val)}
            />
            {lab}
          </label>
        ))}
      </span>
      {err(k)}
    </fieldset>
  );

  return (
    <form ref={form} className="vt-ea-form" noValidate onSubmit={submit} aria-busy={status === 'sending'}>
      <div className="vt-ea-pair">
        {text('name', 'Your name', { auto: 'name' })}
        {text('email', 'Work email', { type: 'email', auto: 'email', ph: 'you@yourshop.com' })}
      </div>
      <div className="vt-ea-pair">
        {text('business', 'Business name', { auto: 'organization' })}
        {text('website', 'Website', { type: 'url', auto: 'url', optional: true, ph: 'yourshop.com' })}
      </div>
      <div className="vt-ea-f">
        <label htmlFor="industry">What does your business do?</label>
        <span className="vt-ea-select">
          <select id="industry" name="industry" value={v.industry} onChange={(e) => set('industry', e.target.value)} {...aria('industry')}>
            <option value="" disabled>
              Pick one
            </option>
            {INDUSTRIES.map(([val, lab]) => (
              <option key={val} value={val}>
                {lab}
              </option>
            ))}
          </select>
        </span>
        {err('industry')}
      </div>
      {pills('teamSize', 'Team size', TEAM)}
      {pills('usesGrokBot', 'Do you already use a Grok bot?', GROK)}
      <div className="vt-ea-f">
        <label htmlFor="customerJobs">What would your customers ask your bot to do?</label>
        <textarea
          id="customerJobs"
          name="customerJobs"
          rows={4}
          placeholder="For example: check an order’s status, or quote a custom size."
          value={v.customerJobs}
          onChange={(e) => set('customerJobs', e.target.value)}
          {...aria('customerJobs')}
        />
        {err('customerJobs')}
      </div>
      {text('heardFrom', 'How did you hear about Valetto?', { optional: true })}
      <div className="vt-ea-go">
        <button className="btn vt-btn" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Ask for early access'}
        </button>
        {status === 'failed' ? (
          <p className="vt-ea-fail" role="alert">
            Couldn’t send. Email{' '}
            <a className="link" href={mailto(v)}>
              {CONTACT}
            </a>{' '}
            and we’ll take it from there. That link fills in your answers.
          </p>
        ) : null}
      </div>
    </form>
  );
}
