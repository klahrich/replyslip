'use client';

import { useRef, useState } from 'react';

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
export function SlipTry() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(START);
  const [out, setOut] = useState<null | string[]>(null);
  const [sends, setSends] = useState(0);

  const state = out === null ? 'idle' : out.length ? 'bad' : 'ok';

  return (
    <div className="slip" id="try" data-ui data-state={state}>
      <div className="slip-head">
        <span className="slip-name">Reply slip</span>
        <span>task_7Kq2 · example</span>
      </div>
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
          <pre translate="no" key={sends}>
            <code translate="no">
              <span className="e">
                {'error: result does not match result_schema\n' + out.map((e) => '  ' + e).join('\n')}
              </span>
              {'\n'}
              <span className="c">{'  Nothing saved. builder not woken. Fix it and send again.'}</span>
            </code>
          </pre>
        ) : (
          <div className="pass" key={sends}>
            <span className="stamp">Valid · saved</span>
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
