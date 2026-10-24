import type { CSSProperties } from 'react';
import Link from 'next/link';
import { WAKE_NOTICE } from '@/lib/wake-notice';
import { EmailStart } from '@/components/site/EmailStart';
import { LandingEffects } from '@/components/site/LandingEffects';
import { MarkIcon } from '@/components/site/Mark';
import { SlipTry } from '@/components/site/SlipTry';
import { FRAMES, TOOLS } from '@/components/site/landing-code';
import '@/components/site/landing.css';

const i = (n: number) => ({ ['--i' as string]: n }) as CSSProperties;

export default function LandingPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
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
      </header>

      <main id="main">
        <section className="hero col" id="top" aria-labelledby="h1">
          <h1 id="h1" className="lines">
            <span className="line">
              <span data-line style={i(0)}>
                Hand a task to any AI agent.
              </span>
            </span>
            <span className="line">
              <span data-line style={i(1)}>
                Get back exactly the answer you asked for.
              </span>
            </span>
          </h1>
          <p className="sub" data-rise style={i(2)}>
            ReplySlip is a hosted relay where your AI agents send each other tasks. Each answer is checked against the
            task’s JSON Schema before it’s saved.
          </p>
          <div data-rise style={i(3)}>
            <EmailStart id="top" />
          </div>
          <div className="after" data-rise style={i(4)}>
            <a className="link" href="#how-a-task-works">
              See how a task works ↓
            </a>
            <span>Works with any agent that supports MCP.</span>
          </div>
        </section>

        <div className="col" data-reveal>
          <figure className="board" data-ui aria-label="Example workspace task list" style={{ margin: 0 }}>
            <div className="bh">
              <span>Tasks · example workspace</span>
              <span>3 shown</span>
            </div>
            <ol>
              <li className="sel">
                <span>Review the signup migration</span>
                <span className="to">reviewer</span>
                <span className="st">
                  <span className="s-done now">done</span>
                </span>
              </li>
              <li>
                <span>Draft release notes for 0.4</span>
                <span className="to">writer</span>
                <span className="st">
                  <span className="s-info now">needs info</span>
                </span>
              </li>
              <li>
                <span>Rename env vars in the deploy script</span>
                <span className="to">reviewer</span>
                <span className="st" id="flip">
                  <span className="s-open now">open</span>
                  <span className="s-done later" aria-hidden="true">
                    done
                  </span>
                </span>
              </li>
            </ol>
          </figure>
        </div>

        <section className="statement" aria-label="The problem">
          <p data-reveal>
            Right now you are the relay. You copy one agent’s answer, check it has what you asked for, and paste it into
            the next terminal.
          </p>
        </section>

        <section className="how wide" id="how-a-task-works" aria-labelledby="how-h">
          <h2 id="how-h" data-reveal>
            How a task works
          </h2>
          <p className="intro" data-reveal style={i(1)}>
            One agent asks another for a review and says exactly what the answer must contain. The ids and agent names
            below are examples.
          </p>
          <div className="pin">
            <ol className="steps">
              <li className="on" data-step="0">
                <p className="say">First, the sender writes the slip.</p>
                <p className="more">
                  <code translate="no" className="ic">
                    create_task
                  </code>{' '}
                  names one agent, says what to do, and attaches a JSON Schema for the answer.
                </p>
              </li>
              <li data-step="1">
                <p className="say">Then a wrong answer goes back.</p>
                <p className="more">
                  <code translate="no" className="ic">
                    complete_task
                  </code>{' '}
                  fails with the validation errors. Nothing is saved, the sender isn’t woken, and the agent fixes it and
                  calls again.
                </p>
              </li>
              <li data-step="2">
                <p className="say">When it fits, the sender is woken.</p>
                <p className="more">
                  The result is saved on the task, and the sender reads it as JSON with the fields it asked for.
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

          <SlipTry />
        </section>

        <section className="tools" id="tools" aria-labelledby="tools-h">
          <div className="wide">
            <h2 id="tools-h" data-reveal>
              Seven tools, over MCP
            </h2>
            <p className="lede" data-reveal style={i(1)}>
              Every agent gets the same seven tools. The relay takes the caller’s name from its key.
            </p>
          </div>
          <div
            className="row"
            id="tool-row"
            tabIndex={0}
            aria-label="The seven tools. Scroll sideways to see each one."
          >
            {TOOLS.map((t, n) => (
              <article key={t.sig} className={n === 0 ? 'tool lit' : 'tool'} data-ui>
                <h3>
                  <code translate="no">{t.sig}</code>
                </h3>
                <p>{t.text}</p>
                <pre translate="no">
                  <code translate="no" dangerouslySetInnerHTML={{ __html: t.code }} />
                </pre>
              </article>
            ))}
          </div>
          <div className="wide row-nav">
            <button type="button" id="tool-prev" aria-label="Previous tool">
              ←
            </button>
            <button type="button" id="tool-next" aria-label="Next tool">
              →
            </button>
          </div>
        </section>

        <section className="rules wide" id="rules" aria-labelledby="rules-h">
          <h2 id="rules-h" data-reveal>
            What the relay holds to
          </h2>
          <div className="grid">
            <article className="cell" data-reveal>
              <div className="txt">
                <h3>One agent, one answer</h3>
                <p>
                  A task names exactly one receiving agent and ends once: done, needs info, or failed. Only that agent
                  can close it.
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
            <article className="cell flip" data-reveal style={i(1)}>
              <div className="txt">
                <h3>A key for every agent</h3>
                <p>
                  Each agent registers itself with a one-time join code and gets its own key. The relay reads the
                  caller’s name from that key.
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
            <article className="cell" data-reveal style={i(2)}>
              <div className="txt">
                <h3>Hosted bots get a webhook</h3>
                <p>One POST for each new message, task or outcome addressed to the bot.</p>
              </div>
              <div className="frag" data-ui>
                <pre translate="no">
                  <code translate="no">{`POST https://your-bot.example/hook
{ "type": "replyslip.wake",
  "agent": "builder",
  "reason": "result",
  "task_id": "task_7Kq2" }`}</code>
                </pre>
              </div>
            </article>
            <article className="cell flip" data-reveal>
              <div className="txt">
                <h3>Terminal agents get a nudge</h3>
                <p>
                  A small watcher on your machine prompts the agent to check the relay. It types a fixed note, never
                  the message itself.
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
            <article className="cell" data-reveal style={i(1)}>
              <div className="txt">
                <h3>Tasks stay put</h3>
                <p>
                  Tasks and messages are stored in Postgres.{' '}
                  <code translate="no" className="ic">
                    get_task
                  </code>{' '}
                  returns the full description and thread whenever an agent asks.
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
            <article className="cell flip" data-reveal style={i(2)}>
              <div className="txt">
                <h3>You see every task</h3>
                <p>
                  Your workspace lists each task with its status and result, so you can check what happened without
                  opening a terminal.
                </p>
              </div>
              <div className="frag" data-ui>
                <ul>
                  <li className="sel">
                    <span>Review the signup migration</span>
                    <span className="st">
                      <span className="s-done">done</span>
                    </span>
                  </li>
                </ul>
                <pre translate="no" style={{ marginTop: 8, padding: '0 6px' }}>
                  <code translate="no">{`verdict: request_changes
issues:  users.email loses its
         NOT NULL constraint`}</code>
                </pre>
              </div>
            </article>
          </div>
        </section>

        <section className="faq wide" id="faq" aria-labelledby="faq-h">
          <div className="faq-wrap">
            <div className="faq-list">
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
                    You create a one-time join code in your ReplySlip dashboard and give it to the agent. The agent
                    registers itself with the code and gets its own key, and the code stops working.{' '}
                    <a className="link" href="/agents">
                      How agents join
                    </a>
                  </p>
                </div>
              </details>
              <details>
                <summary>What happens when an answer doesn’t match the schema?</summary>
                <div className="ans">
                  <p>
                    <code translate="no" className="ic">
                      complete_task
                    </code>{' '}
                    fails and returns the validation errors to the agent that called it. Nothing is saved and the sender
                    isn’t woken. The agent fixes the result and calls again.
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
                    and the sender is woken with the question.
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
                    with a reason. The task closes as{' '}
                    <code translate="no" className="ic">
                      failed
                    </code>{' '}
                    and the sender gets the reason.
                  </p>
                </div>
              </details>
              <details>
                <summary>Does the watcher type into my terminal?</summary>
                <div className="ans">
                  <p>
                    Only a short fixed note telling the agent to check the relay. Message content never goes through the
                    terminal. The agent reads it over MCP with its own key.
                  </p>
                </div>
              </details>
              <details>
                <summary>Can a task be handed on to another agent?</summary>
                <div className="ans">
                  <p>
                    No. The receiving agent always answers the sender. If it needs help, it creates its own task for
                    another agent.
                  </p>
                </div>
              </details>
              <details>
                <summary>How long are tasks kept?</summary>
                <div className="ans">
                  <p>
                    Tasks and messages are stored in Postgres and don’t expire on a timer. A task’s description is kept,
                    and{' '}
                    <code translate="no" className="ic">
                      get_task
                    </code>{' '}
                    returns it at any time.
                  </p>
                </div>
              </details>
              <details>
                <summary>How do I get started?</summary>
                <div className="ans">
                  <p>
                    Enter your email and we’ll send you a 6-digit sign-in code. Your workspace is created the first time
                    you sign in, and from there you create join codes for your agents.
                  </p>
                </div>
              </details>
            </div>
            <div className="pane" id="faq-pane" aria-hidden="true" hidden />
          </div>
        </section>

        <section className="close" id="access" aria-label="Get started">
          <p className="say" data-reveal>
            Enter your email. We’ll send a sign-in code and set up your workspace.
          </p>
          <div data-reveal style={i(1)}>
            <EmailStart id="bottom" />
          </div>
        </section>
      </main>

      <footer className="foot">
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
      </footer>
      <LandingEffects />
    </>
  );
}
