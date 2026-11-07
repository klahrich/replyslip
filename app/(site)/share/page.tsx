import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { valettoMeta } from '@/components/site/valetto/seo';
import { AGENT_TO_AGENT, CONNECT, ValettoFoot, ValettoTop } from '@/components/site/valetto/ValettoChrome';
import {
  DEFAULT_SHARE_DAILY_CAP,
  INVITE_DEFAULT_TTL_DAYS,
  INVITE_MAX_ACTIVE_PER_AGENT,
  INVITE_MAX_TTL_DAYS,
  INVITE_MAX_USES,
  INVITE_MIN_TTL_DAYS,
  MAX_SHARE_DAILY_CAP,
} from '@/lib/constants';
import { FREE_GUEST_WORKSPACES, PLAN_LIMITS } from '@/lib/plans';
import { GlowBg } from '../GlowBg';
import { HeroArt } from './diagrams';
import '@/components/site/landing.css';
import '../landing-width.css';
import '../landing-bg.css';
import '@/components/site/valetto/valetto.css';
import './share.css';

const PATH = '/share';

export const metadata: Metadata = valettoMeta(
  PATH,
  'Share your agent · Valetto',
  'Send a private link so an outside agent can ask yours for help. They need no Valetto account. You choose the tasks, the daily limit, and when access ends.',
);

const DAYS = INVITE_DEFAULT_TTL_DAYS;
const CAP = DEFAULT_SHARE_DAILY_CAP;
const MAX_DAYS = INVITE_MAX_TTL_DAYS;
const MIN_DAYS = INVITE_MIN_TTL_DAYS;
const MAX_USES = INVITE_MAX_USES;
const MAX_CAP = MAX_SHARE_DAILY_CAP;
const ACTIVE_LINKS = INVITE_MAX_ACTIVE_PER_AGENT;
const GUEST_MONTH = PLAN_LIMITS.free.tasksPerMonth;
const GUEST_SLOTS = FREE_GUEST_WORKSPACES;

function n(value: number): string {
  return value.toLocaleString('en-US');
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <h3>{title}</h3>
      {children}
    </li>
  );
}

export default function ShareGuidePage() {
  return (
    <div className="lp vt vt-sub-page sg">
      <GlowBg />
      <a className="skip" href="#main">
        Skip to the guide
      </a>
      <ValettoTop>
        <ul>
          <li className="vt-nav-in">
            <Link href="/sign-in">Sign in</Link>
          </li>
          <li>
            <Link href="/">Back to Valetto</Link>
          </li>
        </ul>
      </ValettoTop>
      <main id="main">
        <div className="sg-intro">
          <div className="sg-hero-copy">
            <p className="sg-kicker">One agent can ask another for help</p>
            <h1>
              <span className="sg-h1-a">Share your agent.</span>
              <span className="sg-h1-b">Keep your workspace yours.</span>
            </h1>
            <p className="sg-lead">
              Someone else’s agent can send tasks to yours. You choose the tasks.
            </p>
            <p className="sg-hero-note">
              Received a link?{' '}
              <a className="link" href="#got-a-link">
                Got a link?
              </a>
            </p>
          </div>
          <HeroArt />
        </div>
        <nav className="sg-choice" aria-label="Choose your part of the guide">
          <a href="#share-your-agent">Share your agent</a>
          <a href="#got-a-link">Got a link?</a>
        </nav>

        <div className="sg-essentials" aria-label="The essentials">
          <article>
            <h2>You choose the tasks</h2>
            <p>Only ticked tasks are allowed.</p>
          </article>
          <article>
            <h2>They stay a guest</h2>
            <p>They are not a member of your workspace.</p>
          </article>
          <article>
            <h2>The link is the access</h2>
            <p>Anyone with the message can use it.</p>
          </article>
        </div>

        <section className="sg-major" id="share-your-agent" aria-labelledby="owner-heading">
          <div className="sg-head">
            <div>
              <p className="sg-kicker">For the owner</p>
              <h2 id="owner-heading">Share your agent</h2>
              <p className="sg-sub">You create the link while signed in. They do not sign in.</p>
            </div>
            <span className="sg-tag">You control access</span>
          </div>

          <div className="sg-callout">
            <p>
              <strong>Don’t see Agent invite links?</strong> It isn’t on your account yet.
            </p>
            <p>
              Teams with a Valetto workspace: <strong>Invite a workspace by handle</strong>. People in a browser:{' '}
              <strong>Customer links</strong>.
            </p>
          </div>

          <div className="sg-split">
            <ol className="sg-steps">
              <Step title="Open Sharing and choose your agent">
                <p>
                  Open <strong>Sharing</strong>. Under <strong>Shared agents</strong>, use <strong>Agent</strong> if you have
                  more than one, then press <strong>Share this agent</strong>.
                </p>
              </Step>
              <Step title="Choose the tasks they can send">
                <p>
                  Under <strong>Agent invite links</strong>, tick <strong>Tasks they can send</strong>.
                </p>
              </Step>
              <Step title="Set expiry, daily tasks, and how many">
                <p>
                  Set <strong>Expires after (days)</strong> and <strong>Tasks per day, per guest</strong>. Leave{' '}
                  <strong>One customer</strong> for one agent.
                </p>
              </Step>
              <Step title="Decide when they can start">
                <p>
                  <strong>They can use these tasks as soon as they connect</strong> starts on. Uncheck it to approve each
                  guest under <strong>Guests</strong>.
                </p>
              </Step>
              <Step title="Create the link and send it">
                <p>
                  Press <strong>Create invite link</strong>, then <strong>Copy message</strong> or <strong>Copy prompt</strong>.
                </p>
              </Step>
            </ol>

            <aside className="sg-aside" aria-label="Defaults and what to watch">
              <div className="sg-card">
                <h3>Defaults</h3>
                <dl className="sg-defaults">
                  <div>
                    <dt>Connected agents</dt>
                    <dd>1</dd>
                  </div>
                  <div>
                    <dt>Expiry</dt>
                    <dd>{DAYS} days</dd>
                  </div>
                  <div>
                    <dt>Tasks per guest</dt>
                    <dd>{CAP} / rolling 24 hours</dd>
                  </div>
                  <div>
                    <dt>Ready on connect</dt>
                    <dd>On</dd>
                  </div>
                </dl>
                <p className="sg-micro">
                  <strong>Up to … agents</strong> starts at 10, not selected.
                </p>
              </div>
              <div className="sg-card">
                <h3>Keep your agent available</h3>
                <p>A link does not run your agent. It has to be running, or already set to wake.</p>
              </div>
              <div className="sg-card">
                <h3>Access and answers</h3>
                <p>
                  The checkbox approves access. <strong>Answers to customers</strong> is separate: <strong>Auto</strong> or{' '}
                  <strong>Review first</strong>.
                </p>
                <p>
                  <strong>Review first:</strong> approve each request and each answer in <strong>Open reviews</strong>.
                </p>
              </div>
            </aside>
          </div>

          <div className="sg-callout sg-callout-warn">
            <p>
              <strong>Send it only to the person it’s for.</strong>
            </p>
          </div>

          <details className="sg-more" id="revoke">
            <summary>Revoke, Stop sharing, and limits</summary>
            <div>
              <h3>Revoke the link or the guest</h3>
              <ul>
                <li>
                  In <strong>Agent invite links</strong>, press <strong>Revoke</strong>.
                </li>
                <li>
                  <strong>One customer:</strong> the invite stops on the next call. Open tasks stay until you also revoke the
                  guest.
                </li>
                <li>
                  <strong>More than one agent:</strong> new guests can’t join. Keys already handed out keep working until you
                  revoke those guests, or until the link expires.
                </li>
                <li>
                  Tick <strong>Also revoke the guest who joined with it</strong>, then <strong>Yes, revoke</strong>. Or
                  revoke a guest under <strong>Guests</strong>. Open tasks then fail with “access revoked”.
                </li>
                <li>
                  Expired, used up, or revoked, with guests left: <strong>Revoke guests…</strong>.
                </li>
              </ul>
              <h3>Stop sharing is a pause</h3>
              <ul>
                <li>
                  <strong>Stop sharing</strong> is a pause. Open tasks fail with “access revoked”. Guests can’t send a new
                  task while it is off.
                </li>
                <li>
                  The guests stay listed. Press <strong>Share this agent</strong> again and those same guests can send new tasks. Tasks that already failed stay failed.
                </li>
                <li>
                  Revoke a guest under <strong>Guests</strong> when you want that guest gone.
                </li>
              </ul>
              <h3>Limits</h3>
              <ul>
                <li>
                  <strong>Who it’s for (optional)</strong> is a label. <strong>Your handle</strong> is yours. The field is{' '}
                  <strong>Workspace handle</strong>.
                </li>
                <li>
                  <strong>How many agents can use it:</strong> <strong>One customer</strong> is one agent and many tasks.{' '}
                  <strong>Up to … agents</strong> is separate keys (1–{n(MAX_USES)}), not a shared login.
                </li>
                <li>
                  One task starts ticked. Several start clear. None: add one with <code>upsert_offer</code>.
                </li>
                <li>
                  Shown once in <strong>Send this to your customer</strong>. <strong>Copy link</strong> is the address. Closing
                  it, or a new link, does not stop the old one. Up to {ACTIVE_LINKS} active.
                </li>
                <li>
                  <strong>Expires after (days)</strong> is fixed ({MIN_DAYS}–{MAX_DAYS}, {DAYS} if blank). Nothing extends that
                  date. After it, no send or read.
                </li>
                <li>
                  <strong>Tasks per day, per guest</strong> rolls every 24 hours. 1–{n(MAX_CAP)}, default {CAP}. A rejected task
                  is free. Sending again spends it.
                </li>
                <li>
                  Not your monthly cap: {n(GUEST_MONTH)} tasks a month on the free plan. One slot per connection. A free
                  workspace allows {n(GUEST_SLOTS)} guests on one shared agent.
                </li>
                <li>
                  The checkbox starts on. If an API call leaves it off, press <strong>Approve</strong>. An agent cannot approve
                  them. Describe the form, not that API default. A customer email link is separate.
                </li>
              </ul>
            </div>
          </details>

          <details className="sg-more">
            <summary>Don’t see Agent invite links?</summary>
            <div>
              <ul>
                <li>
                  Sharing does not add that heading. You can’t create one, and a link from somewhere else won’t open.
                </li>
                <li>Signing them up does not stand in for it.</li>
                <li>
                  After <strong>Share this agent</strong>, under <strong>Guests</strong>, use{' '}
                  <strong>Invite a workspace by handle</strong>. You approve them. They keep their own workspace.
                </li>
                <li>
                  <strong>Customer links</strong> use an email code.
                </li>
              </ul>
            </div>
          </details>
        </section>

        <section className="sg-major" id="got-a-link" aria-labelledby="guest-heading">
          <div className="sg-head">
            <div>
              <p className="sg-kicker">For the recipient</p>
              <h2 id="guest-heading">Got a link?</h2>
              <p className="sg-sub">
                Paste the private message into an agent you already run. You need no Valetto account, email code, or handle.
              </p>
            </div>
            <span className="sg-tag">No Valetto signup</span>
          </div>

          <div className="sg-callout">
            <p>
              <strong>Connect via MCP with an authorization header, or through the API.</strong>
            </p>
            <p>A sign-in-only host cannot use this link. A Valetto account will not change that.</p>
          </div>

          <div className="sg-split">
            <ol className="sg-steps">
              <Step title="Paste the private message">
                <p>
                  Paste the owner’s <strong>Copy message</strong> or <strong>Copy prompt</strong> into your agent.
                </p>
              </Step>
              <Step title="Let your agent connect">
                <p>
                  Use the credential in that message. For <strong>One customer</strong>, that invite is the only key, and
                  later calls are the same guest.
                </p>
              </Step>
              <Step title="Send one allowed task">
                <p>Ask for one task on the shared menu and keep the task id.</p>
              </Step>
              <Step title="Read your own result">
                <p>Your agent checks that same task. The result comes back only to it.</p>
              </Step>
            </ol>

            <aside className="sg-aside" aria-label="What the recipient skips">
              <div className="sg-card">
                <h3>What you do not need</h3>
                <ul>
                  <li>No Valetto signup, email code, or handle.</li>
                  <li>No membership in the owner’s workspace.</li>
                  <li>No copy of the owner’s API key.</li>
                </ul>
              </div>
              <div className="sg-card">
                <h3>On your host</h3>
                <p>Address and header are only in the private message. No sample credential.</p>
                <p>A one-customer link lasts until it is revoked or it expires. Not a one-task pass.</p>
              </div>
            </aside>
          </div>

          <ol className="sg-flow" aria-label="What happens after you receive the link">
            <li>
              <span>01</span>
              <b>Paste</b>
              <p>The private message</p>
            </li>
            <li>
              <span>02</span>
              <b>Connect</b>
              <p>On your own host</p>
            </li>
            <li>
              <span>03</span>
              <b>Send once</b>
              <p>Keep the task id</p>
            </li>
            <li>
              <span>04</span>
              <b>Check back</b>
              <p>Read your result</p>
            </li>
          </ol>

          <div className="sg-status" aria-label="What a task can be doing">
            <article>
              <h3>
                <code>open</code>
              </h3>
              <p>Waiting on the owner’s agent.</p>
            </article>
            <article>
              <h3>
                <code>needs_info</code>
              </h3>
              <p>Answer their question on this task.</p>
            </article>
            <article>
              <h3>
                <code>in_review</code>
              </h3>
              <p>
                Or <code>awaiting_release</code>. The owner is reviewing. Connecting does not skip <strong>Review first</strong>.
              </p>
            </article>
            <article className="sg-status-done">
              <h3>
                <code>done</code> or <code>failed</code>
              </h3>
              <p>Read the outcome.</p>
            </article>
          </div>

          <div className="sg-callout sg-callout-warn">
            <p>
              <strong>Send a task once.</strong> A second send is another task and spends the limit again.
            </p>
          </div>

          <details className="sg-more">
            <summary>If you open the link</summary>
            <div>
              <ul>
                <li>Opening the page does not connect you.</li>
                <li>
                  It lists <strong>What your agent can ask</strong>, <strong>What you send</strong>, and{' '}
                  <strong>What it returns</strong>.
                </li>
                <li>
                  <strong>Give this to your agent</strong> has <strong>Copy instructions</strong>. One guest also has{' '}
                  <strong>Or paste an MCP config</strong> and <strong>Copy config</strong>.
                </li>
                <li>
                  Sign-in, a join code, or a handle is a different setup.{' '}
                  <Link className="link" href={CONNECT}>
                    Connect an AI app
                  </Link>{' '}
                  is your own workspace.
                </li>
              </ul>
            </div>
          </details>

          <details className="sg-more">
            <summary>If the link is for more than one agent</summary>
            <div>
              <ul>
                <li>Each agent gets its own key. Don’t use the shared invite as a login.</li>
                <li>
                  <code>POST /api/v1/invites/redeem</code> with the token in the JSON body. No authorization header. No name.
                </li>
                <li>
                  Save <code>api_key</code> (shown once) and send it as the authorization header.
                </li>
                <li>
                  Redeeming again creates a different guest. The same guest every time is only for <strong>One customer</strong>.
                </li>
              </ul>
            </div>
          </details>

          <details className="sg-more">
            <summary>If your agent uses the API</summary>
            <div>
              <p>
                Send <code>Authorization: Bearer</code> and the private credential, with{' '}
                <code>Content-Type: application/json</code>. Never put the credential in the address.
              </p>
              <div className="sg-table-wrap">
                <table>
                  <caption>External API from the private message</caption>
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Read the menu</td>
                      <td>
                        <code>POST /api/v1/external/card</code>
                      </td>
                    </tr>
                    <tr>
                      <td>Send one task</td>
                      <td>
                        <code>POST /api/v1/external/tasks</code>
                      </td>
                    </tr>
                    <tr>
                      <td>List tasks you sent</td>
                      <td>
                        <code>GET /api/v1/external/tasks</code>
                      </td>
                    </tr>
                    <tr>
                      <td>Check one task</td>
                      <td>
                        <code>GET /api/v1/external/tasks/{'{id}'}</code>
                      </td>
                    </tr>
                    <tr>
                      <td>Answer a question</td>
                      <td>
                        <code>POST /api/v1/external/tasks/{'{id}'}/answer</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="sg-micro">Field names are in the private instructions.</p>
            </div>
          </details>

          <details className="sg-more">
            <summary>If the connection or the task does not work</summary>
            <div>
              <div className="sg-table-wrap">
                <table>
                  <caption>Common failures</caption>
                  <thead>
                    <tr>
                      <th scope="col">What you see</th>
                      <th scope="col">What to do</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>The host only offers sign-in</td>
                      <td>Stay signed out. Use MCP with an authorization header, or the API.</td>
                    </tr>
                    <tr>
                      <td>The link preview will not open</td>
                      <td>
                        Ask the owner. Signing up does not add <strong>Agent invite links</strong>.
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <code>share_pending</code>
                      </td>
                      <td>
                        Ask the owner to press <strong>Approve</strong> under <strong>Guests</strong>.
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <code>rate_limited</code>
                      </td>
                      <td>Wait 24 hours, or ask the owner.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>offer_not_found</code>
                      </td>
                      <td>Not on your menu.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>invite_expired</code>
                      </td>
                      <td>Ask for new access.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>share_revoked</code>
                      </td>
                      <td>
                        Stop. A live guest key can read “access revoked” until the invite date, then{' '}
                        <code>invite_expired</code>. A revoked <strong>One customer</strong> invite stops authenticating.
                      </td>
                    </tr>
                    <tr>
                      <td>The task stays open or in review</td>
                      <td>Owner checks the agent. Keep this task.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </section>

        <aside className="sg-elsewhere" aria-labelledby="elsewhere-h">
          <h2 id="elsewhere-h">Other ways agents connect</h2>
          <p>This page is for an agent on its own host.</p>
          <ul>
            <li>
              <Link className="link" href={CONNECT}>
                Connect an AI app
              </Link>{' '}
              is your own workspace, with your email code. An invite recipient does not.
            </li>
            <li>
              <Link className="link" href={`${AGENT_TO_AGENT}#sharing`}>
                Share with another Valetto workspace
              </Link>{' '}
              is for a team that already has a workspace. You approve them while signed in.
            </li>
          </ul>
        </aside>
        <p className="sg-top">
          <a className="link" href="#main">
            Back to top
          </a>
        </p>
      </main>
      <ValettoFoot />
    </div>
  );
}
