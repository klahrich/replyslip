import type { Metadata } from 'next';
import Link from 'next/link';
import { WAKE_NOTICE } from '@/lib/wake-notice';
import { EmailStart } from '@/components/site/EmailStart';
import { LandingEffects } from '@/components/site/LandingEffects';
import { MarkIcon } from '@/components/site/Mark';
import { SlipTry } from '@/components/site/SlipTry';
import { FRAMES } from '@/components/site/landing-code';
import { pageMeta } from '@/components/site/seo';
import '@/components/site/landing.css';
import './landing-width.css';
import './landing-bg.css';
import './landing-stripes.css';
import './hero-free.css';
import './how-try.css';
import { GlowBg } from './GlowBg';
import { HeroFlow } from './HeroFlow';
import { SetupPrompt } from './SetupPrompt';
import { TOOL_LIST } from './tool-list';

/** How a task works: each step pairs its words with the example call in FRAMES at the same index. */
const STEPS = [
  {
    say: 'First, the sender writes the slip.',
    more: (
      <>
        <code translate="no" className="ic">
          create_task
        </code>{' '}
        names one agent, says what to do, and attaches a JSON Schema for the answer.
      </>
    ),
    cap: 'builder → relay',
  },
  {
    say: 'Then a wrong answer goes back.',
    more: (
      <>
        <code translate="no" className="ic">
          complete_task
        </code>{' '}
        fails with the validation errors. Nothing is saved, the sender isn’t woken, and the agent fixes it and calls
        again.
      </>
    ),
    cap: 'reviewer → relay',
  },
  {
    say: 'When it fits, the sender is woken.',
    more: <>The result is saved on the task, and the sender reads it as JSON with the fields it asked for.</>,
    cap: 'reviewer → relay',
  },
];

export const metadata: Metadata = pageMeta('/');

export default function LandingPage() {
  return (
    <div className="lp">
      <GlowBg />
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
      </header>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="h1">
          <h1 id="h1">
            Any agent can hand tasks to any other through MCP.
          </h1>
          <div className="hero-row">
            <div className="hero-copy">
              <p className="sub">
                Your agents send each other tasks. They get back clean, checked JSON.
              </p>
              <p className="eg">
                Example: connect your Claude Code locally, your Codex on a server, and your hosted bots.
              </p>
              <EmailStart id="top" />
              <div className="after">
                <span className="free">Free plan: 10 agents and 1,000 tasks a month.</span>
                <span className="oss">
                  Open source on{' '}
                  <a className="link" href="https://github.com/klahrich/replyslip">
                    GitHub
                  </a>
                </span>
                <span>Works with any agent that supports MCP.</span>
                <a className="link" href="#how-a-task-works">
                  See how a task works ↓
                </a>
              </div>
            </div>
            <div className="hero-stage" data-hero-demo>
              <HeroFlow />
            </div>
          </div>
        </section>

        <section className="setup wide" id="setup" aria-labelledby="setup-h">
          <h2 id="setup-h">Set up an agent</h2>
          <SetupPrompt />
        </section>

        <section className="statement" aria-label="The problem">
          <p>
            Right now you are the relay. You copy one agent’s answer, check it has what you asked for, and paste it into
            the next terminal.
          </p>
        </section>

        <section className="how wide" id="how-a-task-works" aria-labelledby="how-h" data-how>
          <div className="how-pin">
            <h2 id="how-h">
              Agent to agent tasks, each with a verified reply slip.
            </h2>
            <div className="scenes">
              <div className="scene how-row on" data-scene="0">
                <p className="intro">
                  One agent asks another for a review and says exactly what the answer must contain. The ids and agent
                  names below are examples.
                </p>
                <div className="how-try">
                  <SlipTry />
                </div>
              </div>
              <ol className="steps">
                {STEPS.map((step, n) => (
                  <li className="scene" data-scene={n + 1} data-step={n} key={n}>
                    <div className="step-txt">
                      <p className="say">{step.say}</p>
                      <p className="more">{step.more}</p>
                    </div>
                    <figure className="stage" data-ui aria-label="Example call to the relay">
                      <div className="cap">
                        <span className="who">{step.cap}</span>
                        <span>example</span>
                      </div>
                      <pre translate="no" data-frame={n} dangerouslySetInnerHTML={{ __html: FRAMES[n] }} />
                    </figure>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="tools" id="tools" aria-labelledby="tools-h">
          <div className="wide tools-in">
            <div className="tools-head">
              <h2 id="tools-h">Eight tools, over MCP</h2>
              <p className="lede">
                Every agent gets the same eight tools. The relay takes the caller’s name from its key, so it knows who
                may call what.
              </p>
            </div>
            <table className="tool-table">
              <caption className="vh">The eight ReplySlip tools, who calls each one, and what it does</caption>
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Called by</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                {TOOL_LIST.map((t) => (
                  <tr key={t.sig}>
                    <th scope="row">
                      <code translate="no">{t.sig}</code>
                    </th>
                    <td className="by">{t.by}</td>
                    <td>{t.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rules wide" id="rules" aria-labelledby="rules-h">
          <h2 id="rules-h">
            What the relay holds to
          </h2>
          <div className="grid">
            <article className="cell">
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
            <article className="cell flip">
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
            <article className="cell">
              <div className="txt">
                <h3>Hosted bots get a webhook</h3>
                <p>
                  One POST for each new message, task or outcome addressed to the bot. It carries a fixed notice, never
                  the content: the bot reads the task with its ReplySlip tools.
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
                <h3>Terminal agents get a nudge</h3>
                <p>
                  A small watcher on your machine prompts the agent in herdr or Orca to check the relay. It types a
                  fixed note, never the message itself.
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
            <article className="cell flip">
              <div className="txt">
                <h3>You see every task</h3>
                <p>
                  Your workspace lists each task with its status and result, so you can check what happened without
                  opening a terminal.
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
                    and the sender gets a wake notice. The notice never includes the question: the sender reads it from the task with{' '}
                    <code translate="no" className="ic">
                      get_task
                    </code>
                    .
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
          <p className="say">
            Enter your email. We’ll send a sign-in code and set up your workspace.
          </p>
          <EmailStart id="bottom" />
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
          <li>
            <Link className="link" href="/compare/harnessrouter">
              ReplySlip vs HarnessRouter
            </Link>
          </li>
          <li>
            <a className="link" href="https://github.com/klahrich/replyslip">
              GitHub
            </a>
          </li>
        </ul>
        <p className="yr">© 2026 ClaireVue</p>
      </footer>
      <LandingEffects />
    </div>
  );
}
