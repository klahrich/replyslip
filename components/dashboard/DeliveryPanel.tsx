'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, api, errorText } from './api';
import type { Agent, Delivery, SecretMask, TestWakeResult, Wake } from './types';

type Mode = 'none' | 'webhook' | 'local';
type AuthType = 'none' | 'bearer' | 'hmac' | 'headers';
type Field = 'url' | 'token' | 'secret' | 'headers' | 'driver' | 'target' | 'form';
type Errors = Partial<Record<Field, string>>;
type HeaderRow = { key: number; name: string; value: string };

/** Mirrors the server's rules in lib/delivery.ts so most mistakes are caught before a round trip. */
const PANE_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_TARGET = 200;
/** `$ORCA_PANE_KEY` is `tabId:leafId`: one colon, no whitespace, both sides non-empty (same rule as the CLI's orca driver). */
const ORCA_PANE_KEY = /^[^\s:]+:[^\s:]+$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'content-type', 'authorization']);
const MAX_HEADERS = 20;
const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 30000;

const AUTH_LABEL: Record<AuthType, string> = {
  none: 'No auth',
  bearer: 'Bearer token',
  hmac: 'HMAC signature',
  headers: 'Static headers',
};

function modeOf(d: Delivery): Mode {
  if (d.mode === 'herdr') return 'local';
  return d.mode;
}

function authOf(d: Delivery): AuthType {
  const t = d.auth_type;
  return t === 'bearer' || t === 'hmac' || t === 'headers' ? t : 'none';
}

function maskText(m: SecretMask): string {
  return m.last4 ? `Set, ends in ••••${m.last4}` : 'Set';
}

function minutes(seconds: number): string {
  const n = Math.max(1, Math.ceil(seconds / 60));
  return `${n} ${n === 1 ? 'minute' : 'minutes'}`;
}

type WakeState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'webhook'; ok: boolean; status?: number; error?: string }
  | { kind: 'waiting'; wakeId: string }
  | { kind: 'delivered' }
  | { kind: 'failed'; error: string | null }
  | { kind: 'timeout' }
  | { kind: 'limited'; seconds: number | undefined }
  | { kind: 'error'; text: string };

export function DeliveryPanel({ agent, onSaved, onClose }: { agent: Agent; onSaved: () => void; onClose: () => void }) {
  const uid = useId();
  const [stored, setStored] = useState<Delivery>(agent.delivery);
  const storedMode = modeOf(stored);
  const storedAuth = authOf(stored);
  const storedWebhook = storedMode === 'webhook';

  const [mode, setMode] = useState<Mode>(storedMode);
  const [url, setUrl] = useState('');
  const [replaceUrl, setReplaceUrl] = useState(false);
  const [auth, setAuth] = useState<AuthType>(storedAuth);
  const [token, setToken] = useState('');
  const [replaceToken, setReplaceToken] = useState(false);
  const [secret, setSecret] = useState('');
  const [replaceSecret, setReplaceSecret] = useState(false);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [replaceHeaders, setReplaceHeaders] = useState(false);
  const [driver, setDriver] = useState(stored.driver ?? 'herdr');
  const [target, setTarget] = useState(stored.target ?? stored.pane ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wake, setWake] = useState<WakeState>({ kind: 'idle' });
  const nextKey = useRef(1);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // What the server already holds and will keep if we omit it (same mode and same auth type).
  const keepUrl = storedWebhook && stored.url_set;
  const keepToken = storedWebhook && storedAuth === 'bearer' && stored.token.set;
  const keepSecret = storedWebhook && storedAuth === 'hmac' && stored.secret.set;
  const keepHeaders = storedWebhook && storedAuth === 'headers' && stored.headers.length > 0;

  const sendUrl = !keepUrl || replaceUrl;
  const sendToken = auth === 'bearer' && (!keepToken || replaceToken);
  const sendSecret = auth === 'hmac' && (!keepSecret || replaceSecret);
  const sendHeaders = auth === 'headers' && (!keepHeaders || replaceHeaders);

  const dirty =
    mode !== storedMode ||
    (mode === 'webhook' && (auth !== storedAuth || replaceUrl || sendToken || sendSecret || sendHeaders || url !== '')) ||
    (mode === 'local' && (driver !== (stored.driver ?? 'herdr') || target.trim() !== (stored.target ?? stored.pane ?? '')));

  function newRow(name = ''): HeaderRow {
    return { key: nextKey.current++, name, value: '' };
  }

  function startReplaceHeaders() {
    // Values are write-only, so replacing means sending every header again. Keep the names as a starting point.
    setHeaders(stored.headers.length ? stored.headers.map((h) => newRow(h.name)) : [newRow()]);
    setReplaceHeaders(true);
  }

  function changeAuth(next: AuthType) {
    setAuth(next);
    setErrors({});
    if (next === 'headers' && !(keepHeaders && storedAuth === 'headers') && headers.length === 0) setHeaders([newRow()]);
  }

  function validate(): Errors {
    const e: Errors = {};
    if (mode === 'local') {
      const t = target.trim();
      if (driver === 'herdr') {
        if (!t) e.target = 'Enter the herdr pane name.';
        else if (!PANE_NAME.test(t)) e.target = 'Use 1–64 letters, numbers, dots, underscores or hyphens, with no spaces.';
      } else if (driver === 'orca') {
        if (!t || t.length > MAX_TARGET || /[\u0000-\u001f]/.test(t) || !ORCA_PANE_KEY.test(t)) {
          e.target = 'Enter the Orca pane key (looks like tabId:leafId).';
        }
      } else e.driver = 'Choose a driver.';
    }
    if (mode === 'webhook') {
      if (sendUrl) {
        const raw = url.trim();
        let parsed: URL | null = null;
        try {
          parsed = raw ? new URL(raw) : null;
        } catch {
          parsed = null;
        }
        if (!raw) e.url = 'Enter the webhook URL.';
        else if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) e.url = 'Enter a full URL starting with https://.';
        else if (parsed.username || parsed.password) e.url = 'Put credentials in the auth settings below, not in the URL.';
      }
      if (sendToken && !token) e.token = 'Enter the bearer token.';
      if (sendSecret && !secret) e.secret = 'Enter the HMAC secret.';
      if (sendHeaders) {
        const seen = new Set<string>();
        if (headers.length === 0) e.headers = 'Add at least one header.';
        else if (headers.length > MAX_HEADERS) e.headers = `Use at most ${MAX_HEADERS} headers.`;
        for (const h of headers) {
          const name = h.name.trim();
          if (e.headers) break;
          if (!HEADER_NAME.test(name)) e.headers = `“${name || 'Header name'}” isn’t a valid header name. Use letters, numbers and hyphens.`;
          else if (BLOCKED_HEADERS.has(name.toLowerCase())) e.headers = `${name} can’t be set here.`;
          else if (seen.has(name.toLowerCase())) e.headers = `${name} is listed twice.`;
          else if (!h.value) e.headers = `Enter a value for ${name}.`;
          seen.add(name.toLowerCase());
        }
      }
    }
    return e;
  }

  function body(): unknown {
    if (mode === 'none') return { mode: 'none' };
    if (mode === 'local') return { mode: 'local', driver, target: target.trim() };
    const a: Record<string, unknown> = { type: auth };
    if (sendToken) a.token = token;
    if (sendSecret) a.secret = secret;
    if (sendHeaders) a.headers = Object.fromEntries(headers.map((h) => [h.name.trim(), h.value]));
    return sendUrl ? { mode: 'webhook', url: url.trim(), auth: a } : { mode: 'webhook', auth: a };
  }

  function serverErrors(err: unknown): Errors {
    if (!(err instanceof ApiError)) return { form: errorText(err) };
    switch (err.code) {
      case 'invalid_webhook_url':
        return { url: err.message };
      case 'invalid_webhook_headers':
        return { headers: err.message };
      case 'secret_required':
        if (mode === 'webhook' && auth === 'bearer') return { token: err.message };
        if (mode === 'webhook' && auth === 'hmac') return { secret: err.message };
        if (mode === 'webhook' && auth === 'headers') return { headers: err.message };
        return { form: err.message };
      case 'validation_error': {
        const issues = (err.details as { issues?: { path?: string; message?: string }[] } | undefined)?.issues ?? [];
        const e: Errors = {};
        for (const i of issues) {
          const path = i.path ?? '';
          const field: Field = path.startsWith('target')
            ? 'target'
            : path.startsWith('driver')
              ? 'driver'
              : path.startsWith('url')
                ? 'url'
                : path.startsWith('auth.token')
                  ? 'token'
                  : path.startsWith('auth.secret')
                    ? 'secret'
                    : path.startsWith('auth.headers')
                      ? 'headers'
                      : 'form';
          if (!e[field]) e[field] = i.message ?? err.message;
        }
        return Object.keys(e).length ? e : { form: err.message };
      }
      default:
        return { form: err.message };
    }
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setSaved(false);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = (['url', 'token', 'secret', 'headers', 'driver', 'target'] as Field[]).find((f) => e[f]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ agent: Agent }>(`/api/v1/agents/${agent.id}/delivery`, { method: 'PUT', body: body() });
      if (!alive.current) return;
      const d = res.agent.delivery;
      setStored(d);
      setMode(modeOf(d));
      setAuth(authOf(d));
      setUrl('');
      setReplaceUrl(false);
      setToken('');
      setReplaceToken(false);
      setSecret('');
      setReplaceSecret(false);
      setHeaders([]);
      setReplaceHeaders(false);
      setDriver(d.driver ?? 'herdr');
      setTarget(d.target ?? d.pane ?? '');
      setSaved(true);
      setWake({ kind: 'idle' });
      onSaved();
    } catch (err) {
      if (alive.current) setErrors(serverErrors(err));
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  async function poll(wakeId: string) {
    const started = Date.now();
    while (alive.current && Date.now() - started < POLL_FOR_MS) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      if (!alive.current) return;
      try {
        const { wake: w } = await api<{ wake: Wake }>(`/api/v1/agents/${agent.id}/wakes/${wakeId}`);
        if (!alive.current) return;
        if (w.status === 'delivered') return (setWake({ kind: 'delivered' }), onSaved());
        if (w.status === 'failed' || w.status === 'cancelled') return (setWake({ kind: 'failed', error: w.last_error }), onSaved());
      } catch (err) {
        if (alive.current) setWake({ kind: 'error', text: errorText(err) });
        return;
      }
    }
    if (alive.current) setWake({ kind: 'timeout' });
  }

  async function testWake() {
    setWake({ kind: 'sending' });
    try {
      const r = await api<TestWakeResult>(`/api/v1/agents/${agent.id}/test-wake`, { method: 'POST' });
      if (!alive.current) return;
      if (r.pending) {
        setWake({ kind: 'waiting', wakeId: r.wake_id });
        void poll(r.wake_id);
      } else {
        setWake({ kind: 'webhook', ok: r.ok, status: r.status_code, error: r.error });
      }
      onSaved();
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.code === 'rate_limited') setWake({ kind: 'limited', seconds: err.retryAfterSeconds });
      else setWake({ kind: 'error', text: errorText(err) });
    }
  }

  const fieldProps = (f: Field, hint?: string) => ({
    id: `${uid}-${f}`,
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': [errors[f] ? `${uid}-${f}-err` : '', hint ? `${uid}-${f}-hint` : ''].filter(Boolean).join(' ') || undefined,
  });
  const err = (f: Field) =>
    errors[f] ? (
      <p className="dash-field-err" id={`${uid}-${f}-err`}>
        {errors[f]}
      </p>
    ) : null;

  const storedTarget = stored.target ?? stored.pane ?? '';
  const headingId = `${uid}-h`;

  return (
    <section className="dash-delivery" id={`delivery-${agent.id}`} aria-labelledby={headingId}>
      <div className="dash-delivery-head">
        <h4 id={headingId}>Delivery for <span translate="no">{agent.name}</span></h4>
        <button type="button" className="dash-textbtn" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="dash-muted">
        How ReplySlip tells {agent.name} that something is waiting. The notice says only that there is work; the agent reads the task over MCP.
      </p>

      <form onSubmit={save} noValidate autoComplete="off">
        <fieldset className="dash-modes">
          <legend>How should ReplySlip wake this agent?</legend>
          {(
            [
              ['none', 'None', 'The agent checks for tasks itself. ReplySlip sends nothing.'],
              ['webhook', 'Webhook', 'ReplySlip sends a POST to a URL you choose each time there is work.'],
              ['local', 'Local agent via herdr or Orca', 'The watcher on your machine (replyslip watch) types a short notice into a herdr or Orca pane.'],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className={mode === value ? 'dash-mode is-on' : 'dash-mode'}>
              <input
                type="radio"
                name={`${uid}-mode`}
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setErrors({});
                  setSaved(false);
                }}
              />
              <span>
                <span className="dash-mode-label">{label}</span>
                <span className="dash-muted">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === 'webhook' ? (
          <div className="dash-fields">
            <div className="dash-field">
              {keepUrl && !replaceUrl ? <span className="dash-label">Webhook URL</span> : <label htmlFor={`${uid}-url`}>Webhook URL</label>}
              {keepUrl && !replaceUrl ? (
                <div className="dash-setrow">
                  <span className="dash-set" translate="no" id={`${uid}-url-set`}>
                    {stored.url}/{stored.url_path_last4 ? `…${stored.url_path_last4}` : ''}
                  </span>
                  <button type="button" className="dash-textbtn" id={`${uid}-url`} aria-describedby={`${uid}-url-set`} onClick={() => setReplaceUrl(true)}>
                    Replace URL
                  </button>
                </div>
              ) : (
                <>
                  <input
                    {...fieldProps('url', 'url')}
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="https://example.com/replyslip"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoFocus={replaceUrl}
                  />
                  <p className="dash-hint" id={`${uid}-url-hint`}>
                    Must be a public http(s) address. Only the host and the last four characters of the path are shown after you save.
                    {keepUrl ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="dash-textbtn"
                          onClick={() => {
                            setReplaceUrl(false);
                            setUrl('');
                          }}
                        >
                          Keep the saved URL
                        </button>
                      </>
                    ) : null}
                  </p>
                </>
              )}
              {err('url')}
            </div>

            <div className="dash-field">
              <label htmlFor={`${uid}-auth`}>Auth</label>
              <select id={`${uid}-auth`} value={auth} onChange={(e) => changeAuth(e.target.value as AuthType)}>
                {(Object.keys(AUTH_LABEL) as AuthType[]).map((t) => (
                  <option key={t} value={t}>
                    {AUTH_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="dash-hint">
                {auth === 'none'
                  ? 'Requests carry no credentials.'
                  : auth === 'bearer'
                    ? 'Sent as Authorization: Bearer <token> on every request.'
                    : auth === 'hmac'
                      ? 'Each request body is signed with this secret and sent in X-ReplySlip-Signature as sha256=<hex>.'
                      : 'Sent as-is on every request. Names stay visible here; values are write-only.'}
              </p>
            </div>

            {auth === 'bearer' ? (
              <SecretField
                label="Bearer token"
                f="token"
                uid={uid}
                keep={keepToken && !replaceToken}
                mask={stored.token}
                value={token}
                onChange={setToken}
                onReplace={() => setReplaceToken(true)}
                onKeep={keepToken ? () => (setReplaceToken(false), setToken('')) : undefined}
                fieldProps={fieldProps}
                err={err}
              />
            ) : null}
            {auth === 'hmac' ? (
              <SecretField
                label="HMAC secret"
                f="secret"
                uid={uid}
                keep={keepSecret && !replaceSecret}
                mask={stored.secret}
                value={secret}
                onChange={setSecret}
                onReplace={() => setReplaceSecret(true)}
                onKeep={keepSecret ? () => (setReplaceSecret(false), setSecret('')) : undefined}
                fieldProps={fieldProps}
                err={err}
              />
            ) : null}

            {auth === 'headers' ? (
              <div className="dash-field">
                <span className="dash-label" id={`${uid}-headers-label`}>
                  Headers
                </span>
                {keepHeaders && !replaceHeaders ? (
                  <>
                    <ul className="dash-headers-set" aria-labelledby={`${uid}-headers-label`}>
                      {stored.headers.map((h) => (
                        <li key={h.name}>
                          <code translate="no">{h.name}</code>
                          <span className="dash-set">{h.value.set ? maskText(h.value) : 'Not set'}</span>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="dash-textbtn" id={`${uid}-headers`} onClick={startReplaceHeaders}>
                      Replace headers
                    </button>
                    <p className="dash-hint">Header values can’t be read back, so replacing means entering every value again.</p>
                  </>
                ) : (
                  <>
                    <div className="dash-header-rows" role="group" aria-labelledby={`${uid}-headers-label`}>
                      {headers.map((h, i) => (
                        <div className="dash-header-row" key={h.key}>
                          <input
                            id={i === 0 ? `${uid}-headers` : undefined}
                            aria-label={`Header ${i + 1} name`}
                            aria-invalid={errors.headers ? true : undefined}
                            aria-describedby={errors.headers ? `${uid}-headers-err` : undefined}
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="X-Api-Key"
                            value={h.name}
                            onChange={(e) => setHeaders((rows) => rows.map((r) => (r.key === h.key ? { ...r, name: e.target.value } : r)))}
                          />
                          <input
                            type="password"
                            aria-label={`Header ${i + 1} value`}
                            aria-invalid={errors.headers ? true : undefined}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Value"
                            value={h.value}
                            onChange={(e) => setHeaders((rows) => rows.map((r) => (r.key === h.key ? { ...r, value: e.target.value } : r)))}
                          />
                          <button
                            type="button"
                            className="dash-textbtn dash-danger"
                            onClick={() => setHeaders((rows) => rows.filter((r) => r.key !== h.key))}
                            disabled={headers.length === 1}
                          >
                            Remove<span className="vh"> header {i + 1}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="dash-setrow">
                      <button
                        type="button"
                        className="dash-textbtn"
                        onClick={() => setHeaders((rows) => [...rows, newRow()])}
                        disabled={headers.length >= MAX_HEADERS}
                      >
                        Add header
                      </button>
                      {keepHeaders ? (
                        <button
                          type="button"
                          className="dash-textbtn"
                          onClick={() => {
                            setReplaceHeaders(false);
                            setHeaders([]);
                          }}
                        >
                          Keep the saved headers
                        </button>
                      ) : null}
                    </div>
                    <p className="dash-hint">Letters, numbers and hyphens. Authorization, Cookie, Host and Content-Type are set by ReplySlip.</p>
                  </>
                )}
                {err('headers')}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'local' ? (
          <div className="dash-fields">
            <div className="dash-field">
              <label htmlFor={`${uid}-driver`}>Driver</label>
              <select
                {...fieldProps('driver')}
                value={driver}
                onChange={(e) => {
                  setDriver(e.target.value);
                  setErrors({});
                }}
              >
                <option value="herdr">herdr</option>
                <option value="orca">Orca</option>
              </select>
              {err('driver')}
            </div>
            <div className="dash-field">
              <label htmlFor={`${uid}-target`}>Pane</label>
              <input
                {...fieldProps('target', 'target')}
                spellCheck={false}
                autoComplete="off"
                placeholder={driver === 'orca' ? 'tabId:leafId' : 'reviewer'}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              {driver === 'orca' ? (
                <p className="dash-hint" id={`${uid}-target-hint`}>
                  Your agent shows this during setup (or run <code translate="no">echo $ORCA_PANE_KEY</code> in its terminal). The watcher needs a
                  watcher key from the Watchers section below.
                </p>
              ) : (
                <p className="dash-hint" id={`${uid}-target-hint`}>
                  The exact name of the herdr pane where {agent.name} runs. The watcher needs herdr 0.8.0 or newer on its machine and a watcher key from the Watchers section below.
                </p>
              )}
              {err('target')}
            </div>
          </div>
        ) : null}

        {mode === 'none' ? (
          <p className="dash-hint dash-fields">
            {agent.name} won’t be woken. It should call <code translate="no">list_tasks</code> on its own schedule to see new work.
          </p>
        ) : null}

        {errors.form ? (
          <p className="dash-err" role="alert">
            {errors.form}
          </p>
        ) : null}

        <div className="dash-delivery-actions">
          <button type="submit" className="btn" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save delivery'}
          </button>
          <button
            type="button"
            className="dash-btn dash-btn-ink"
            onClick={testWake}
            disabled={storedMode === 'none' || dirty || wake.kind === 'sending' || wake.kind === 'waiting'}
            aria-describedby={`${uid}-wake-hint`}
          >
            {wake.kind === 'sending' ? 'Sending…' : 'Send test wake'}
          </button>
          <span className="dash-hint" id={`${uid}-wake-hint`}>
            {storedMode === 'none'
              ? 'Save webhook or local delivery to send a test wake.'
              : dirty
                ? 'Save first: the test uses the saved settings.'
                : 'Up to 10 tests per agent every 15 minutes.'}
          </span>
        </div>

        <div className="dash-status" role="status" aria-live="polite">
          {saved && wake.kind === 'idle' ? <p className="dash-ok">Saved.</p> : null}
          <WakeMessage state={wake} target={storedTarget} orca={stored.driver === 'orca'} />
        </div>
      </form>
    </section>
  );
}

function SecretField({
  label,
  f,
  uid,
  keep,
  mask,
  value,
  onChange,
  onReplace,
  onKeep,
  fieldProps,
  err,
}: {
  label: string;
  f: 'token' | 'secret';
  uid: string;
  keep: boolean;
  mask: SecretMask;
  value: string;
  onChange: (v: string) => void;
  onReplace: () => void;
  onKeep?: () => void;
  fieldProps: (f: Field, hint?: string) => Record<string, unknown>;
  err: (f: Field) => React.ReactNode;
}) {
  return (
    <div className="dash-field">
      {keep ? <span className="dash-label">{label}</span> : <label htmlFor={`${uid}-${f}`}>{label}</label>}
      {keep ? (
        <div className="dash-setrow">
          <span className="dash-set" id={`${uid}-${f}-set`}>
            {maskText(mask)}
          </span>
          <button type="button" className="dash-textbtn" id={`${uid}-${f}`} aria-describedby={`${uid}-${f}-set`} onClick={onReplace}>
            Replace<span className="vh"> {label.toLowerCase()}</span>
          </button>
        </div>
      ) : (
        <>
          <input
            {...fieldProps(f, f)}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={!!onKeep}
          />
          <p className="dash-hint" id={`${uid}-${f}-hint`}>
            Write-only: after saving, only the last four characters are shown.
            {onKeep ? (
              <>
                {' '}
                <button type="button" className="dash-textbtn" onClick={onKeep}>
                  Keep the saved {label.toLowerCase()}
                </button>
              </>
            ) : null}
          </p>
        </>
      )}
      {err(f)}
    </div>
  );
}

function WakeMessage({ state, target, orca }: { state: WakeState; target: string; orca: boolean }) {
  switch (state.kind) {
    case 'idle':
    case 'sending':
      return null;
    case 'webhook':
      return state.ok ? (
        <p className="dash-ok">Test wake delivered. Your endpoint answered {state.status ?? 'OK'}.</p>
      ) : (
        <p className="dash-err">
          Test wake failed{state.status ? ` (HTTP ${state.status})` : ''}: {state.error ?? 'no details'}. It stays queued for the daily retry run.
        </p>
      );
    case 'waiting':
      return <p className="dash-pending">Test wake pending. Waiting for the watcher to deliver it…</p>;
    case 'delivered':
      return <p className="dash-ok">Test wake delivered to the {orca ? 'Orca pane' : 'herdr pane'}.</p>;
    case 'failed':
      return <p className="dash-err">Test wake failed{state.error ? `: ${state.error}` : '.'}</p>;
    case 'timeout':
      return (
        <p className="dash-pending">
          Still pending after 30 seconds. Is the watcher running (<code translate="no">replyslip watch</code>) and is the {orca ? 'Orca pane key' : 'herdr pane named'}{' '}
          <code translate="no">{target || '…'}</code>? The wake stays queued and is delivered when the watcher picks it up.
        </p>
      );
    case 'limited':
      return (
        <p className="dash-err">
          Test wake limit reached (10 per agent every 15 minutes). Try again in {state.seconds ? minutes(state.seconds) : 'a few minutes'}.
        </p>
      );
    case 'error':
      return <p className="dash-err">{state.text}</p>;
  }
}
