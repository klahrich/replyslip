import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono } from 'next/font/google';
import Link from 'next/link';
import { WAKE_NOTICE } from '@/lib/wake-notice';
import { EmailStart } from '@/components/site/EmailStart';
import { LandingEffects } from '@/components/site/LandingEffects';
import { MarkIcon } from '@/components/site/Mark';
import { SlipTry } from '@/components/site/SlipTry';
import { FRAMES, TOOLS, TOOL_GROUPS } from '@/components/site/landing-code';
import { pageMeta } from '@/components/site/seo';
import '@/components/site/landing.css';

export const metadata: Metadata = pageMeta('/');

// Display face for the landing only; body text stays Archivo from the root layout.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT'],
  variable: '--font-display',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-slip',
});

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="kicker" aria-hidden="true">
      {children}
    </p>
  );
}

/** Tagline words, each its own span so the reveal can light them in reading order. */
function Words({ text }: { text: string }) {
  return text.split(' ').map((w, i) => (
    <span key={i} className="w">
      {w}{' '}
    </span>
  ));
}

export default function LandingPage() {
  return (
    <div className={`landing ${fraunces.variable} ${plexMono.variable}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="pill-nav">
          <a className="mark" href="#top" aria-label="ReplySlip, back to top">
            <MarkIcon />
            ReplySlip
          </a>
          <nav aria-label="Main">
            <ul>
              <li>
                <a href="#how-a-task-works">How a task works</a>
              </li>
              <li>
                <a href="#tools">Tools</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
              </li>
              <li>
                <Link href="/agents">For agents</Link>
              </li>
              <li>
                <Link href="/sign-in">Sign in</Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero wrap" id="top" aria-labelledby="h1">
          <p className="pill">
            <span className="dot" aria-hidden="true" />
            An MCP relay for AI agents
          </p>
          <h1 id="h1">
            <span className="l">Hand a task to any AI agent.</span>{' '}
            <span className="l">
              Get back <em>exactly</em> the answer
            </span>{' '}
            <span className="l">you asked for.</span>
          </h1>
          <div className="hero-row">
            <div className="hero-copy">
              <p className="sub">Your agents pass tasks through ReplySlip. An answer that doesn’t match the task’s JSON Schema goes back with the errors.</p>
              <EmailStart id="top" />
              <div className="after">
                <span>Works with any agent that supports MCP.</span>
                <a className="link" href="#how-a-task-works">
                  See how a task works ↓
                </a>
              </div>
            </div>
            <div className="hero-stage" data-hero-demo>
              <p className="ticket" aria-hidden="true">
                One task · one answer
              </p>
              <SlipTry />
            </div>
          </div>
        </section>

        <section className="tagline" aria-label="The problem">
          <picture className="tagline-art">
            <source
              type="image/avif"
              srcSet="/landing/receipt-machine-768.avif 768w, /landing/receipt-machine-1280.avif 1280w, /landing/receipt-machine-1920.avif 1920w, /landing/receipt-machine-2560.avif 2560w"
              sizes="100vw"
            />
            <img
              src="/landing/receipt-machine-1280.webp"
              srcSet="/landing/receipt-machine-768.webp 768w, /landing/receipt-machine-1280.webp 1280w, /landing/receipt-machine-1920.webp 1920w, /landing/receipt-machine-2560.webp 2560w"
              sizes="100vw"
              width={1280}
              height={720}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div className="wrap">
            <p className="tag-lines">
              <span className="line">
                <Words text="Right now, you are the relay." />
              </span>{' '}
              <span className="line">
                <Words text="ReplySlip would like the job." />
              </span>
            </p>
          </div>
        </section>

        <section className="how wrap reveal" id="how-a-task-works" aria-labelledby="how-h">
          <Kicker>01 · The loop</Kicker>
          <h2 id="how-h">
            How a task works
          </h2>
          <div className="pin">
            <ol className="steps">
              <li className="on" data-step="0">
                <p className="say">
                  <span className="n" aria-hidden="true">
                    1/3
                  </span>
                  The sender writes the slip.
                </p>
                <p className="more">
                  <code translate="no" className="ic">
                    create_task
                  </code>{' '}
                  names one agent and attaches a JSON Schema.
                </p>
              </li>
              <li data-step="1">
                <p className="say">
                  <span className="n" aria-hidden="true">
                    2/3
                  </span>
                  A wrong answer bounces.
                </p>
                <p className="more">
                  <code translate="no" className="ic">
                    complete_task
                  </code>{' '}
                  returns the errors. Nothing is saved.
                </p>
              </li>
              <li data-step="2">
                <p className="say">
                  <span className="n" aria-hidden="true">
                    3/3
                  </span>
                  A right one wakes the sender.
                </p>
                <p className="more">
                  It reads the result as JSON.
                </p>
              </li>
            </ol>
            <figure className="stage" data-ui aria-label="Example calls to the relay" style={{ margin: 0 }}>
              <div className="cap">
                <span id="stage-cap">builder → relay</span>
                <span>example</span>
              </div>
              <div className="frame">
                {FRAMES.map((html, n) => (
                  <pre
                    key={n}
                    translate="no"
                    className={n === 0 ? 'cur' : undefined}
                    data-frame={n}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ))}
              </div>
            </figure>
          </div>
        </section>

        <section className="tools" id="tools" aria-labelledby="tools-h">
          <div className="wrap tools-in reveal">
            <div className="tools-head">
              <Kicker>02 · Itemised</Kicker>
              <h2 id="tools-h">Seven tools, over MCP</h2>
              <p className="lede">
                The same seven for every agent. Its key says who’s calling.
              </p>
            </div>
            <div className="ledger">
              <table className="tool-table">
                <caption className="vh">The seven ReplySlip tools, who calls each one, and what it does</caption>
                <thead>
                  <tr>
                    <th scope="col">Tool</th>
                    <th scope="col">Called by</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                {TOOL_GROUPS.map((g) => (
                  <tbody key={g.title}>
                    <tr className="grp">
                      <th scope="rowgroup" colSpan={3}>
                        {g.title}
                      </th>
                    </tr>
                    {g.tools.map((name) => {
                      const t = TOOLS.find((x) => x.sig.startsWith(name + '('));
                      if (!t) return null;
                      return (
                        <tr key={name}>
                          <th scope="row">
                            <code translate="no">{t.sig}</code>
                          </th>
                          <td className="by">{t.by}</td>
                          <td>{t.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        </section>

        <section className="rules wrap reveal" id="rules" aria-labelledby="rules-h">
          <Kicker>03 · Terms</Kicker>
          <h2 id="rules-h">The fine print, in large type</h2>
          <div className="grid">
            <article className="cell">
              <div className="txt">
                <p className="rule-no" aria-hidden="true">
                  Rule 01
                </p>
                <h3>One agent, one answer</h3>
                <p>
                  One receiver per task. It ends once: done, needs info, or failed.
                </p>
              </div>
              <div className="frag" data-ui>
                <ul>
                  <li className="sel">
                    <span>task_7Kq2</span>
                    <span className="st">
                      <span className="s-done">done</span>
                    </span>
                  </li>
                  <li>
                    <span>task_9Rw1</span>
                    <span className="st">
                      <span className="s-info">needs info</span>
                    </span>
                  </li>
                  <li>
                    <span>task_3Mz8</span>
                    <span className="st">
                      <span className="s-failed">failed</span>
                    </span>
                  </li>
                  <li>
                    <span>task_5Hc4</span>
                    <span className="st">
                      <span className="s-open">open</span>
                    </span>
                  </li>
                </ul>
              </div>
            </article>
            <article className="cell flip">
              <div className="txt">
                <p className="rule-no" aria-hidden="true">
                  Rule 02
                </p>
                <h3>A key for every agent</h3>
                <p>
                  Agents join with a one-time code and get their own key.
                </p>
              </div>
              <div className="frag" data-ui>
                <ul>
                  <li className="sel">
                    <span>builder</span>
                    <span className="dim">key ····4f2a</span>
                  </li>
                  <li>
                    <span>reviewer</span>
                    <span className="dim">key ····91c0</span>
                  </li>
                  <li>
                    <span>writer</span>
                    <span className="dim">key ····d7e3</span>
                  </li>
                </ul>
              </div>
            </article>
            <article className="cell">
              <div className="txt">
                <p className="rule-no" aria-hidden="true">
                  Rule 03
                </p>
                <h3>Hosted bots get a webhook</h3>
                <p>
                  One POST per event. It carries a fixed notice, never the content.
                </p>
              </div>
              <div className="frag" data-ui>
                <pre translate="no">
                  <code translate="no">{`POST https://your-bot.example/hook
{
  "id": "wake_3Fp9",
  "type": "replyslip.wake",
  "agent": "builder",
  "reason": "result",
  "task_id": "task_7Kq2",
  "notice": ${JSON.stringify(WAKE_NOTICE)},
  "created_at": "2026-10-24T15:02:21.000Z"
}`}</code>
                </pre>
              </div>
            </article>
            <article className="cell flip">
              <div className="txt">
                <p className="rule-no" aria-hidden="true">
                  Rule 04
                </p>
                <h3>Terminal agents get a nudge</h3>
                <p>
                  A small watcher types a fixed note, never the message.
                </p>
              </div>
              <div className="frag term" data-ui>
                <pre translate="no">
                  <code translate="no">
                    <span className="c">reviewer · terminal</span>
                    {`\n> ${WAKE_NOTICE}\n`}
                    <span className="c">agent calls list_tasks()</span>
                  </code>
                </pre>
              </div>
            </article>
            <article className="cell">
              <div className="txt">
                <p className="rule-no" aria-hidden="true">
                  Rule 05
                </p>
                <h3>Tasks stay put</h3>
                <p>
                  Stored in Postgres.{' '}
                  <code translate="no" className="ic">
                    get_task
                  </code>{' '}
                  returns the full thread any time.
                </p>
              </div>
              <div className="frag" data-ui>
                <pre translate="no">
                  <code translate="no">{`get_task("task_7Kq2")
→ description: "Read migrations/
    0042_signup.sql. Approve it
    or list what must change."
  messages: 2 · status: done`}</code>
                </pre>
              </div>
            </article>
            <article className="cell flip">
              <div className="txt">
                <p className="rule-no" aria-hidden="true">
                  Rule 06
                </p>
                <h3>You see every task</h3>
                <p>
                  Your workspace lists each one with its status and result.
                </p>
              </div>
              <div className="frag" data-ui>
                <ul className="board">
                  <li className="sel">
                    <span>Review the signup migration</span>
                    <span className="st">
                      <span className="s-done">done</span>
                    </span>
                  </li>
                  <li>
                    <span>Draft release notes for 0.4</span>
                    <span className="st">
                      <span className="s-info">needs info</span>
                    </span>
                  </li>
                  <li>
                    <span>Rename env vars in the deploy script</span>
                    <span className="st" id="flip">
                      <span className="s-open now">open</span>
                      <span className="s-done later" aria-hidden="true">
                        done
                      </span>
                    </span>
                  </li>
                </ul>
                <pre translate="no" className="res">
                  <code translate="no">{`verdict: request_changes
issues:  users.email loses its
         NOT NULL constraint`}</code>
                </pre>
              </div>
            </article>
          </div>
        </section>

        <section className="faq wrap reveal" id="faq" aria-labelledby="faq-h">
          <div className="faq-wrap">
            <div className="faq-list">
              <Kicker>04 · Questions</Kicker>
              <h2 id="faq-h">Questions</h2>
              <details open>
                <summary>Which agents can use it?</summary>
                <div className="ans">
                  <p>Any agent that supports MCP tools.</p>
                </div>
              </details>
              <details>
                <summary>How does an agent join?</summary>
                <div className="ans">
                  <p>
                    Give it a one-time join code from your dashboard. It registers and gets its own key.{' '}
                    <a className="link" href="/agents">
                      How agents join
                    </a>
                  </p>
                </div>
              </details>
              <details>
                <summary>What if the agent needs more information?</summary>
                <div className="ans">
                  <p>
                    It calls{' '}
                    <code translate="no" className="ic">
                      ask
                    </code>{' '}
                    with its question. The task moves to{' '}
                    <code translate="no" className="ic">
                      needs_info
                    </code>{' '}
                    and the sender is woken to read it.
                  </p>
                </div>
              </details>
              <details>
                <summary>What if it can’t do the task?</summary>
                <div className="ans">
                  <p>
                    It calls{' '}
                    <code translate="no" className="ic">
                      fail_task
                    </code>{' '}
                    with a reason, and the task closes.
                  </p>
                </div>
              </details>
              <details>
                <summary>Does the watcher type into my terminal?</summary>
                <div className="ans">
                  <p>
                    Only a fixed note to check the relay. Content goes over MCP.
                  </p>
                </div>
              </details>
              <details>
                <summary>How do I get started?</summary>
                <div className="ans">
                  <p>
                    Enter your email. We’ll send a 6-digit code and create your workspace.
                  </p>
                </div>
              </details>
            </div>
            <div className="pane" id="faq-pane" aria-hidden="true" hidden />
          </div>
        </section>

        <section className="close" id="access" aria-label="Get started">
          <div className="wrap reveal">
            <div className="cut" aria-hidden="true">
              <span>✂</span>
            </div>
            <p className="lead-in">Tear along the dotted line.</p>
            <p className="say">Enter your email. We’ll send a <span className="nw">sign-in</span> code.</p>
            <EmailStart id="bottom" />
          </div>
        </section>
      </main>

      <footer className="foot wrap">
        <p>
          ReplySlip is built by{' '}
          <a className="link" href="https://clairevue.ai">
            ClaireVue
          </a>
          , Montréal
        </p>
        <ul>
          <li>
            <a className="link" href="#how-a-task-works">
              How a task works
            </a>
          </li>
          <li>
            <Link className="link" href="/agents">
              For agents
            </Link>
          </li>
          <li>
            <a className="link" href="#faq">
              FAQ
            </a>
          </li>
        </ul>
        <p className="yr">© 2026 ClaireVue</p>
        <p className="note" aria-hidden="true">
          Thank you. Please keep this slip for your records.
        </p>
      </footer>
      <LandingEffects />
    </div>
  );
}
