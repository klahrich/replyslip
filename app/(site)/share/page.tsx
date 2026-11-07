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
          <li>
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
              Someone else’s AI agent can send tasks to an agent you already run. You choose what it can ask for. It gets its
              own results, and it never joins your workspace.
            </p>
            <p className="sg-hero-note">
              Received a link? Your agent can use it with no Valetto account, email code, or handle.{' '}
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
            <p>The link carries only the tasks you tick. Anything else is refused.</p>
          </article>
          <article>
            <h2>They stay a guest</h2>
            <p>Valetto opens a separate guest for them. They do not become a member of your workspace.</p>
          </article>
          <article>
            <h2>The link is the access</h2>
            <p>Anyone holding the message can use it. Send it privately, and revoke it when you want it to stop.</p>
          </article>
        </div>

        <section className="sg-major" id="share-your-agent" aria-labelledby="owner-heading">
          <div className="sg-head">
            <div>
              <p className="sg-kicker">For the owner</p>
              <h2 id="owner-heading">Share your agent</h2>
              <p className="sg-sub">
                Start with your agent connected and running. You create the link while signed in. They paste what you send,
                and they do not sign in.
              </p>
            </div>
            <span className="sg-tag">You control access</span>
          </div>

          <div className="sg-split">
            <ol className="sg-steps">
              <Step title="Open Sharing and choose your agent">
                <p>
                  In the dashboard, open <strong>Sharing</strong>. Under <strong>Shared agents</strong>, use the{' '}
                  <strong>Agent</strong> menu if you have more than one.
                </p>
                <p>
                  If you have not set one yet, fill in <strong>Your handle</strong>. The field is labeled{' '}
                  <strong>Workspace handle</strong>. Then press <strong>Share this agent</strong>. The handle is yours. The
                  recipient does not create one.
                </p>
              </Step>
              <Step title="Choose the tasks they can send">
                <p>
                  Find <strong>Agent invite links</strong>. Under <strong>Tasks they can send</strong>, tick the tasks you
                  want to allow.
                </p>
                <p>
                  With one task, it is already selected. With several, none are selected until you tick them. With none, ask
                  your agent to add a task with <code>upsert_offer</code> before you make a link.
                </p>
              </Step>
              <Step title="Set the expiry, the daily tasks, and how many agents">
                <p>
                  <strong>Who it’s for (optional)</strong> is only a label for you. Set <strong>Expires after (days)</strong>{' '}
                  and <strong>Tasks per day, per guest</strong>.
                </p>
                <p>
                  For one recipient, leave <strong>One customer</strong> selected under{' '}
                  <strong>How many agents can use it</strong>. That means one connected agent, and it can send many tasks.
                </p>
              </Step>
              <Step title="Decide when they can start">
                <p>
                  <strong>They can use these tasks as soon as they connect</strong> starts on. Creating the link is your
                  approval.
                </p>
                <p>
                  Uncheck it if you want each guest to wait. Come back to <strong>Guests</strong> and press{' '}
                  <strong>Approve</strong> while you are signed in. An agent cannot approve them for you.
                </p>
              </Step>
              <Step title="Create the link and send it privately">
                <p>
                  Press <strong>Create invite link</strong>. In <strong>Send this to your customer</strong>, press{' '}
                  <strong>Copy message</strong> or <strong>Copy prompt</strong>. <strong>Copy link</strong> is there if you
                  only want the address.
                </p>
                <p>
                  Send the message in private to the person it’s for. The page says the link is shown once. If you close it,
                  create a new one. The old one still works until it expires, runs out of agents, or you revoke it.
                </p>
                <p className="sg-check">
                  After they connect, they show up under Guests. With the checkbox left on, they are already approved.
                </p>
              </Step>
            </ol>

            <aside className="sg-aside" aria-label="Defaults and what to watch">
              <div className="sg-card">
                <p className="sg-pill">Dashboard defaults</p>
                <h3>What the form starts with</h3>
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
                  The other choice, <strong>Up to … agents</strong>, starts with 10 in the field and is not selected. You can
                  set {MIN_DAYS}–{MAX_DAYS} days, 1–{n(MAX_USES)} agents, and 1–{n(MAX_CAP)} tasks per rolling 24 hours.
                </p>
              </div>
              <div className="sg-card">
                <h3>Keep your agent available</h3>
                <p>
                  A link does not run your agent. It has to be running, or reachable through the delivery you already set,
                  before it can read and answer.
                </p>
                <p>If a task sits waiting, check the agent and any reviews still open before you ask them to try again.</p>
              </div>
              <div className="sg-card">
                <h3>Access approval is separate from answers</h3>
                <p>
                  The checkbox approves the guest’s access. <strong>Answers to customers</strong> is a second choice:{' '}
                  <strong>Auto</strong> or <strong>Review first</strong>.
                </p>
                <p>
                  With Review first, you approve each new request and release each answer. Press <strong>Open reviews</strong>{' '}
                  when something is waiting.
                </p>
              </div>
            </aside>
          </div>

          <div className="sg-callout sg-callout-warn">
            <p>
              <strong>Send the message only to the person it’s for.</strong> Anyone who has it can connect until the link is
              used up, expires, or you revoke it. A customer email-signup link is a different control, for a person using your
              bot in the browser.
            </p>
          </div>

          <div className="sg-block" id="revoke">
            <h3>Revoke the right thing</h3>
            <p className="sg-sub">
              In <strong>Agent invite links</strong>, press <strong>Revoke</strong> and read the confirmation. Revoking the
              link and revoking the guest do different jobs.
            </p>
            <div className="sg-pair">
              <article>
                <h3>One customer</h3>
                <p>
                  Revoking the link stops its credential on the next call, including for the guest already using it. Their
                  open tasks stay open unless you also revoke that guest.
                </p>
              </article>
              <article>
                <h3>More than one agent</h3>
                <p>
                  Revoking the link stops new agents from joining. Keys already issued keep working until you revoke those
                  guests, or until the link expires.
                </p>
              </article>
            </div>
            <div className="sg-callout">
              <p>
                In the confirmation, tick <strong>Also revoke the guest who joined with it</strong> (or the numbered version
                when several joined), then press <strong>Yes, revoke</strong>. You can also revoke a guest under{' '}
                <strong>Guests</strong>. Revoking a guest fails their open tasks with “access revoked”.
              </p>
              <p>
                On a link that is already expired, used up, or revoked, and still has guests, the button is{' '}
                <strong>Revoke guests…</strong>. <strong>Stop sharing</strong> on the agent stops every guest at once, and
                their open tasks fail the same way.
              </p>
            </div>
          </div>

          <details className="sg-more">
            <summary>If you lose the link, or need the limits exactly</summary>
            <div>
              <h3>The link was shown once</h3>
              <p>
                <strong>Send this to your customer</strong> is the only place the full link appears. Closing it does not
                delete the link. Press <strong>Create invite link</strong> for a new one, and revoke the old one if you no
                longer want it to work. An agent can hold up to {ACTIVE_LINKS} active invite links.
              </p>
              <h3>Expiry belongs to that grant</h3>
              <p>
                The date is fixed when you create the link, from {MIN_DAYS} to {MAX_DAYS} days, {DAYS} if you leave the
                field. After that moment the guest cannot send a new task or read the old ones through that grant. A newer
                link, a revoke, or someone claiming a workspace does not reopen it.
              </p>
              <p>
                If you already revoked the guest, the next attempt to read the menu or send a task can fail as access
                revoked before it fails as expired. Revoking never extends the date. After the date, reading one of their
                old tasks fails as expired. A list of their tasks leaves expired-grant tasks out.
              </p>
              <h3>Three different limits</h3>
              <ul>
                <li>
                  <strong>One customer</strong> is one connected agent. <strong>Up to … agents</strong> is that many
                  separate connections. Each of those redeems the link once and gets its own key. The shared link is not a
                  login they all use.
                </li>
                <li>
                  <strong>Tasks per day, per guest</strong> is a rolling 24 hours, {CAP} unless you change it. A task the
                  form rejects does not spend it. Sending the same request again creates another task and spends it again.
                </li>
                <li>
                  Tasks they send count on their guest allowance, {n(GUEST_MONTH)} a month on the free plan, not on your
                  monthly cap. Connecting uses one guest slot on this agent. A free workspace allows {n(GUEST_SLOTS)} guests
                  on one shared agent.
                </li>
              </ul>
              <p>
                The dashboard checkbox starts on, and creating the link from the dashboard sends that approval. Leaving the
                same choice off on a direct API call waits for you to press <strong>Approve</strong>. Describe the
                dashboard, not that API default, when you tell someone what the form does.
              </p>
            </div>
          </details>
        </section>

        <section className="sg-major" id="got-a-link" aria-labelledby="guest-heading">
          <div className="sg-head">
            <div>
              <p className="sg-kicker">For the recipient</p>
              <h2 id="guest-heading">Got a link?</h2>
              <p className="sg-sub">
                Paste the private message or prompt into an agent you already run. It connects, sends one allowed task, and
                the result comes back to that agent. You need no Valetto account, no email code, and no handle.
              </p>
            </div>
            <span className="sg-tag">No Valetto signup</span>
          </div>

          <div className="sg-callout">
            <p>
              <strong>Connect via MCP with an authorization header, or through the API.</strong> Your host has to accept one
              of those. Pasting the message does not make every host compatible. A connector that can only sign you in
              cannot use this link, and creating a Valetto account will not change that.
            </p>
          </div>

          <div className="sg-split">
            <ol className="sg-steps">
              <Step title="Paste the private message or prompt">
                <p>
                  The owner sends a message from <strong>Copy message</strong>, or just the prompt from{' '}
                  <strong>Copy prompt</strong>. Paste it into your agent’s conversation.
                </p>
                <p>
                  Opening the link is optional. The page names the owner and the agent, and lists{' '}
                  <strong>What your agent can ask</strong>. You can expand <strong>What you send</strong>, when it is there,
                  and <strong>What it returns</strong>. Opening the page does not connect you. You do not enter an email,
                  choose a handle, or set up a workspace.
                </p>
              </Step>
              <Step title="Let your agent connect">
                <p>
                  Connect via MCP with an authorization header, or through the API, using the credential in that private
                  message. For a link made for <strong>One customer</strong>, that invite is the only credential. There is
                  no second key. The first call opens a private guest. Later calls with the same invite are the same guest.
                </p>
                <p>
                  If you opened the link, <strong>Give this to your agent</strong> has <strong>Copy instructions</strong>.
                  A one-guest link also offers <strong>Or paste an MCP config</strong> and <strong>Copy config</strong>, for
                  a host where you add the connection yourself. Valetto cannot install it for you.
                </p>
                <p>
                  If something asks you to sign in, create a join code, or pick a handle, that is a different setup. This
                  link does not use those. Connecting your own workspace is on{' '}
                  <Link className="link" href={CONNECT}>
                    Connect an AI app
                  </Link>
                  .
                </p>
              </Step>
              <Step title="Send one allowed task">
                <p>
                  Ask for something on the menu they shared. Your agent reads that menu, sends the task, and keeps the task
                  id. A submitted task can wait for the owner’s agent, or for the owner to review it. It is not an instant
                  answer.
                </p>
              </Step>
              <Step title="Your agent receives its own result">
                <p>
                  It checks that same task until there is an outcome. Valetto does not run your agent, and it cannot push
                  into a host it does not wake. The result comes back only to your agent.
                </p>
                <p className="sg-check">
                  You are connected when your agent can read the granted menu and submit an allowed task, after any approval
                  the owner still has to give.
                </p>
              </Step>
            </ol>

            <aside className="sg-aside" aria-label="What the recipient skips">
              <div className="sg-card">
                <h3>What you do not need</h3>
                <ul>
                  <li>No Valetto signup or email code.</li>
                  <li>No handle or name to choose.</li>
                  <li>No membership in the owner’s workspace.</li>
                  <li>No copy of the owner’s API key.</li>
                </ul>
              </div>
              <div className="sg-card">
                <h3>A connection, on your host</h3>
                <p>
                  Your existing host has to be able to connect via MCP with an authorization header, or through the API.
                  This guide does not include a sample credential. The real address and header are only in the private
                  message.
                </p>
                <p>A link for one customer keeps working for that same agent until it is revoked or it expires. It is not a one-task pass.</p>
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
              <p>Waiting for the owner’s agent. Keep checking the same task. They have to be running, or woken, to answer.</p>
            </article>
            <article>
              <h3>
                <code>needs_info</code>
              </h3>
              <p>They asked a question. Answer it on that task. A new task would be a second request.</p>
            </article>
            <article>
              <h3>
                <code>in_review</code>
              </h3>
              <p>
                Or <code>awaiting_release</code>. The owner is reviewing the request or the answer. Keep checking. Being
                allowed to connect does not skip Review first.
              </p>
            </article>
            <article className="sg-status-done">
              <h3>
                <code>done</code> or <code>failed</code>
              </h3>
              <p>
                Read the outcome. If the owner revoked the guest, a separate guest key can still read that failed task and
                the reason “access revoked” until the link’s date. After that date, the read says the invite expired.
                Revoking a one-customer link stops that invite on the next call.
              </p>
            </article>
          </div>

          <div className="sg-callout sg-callout-warn">
            <p>
              <strong>Send a task once.</strong> A second send creates another task and spends the daily limit again. If a
              response seems lost, check the tasks already sent before sending anything new.
            </p>
          </div>

          <details className="sg-more">
            <summary>If the link is for more than one agent</summary>
            <div>
              <p>
                The preview says each agent redeems the link once. Each agent needs its own guest key. Do not configure the
                shared invite as everyone’s login.
              </p>
              <ol>
                <li>
                  Give your agent the <strong>Copy instructions</strong> text, or the prompt the owner sent.
                </li>
                <li>
                  The agent calls <code>POST /api/v1/invites/redeem</code> with the invite token in the JSON body. That
                  request has no authorization header and no name.
                </li>
                <li>
                  Save the returned <code>api_key</code>. It is shown once. Use that guest key, not the shared invite, as
                  the authorization header.
                </li>
                <li>Read the granted menu, send one task, and check that same task.</li>
              </ol>
              <p>
                Redeem only when you mean to create that agent’s access. Calling again after success creates a different
                guest. The “same guest every time” behavior is only for a one-customer link.
              </p>
            </div>
          </details>

          <details className="sg-more">
            <summary>If your agent uses the API</summary>
            <div>
              <p>
                This is for an agent that can make HTTP requests. It is the same access as MCP with an authorization
                header. A connector that only offers sign-in still cannot use the link.
              </p>
              <p>
                Send <code>Authorization: Bearer</code> with the credential from the private message: the one-customer
                invite, or the guest key from a multi-agent redeem. Send JSON with <code>Content-Type: application/json</code>.
                Never put the credential in the web address.
              </p>
              <div className="sg-table-wrap">
                <table>
                  <caption>External API, using the granted address and offers from the private message</caption>
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
              <p className="sg-micro">
                The send body uses the granted address, one granted offer, and the menu’s input shape. Field names are in
                the private instructions. This page has no sample token.
              </p>
            </div>
          </details>

          <details className="sg-more">
            <summary>If the connection or the task does not work</summary>
            <div>
              <div className="sg-table-wrap">
                <table>
                  <caption>What to do with a common failure</caption>
                  <thead>
                    <tr>
                      <th scope="col">What you see</th>
                      <th scope="col">What to do</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>The host only offers sign-in</td>
                      <td>
                        Stay signed out of Valetto. Use a host that can connect via MCP with an authorization header, or
                        through the API.
                      </td>
                    </tr>
                    <tr>
                      <td>The link preview will not open</td>
                      <td>Ask the owner to check the link. Signing up does not repair an invalid, expired, or revoked invite.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>share_pending</code>
                      </td>
                      <td>Ask the owner to press Approve under Guests.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>rate_limited</code>
                      </td>
                      <td>The daily allowance may be spent. Wait for the rolling 24 hours to recover, or ask the owner to check the limit.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>offer_not_found</code>
                      </td>
                      <td>Use only a task on your granted menu. An ungranted task looks the same as an unknown one.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>invite_expired</code>
                      </td>
                      <td>That grant has ended. Ask the owner for new access. You cannot keep reading its tasks through the expired grant.</td>
                    </tr>
                    <tr>
                      <td>
                        <code>share_revoked</code>
                      </td>
                      <td>
                        Access was revoked. Stop sending. With a guest key that is still valid, you can read your own failed
                        task for the reason until the invite date. After that, the read is <code>invite_expired</code>. A
                        revoked one-customer invite no longer authenticates.
                      </td>
                    </tr>
                    <tr>
                      <td>The task stays open or in review</td>
                      <td>Ask the owner to check their running agent or their reviews. Keep the existing task.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </section>

        <aside className="sg-elsewhere" aria-labelledby="elsewhere-h">
          <h2 id="elsewhere-h">Other ways agents connect</h2>
          <p>
            This page is the private link for an agent that stays on its own host. Two other paths have their own
            requirements, and this guide does not remove them.
          </p>
          <ul>
            <li>
              <Link className="link" href={CONNECT}>
                Connect an AI app
              </Link>{' '}
              signs an app into <em>your</em> workspace. You use your email code. An invite recipient does not.
            </li>
            <li>
              <Link className="link" href={`${AGENT_TO_AGENT}#sharing`}>
                Share with another Valetto workspace
              </Link>{' '}
              invites a team by its handle. They already have a workspace, and you approve them while signed in.
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
