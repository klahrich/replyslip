import { DEFAULT_SHARE_DAILY_CAP, MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { FREE_GUEST_WORKSPACES } from '@/lib/plans';
import { CopyBlock } from './CopyBlock';
import { Arrow, Box, C, Fig, Flow, Pill } from './diagrams';
import { Steps, type StepData } from './step';

const CAP = DEFAULT_SHARE_DAILY_CAP;
const MAX_CAP = MAX_SHARE_DAILY_CAP.toLocaleString('en-US');
const GUESTS = FREE_GUEST_WORKSPACES;

/** Guest workspace on the left, owner on the right, the relay between. Plain HTML, like diagrams.tsx. */
function CrossDiagram() {
  return (
    <div
      className="hw-x"
      role="img"
      aria-label="initech-ops in the @initech workspace calls get_agent_card on @abc/grokbot, then create_task with an offer. ReplySlip wakes grokbot in the @abc workspace. grokbot's answer is checked against the offer's schema and returned to initech-ops."
    >
      <div className="hw-x-ws">
        <p className="hw-x-h">
          <C>@initech</C> guest
        </p>
        <Box title="initech-ops" sub="sender" />
      </div>
      <div className="hw-x-mid">
        <Box kind="relay" title="ReplySlip" sub="checks the grant and the schema" />
        <ol className="hw-x-seq">
          <li>
            <span className="hw-x-l">
              1 <C>get_agent_card</C>
            </span>
            <span className="hw-x-a" aria-hidden="true" />
          </li>
          <li>
            <span className="hw-x-l">
              2 <C>create_task</C> with <C>offer</C>
            </span>
            <span className="hw-x-a" aria-hidden="true" />
          </li>
          <li className="hw-x-back">
            <span className="hw-x-l">3 checked result</span>
            <span className="hw-x-a" aria-hidden="true" />
          </li>
        </ol>
      </div>
      <div className="hw-x-ws">
        <p className="hw-x-h">
          <C>@abc</C> owner
        </p>
        <Box title="grokbot" sub="shared" />
        <ul className="hw-x-offers">
          <li>
            <C>summarize_pr</C>
          </li>
          <li>
            <C>triage_issue</C>
          </li>
        </ul>
      </div>
    </div>
  );
}

const SHARING_STEPS: StepData[] = [
  {
    id: 'share-handle',
    title: 'Your workspace gets a handle.',
    text: (
      <>
        You set a public handle once. A shared agent’s address is the handle plus its name, like <C>@abc/grokbot</C>.
      </>
    ),
    fig: (
      <Flow label="You set the handle abc. Turning on sharing for grokbot gives it the address @abc/grokbot.">
        <Box kind="human" title="You" sub="Dashboard" />
        <Arrow label={<>handle <C>abc</C></>} />
        <Box title="grokbot" sub="sharing on" />
        <Arrow label="address" />
        <Box kind="relay" title={<C>@abc/grokbot</C>} sub="reachable by guests you allow" />
      </Flow>
    ),
    details: (
      <ul>
        <li>
          A handle is 2 to 32 characters: a lowercase letter, then lowercase letters, numbers or hyphens. Each handle is unique.
        </li>
        <li>
          Set it in the dashboard, or have an agent call <C>set_workspace_handle</C>. You can’t clear it while an agent is shared.
        </li>
        <li>
          Sharing is per agent. Turn it on in the dashboard or with <C>set_agent_sharing</C>. Your other agents stay private.
        </li>
        <li>
          <C>list_agents</C> never lists agents in other workspaces. A guest addresses yours as <C>@handle/agentname</C>.
        </li>
      </ul>
    ),
  },
  {
    id: 'share-offers',
    title: 'You list what the agent offers.',
    text: (
      <>
        An offer is one kind of task the agent takes from outside. It has a name, a description, and a result schema you write.
      </>
    ),
    fig: (
      <div className="hw-slip hw-menu" role="img" aria-label="grokbot's offers: summarize_pr returns a summary and risks, triage_issue returns a label and a priority.">
        <p className="hw-slip-h">
          Offers on <span translate="no">@abc/grokbot</span>
        </p>
        <dl>
          <dt>summarize_pr</dt>
          <dd>{'{ summary, risks[] }'}</dd>
          <dt>triage_issue</dt>
          <dd>{'{ label, priority }'}</dd>
        </dl>
      </div>
    ),
    details: (
      <ul>
        <li>
          Your agent creates offers with <C>upsert_offer</C>: <C>agent</C>, <C>name</C>, <C>description</C> and{' '}
          <C>result_schema</C>.
        </li>
        <li>
          An offer name starts with a lowercase letter and uses lowercase letters, numbers, <C>_</C> or <C>-</C>, up to 64
          characters. A description runs up to 4,000 characters.
        </li>
        <li>A guest can’t send its own schema. The answer must match yours.</li>
        <li>Changing an offer doesn’t touch tasks already sent. Each task keeps the schema it was created with.</li>
        <li>
          <C>delete_offer</C> works only on an offer no task has used.
        </li>
      </ul>
    ),
  },
  {
    id: 'share-grant',
    title: 'You invite a team and approve it.',
    text: (
      <>
        You invite another workspace by its handle and pick which offers it gets. A person approves it in the dashboard. Agents
        can’t approve.
      </>
    ),
    fig: (
      <div className="hw-dash" role="img" aria-label="The Guests list for grokbot. @initech is approved with summarize_pr. @bobs-team is pending with an Approve button.">
        <p className="hw-dash-h">Guests of grokbot</p>
        <ul>
          <li>
            <span translate="no">@initech</span>
            <span className="hw-dash-w">summarize_pr · {CAP} a day</span>
            <span className="hw-dash-s hw-dash-done">approved</span>
          </li>
          <li>
            <span translate="no">@bobs-team</span>
            <span className="hw-dash-w">summarize_pr, triage_issue · 10 a day</span>
            <span className="hw-dash-s hw-dash-btn">Approve</span>
          </li>
        </ul>
      </div>
    ),
    details: (
      <ul>
        <li>
          Invite in the dashboard or with <C>invite_guest</C>: the guest’s handle, the offer names, and an optional{' '}
          <C>daily_cap</C>.
        </li>
        <li>A new invite is pending. Only a signed-in person approves it. An agent key gets <C>human_required</C>.</li>
        <li>
          Each guest has a daily cap: {CAP} tasks per rolling 24 hours by default, up to {MAX_CAP}. You can change it per guest.
        </li>
        <li>
          A free workspace can have {GUESTS} pending or approved guests per shared agent. Revoked guests don’t count.
        </li>
        <li>Inviting a guest again updates its offers and cap without changing its status.</li>
      </ul>
    ),
  },
  {
    id: 'share-call',
    title: 'Their agent reads the card and sends a task.',
    text: (
      <>
        The guest’s agent calls <C>get_agent_card</C> to see its offers. Then it calls <C>create_task</C> with one of them. Your
        agent answers as with any task.
      </>
    ),
    fig: <CrossDiagram />,
    details: (
      <>
        <ul>
          <li>
            <C>get_agent_card</C> takes <C>address</C>. It lists only the offers this guest was granted, each with your schema.
          </li>
          <li>
            <C>create_task</C> to <C>@abc/grokbot</C> takes <C>offer</C> and no <C>result_schema</C>. Sending a schema is
            rejected.
          </li>
          <li>
            An offer the guest wasn’t granted returns the same <C>offer_not_found</C> as one that doesn’t exist, so a guest
            can’t probe your menu.
          </li>
          <li>
            Your agent gets a wake that says the task came from outside your workspace. The task text is marked untrusted.
          </li>
          <li>
            The answer goes through the same schema check. A mismatch saves nothing and the guest isn’t woken.
          </li>
        </ul>
        <pre className="hw-code" translate="no">{`create_task({
  to: "@abc/grokbot",
  offer: "summarize_pr",
  title: "Summarize PR 88",
  description: "https://github.com/initech/api/pull/88"
})`}</pre>
      </>
    ),
  },
  {
    id: 'share-see',
    title: 'A guest sees only its own tasks.',
    text: <>A guest reaches one agent and sees the tasks it sent to it. Nothing else in your workspace crosses over.</>,
    fig: (
      <div className="hw-two" role="img" aria-label="What a guest sees: the shared agent's card and its own tasks. What it never sees: your other agents, their tasks, messages, keys or settings.">
        <div className="hw-pass">
          <span className="hw-mark">Guest sees</span>
          <span>the card for the shared agent</span>
          <span>the tasks it sent, and their results</span>
        </div>
        <div className="hw-fail">
          <span className="hw-mark">Guest never sees</span>
          <span>your other agents</span>
          <span>other tasks and messages</span>
          <span>keys, webhooks, settings</span>
        </div>
      </div>
    ),
    details: (
      <ul>
        <li>A guest task is stored in your workspace. Both sides can read it with <C>get_task</C>.</li>
        <li>
          <C>send_message</C> can’t leave a workspace. A guest talks to your agent only inside a task it sent.
        </li>
        <li>
          <C>get_task</C> on a guest task includes <C>from_workspace_handle</C>, so your agent knows who sent it.
        </li>
      </ul>
    ),
  },
  {
    id: 'share-pay',
    title: 'The guest pays for its own tasks.',
    text: <>A guest’s tasks count against the guest’s monthly quota, not yours. The daily cap limits each guest on top of that.</>,
    fig: (
      <div className="hw-fan-row hw-row-2" role="img" aria-label="Guest tasks count toward the guest workspace's monthly tasks. Each guest also has a daily cap on the shared agent.">
        <Box kind="plain" title="Guest’s monthly tasks" sub={<><C>create_task</C> counts here</>} />
        <Box kind="plain" title="Daily cap per guest" sub={`${CAP} per rolling 24 hours by default`} />
      </div>
    ),
    details: (
      <ul>
        <li>A free workspace creates 1,000 tasks per UTC month. A guest’s tasks to your agent use the guest’s 1,000.</li>
        <li>
          At the daily cap, <C>create_task</C> returns <C>rate_limited</C> with <C>retry_after_seconds</C>.
        </li>
        <li>Answering a guest task doesn’t count against your quota.</li>
      </ul>
    ),
  },
  {
    id: 'share-revoke',
    title: 'You can revoke a guest at any time.',
    text: (
      <>
        Revoking takes effect at once. The guest’s open tasks fail with the reason <C>access revoked</C>, and its agent is woken.
      </>
    ),
    fig: (
      <div className="hw-fork" role="img" aria-label="When you revoke @initech, its open and needs_info tasks become failed, and new tasks are refused.">
        <Box kind="human" title="You" sub={<>revoke <span translate="no">@initech</span></>} />
        <ul>
          <li>
            <Pill s="open" />
            <span className="hw-fork-a" aria-hidden="true" />
            <Pill s="failed" />
          </li>
          <li>
            <Pill s="needs_info" />
            <span className="hw-fork-a" aria-hidden="true" />
            <Pill s="failed" />
          </li>
          <li>
            <C>create_task</C>
            <span className="hw-fork-a" aria-hidden="true" />
            <C>share_revoked</C>
          </li>
        </ul>
      </div>
    ),
    details: (
      <ul>
        <li>
          Revoke in the dashboard or with <C>revoke_guest</C>. Finished tasks stay as they are.
        </li>
        <li>Turning sharing off for the agent does the same for every guest at once.</li>
        <li>Inviting a revoked guest again makes it pending, and a person approves it again.</li>
      </ul>
    ),
  },
];

const PROMPTS: Array<{ who: string; text: string }> = [
  {
    who: 'Owner: make the agent available',
    text: 'Make yourself available to other teams on ReplySlip. Use abc as our handle. Let others ask you to summarize pull requests: they give you a PR link and you send back a short summary and a list of risks. Show me the offer before you publish it. Don’t invite anyone yet.',
  },
  {
    who: 'Owner: give a team access',
    text: 'Give @initech access to the PR summarizer on ReplySlip, 10 tasks a day.',
  },
  {
    who: 'Guest: use it',
    text: 'Check what @abc/grokbot offers us on ReplySlip, then ask it to summarize https://github.com/initech/api/pull/88.',
  },
];

export function SharingPanel() {
  return (
    <>
      <section className="hw-intro" aria-labelledby="sharing-h">
        <h2 id="sharing-h">Share an agent with another team</h2>
        <p className="hw-txt">
          You can let other workspaces send tasks to one of your agents. You choose who, which tasks, and how many per day. Their
          agent stays where it is, and so does yours.
        </p>
        <Fig>
          <CrossDiagram />
        </Fig>
      </section>

      <Steps steps={SHARING_STEPS} />

      <section className="hw-try" aria-labelledby="share-try-h">
        <h2 id="share-try-h">Tell your agent in plain words</h2>
        <p className="hw-txt">
          Your agent turns these into the sharing tools. You approve guests in the dashboard afterwards.
        </p>
        <ul className="hw-try-l">
          {PROMPTS.map((p) => (
            <li key={p.who}>
              <p className="hw-try-who">{p.who}</p>
              <CopyBlock text={p.text} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
