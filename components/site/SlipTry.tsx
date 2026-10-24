'use client';

import { useRef, useState } from 'react';
import type { LandingVariant } from './landing-variant';

const START = '{\n  "verdict": "looks fine",\n  "notes": "one nit in the index name"\n}';
const VALID = '{\n  "verdict": "request_changes",\n  "issues": ["users.email loses its NOT NULL constraint"]\n}';
const VERDICTS = ['approve', 'request_changes'];
const REQUIRED = ['verdict', 'issues'];

/** Same checks as the example task's result_schema. */
function check(txt: string): string[] {
  let r: unknown;
  try {
    r = JSON.parse(txt);
  } catch (e) {
    return ['/  result is not valid JSON (' + (e as Error).message.replace(/^JSON\.parse: /, '') + ')'];
  }
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return ['/  must be object'];
  const o = r as Record<string, unknown>;
  const errs: string[] = [];
  if ('verdict' in o && !VERDICTS.includes(o.verdict as string))
    errs.push('/verdict  must be one of "approve", "request_changes"');
  for (const k of REQUIRED) if (!(k in o)) errs.push('/  must have required property "' + k + '"');
  if ('issues' in o) {
    if (!Array.isArray(o.issues)) errs.push('/issues  must be array');
    else
      o.issues.forEach((x, i) => {
        if (typeof x !== 'string') errs.push('/issues/' + i + '  must be string');
      });
  }
  for (const k of Object.keys(o)) if (!REQUIRED.includes(k)) errs.push('/' + k + '  must NOT have additional properties');
  return errs;
}

/**
 * The reply slip: the example task's answer form, checked in the browser the way
 * the relay checks complete_task. Rendered on the server, so it reads as a slip
 * without JavaScript; sending needs JavaScript.
 */
export function SlipTry({ variant = 'receipt' }: { variant?: LandingVariant }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(START);
  const [out, setOut] = useState<null | string[]>(null);
  const [sends, setSends] = useState(0);

  const state = out === null ? 'idle' : out.length ? 'bad' : 'ok';

  return (
    <div className="slip" id="try" data-ui data-state={state}>
      {variant === 'dispatch' ? (
        <div className="slip-head">
          <span className="slip-name">Dispatch form</span>
          <span>docket task_7Kq2 · example</span>
          <span className="postage" aria-hidden="true">
            <span>MCP</span>
            <span>relay</span>
          </span>
        </div>
      ) : (
        <div className="slip-head">
          <span className="slip-org" aria-hidden="true">
            ReplySlip relay
          </span>
          <span className="slip-name">Reply slip</span>
          <span className="slip-no">Nº task_7Kq2 · example</span>
        </div>
      )}
      <dl className="slip-task">
        <div>
          <dt>From</dt>
          <dd>builder</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>reviewer</dd>
        </div>
        <div className="w">
          <dt>Task</dt>
          <dd>Review the signup migration. Approve it or list what must change.</dd>
        </div>
        <div className="w">
          <dt>Answer must have</dt>
          <dd>
            <code translate="no">verdict</code>: <code translate="no">&quot;approve&quot;</code> or{' '}
            <code translate="no">&quot;request_changes&quot;</code>, and <code translate="no">issues</code>: a list of
            strings. Nothing else.
          </dd>
        </div>
      </dl>
      <div className="slip-tear" aria-hidden="true" />
      <label className="slip-label" htmlFor="slip-input">
        The reviewer’s result. Edit it, then send.
      </label>
      <textarea
        ref={ref}
        id="slip-input"
        className="code"
        rows={5}
        spellCheck={false}
        autoComplete="off"
        aria-describedby="slip-out"
        aria-invalid={state === 'bad' ? true : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="acts">
        <button
          className="btn-ink"
          type="button"
          onClick={() => {
            setOut(check(value));
            setSends((n) => n + 1);
          }}
        >
          Send <code translate="no">complete_task</code>
        </button>
        <button
          className="textbtn"
          type="button"
          onClick={() => {
            setValue(VALID);
            setOut(null);
            ref.current?.focus();
          }}
        >
          Fill in a valid answer
        </button>
      </div>
      <div className="verdict" id="slip-out" role="status" aria-live="polite">
        {out === null ? (
          <p className="wait">Not sent yet. The first answer breaks the schema in three places.</p>
        ) : out.length ? (
          <div className="fail" key={sends}>
            <Stamp variant={variant} ok={false} />
            <pre translate="no">
              <code translate="no">
                <span className="e">
                  {'error: result does not match result_schema\n' + out.map((e) => '  ' + e).join('\n')}
                </span>
                {'\n'}
                <span className="c">{'  Nothing saved. builder not woken. Fix it and send again.'}</span>
              </code>
            </pre>
          </div>
        ) : (
          <div className="pass" key={sends}>
            <Stamp variant={variant} ok />
            <pre translate="no">
              <code translate="no">
                <span className="ok">{'→ { id: "task_7Kq2", status: "done" }'}</span>
                {'\n'}
                <span className="c">{'  builder is woken and reads the result.'}</span>
              </code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/** The clerk's mark on a sent answer. Text stays real text; the ring is decoration. */
function Stamp({ variant, ok }: { variant: LandingVariant; ok: boolean }) {
  if (variant === 'dispatch' && ok)
    return (
      <span className="stamp ok postmark">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <path id="pm-ring" d="M60 60m-44 0a44 44 0 1 1 88 0a44 44 0 1 1-88 0" />
          </defs>
          <circle cx="60" cy="60" r="56" />
          <circle cx="60" cy="60" r="34" />
          <text>
            <textPath href="#pm-ring">REPLYSLIP RELAY ✶ SCHEMA CHECKED ✶</textPath>
          </text>
        </svg>
        <span className="pm-mid">Valid</span>
        <span className="vh">: saved</span>
      </span>
    );
  if (variant === 'dispatch')
    return (
      <span className="stamp bad">
        <span aria-hidden="true">☞ </span>Return to sender
        <small>does not match result_schema</small>
      </span>
    );
  return ok ? (
    <span className="stamp ok">
      Validated<small>saved · builder woken</small>
    </span>
  ) : (
    <span className="stamp bad">
      Rejected<small>schema · nothing saved</small>
    </span>
  );
}
