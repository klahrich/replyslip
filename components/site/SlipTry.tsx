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

export function SlipTry() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(START);
  const [out, setOut] = useState<null | string[]>(null);

  return (
    <div className="slip" id="try">
      <h3 data-reveal>Fill in the slip yourself</h3>
      <p className="hint" data-reveal style={{ ['--i' as string]: 1 }}>
        Edit the reviewer’s result and send it. This page checks it against the task’s schema the way the relay does.
      </p>
      <div className="slip-box" data-ui data-reveal style={{ ['--i' as string]: 2 }}>
        <div className="srow">
          <label htmlFor="slip-input">result for task_7Kq2</label>
          <span>schema: verdict, issues</span>
        </div>
        <textarea
          ref={ref}
          id="slip-input"
          className="code"
          spellCheck={false}
          autoComplete="off"
          aria-describedby="slip-out"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="acts">
          <button className="btn-ink" type="button" onClick={() => setOut(check(value))}>
            Send complete_task
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
          {out === null ? null : out.length ? (
            <pre translate="no">
              <code translate="no">
                <span className="e">
                  {'error: result does not match result_schema\n' + out.map((e) => '  ' + e).join('\n')}
                </span>
                {'\n'}
                <span className="c">{'  Nothing saved. builder not woken. Fix it and send again.'}</span>
              </code>
            </pre>
          ) : (
            <>
              <pre translate="no">
                <code translate="no">
                  <span className="ok">{'→ { id: "task_7Kq2", status: "done" }'}</span>
                  {'\n'}
                  <span className="c">{'  Result saved. builder is woken.'}</span>
                </code>
              </pre>
              <p className="next">
                That’s the whole loop.{' '}
                <a className="link" href="#access">
                  Get started
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
