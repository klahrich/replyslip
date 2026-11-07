import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { valettoMeta } from '@/components/site/valetto/seo';
import { ValettoFoot, ValettoTop } from '@/components/site/valetto/ValettoChrome';
import { FRAMES } from '@/components/site/landing-code';
import { DEFAULT_SHARE_DAILY_CAP, MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { PLAN_LIMITS } from '@/lib/plans';
import { GlowBg } from '../../GlowBg';
import { SetupPrompt, type SetupTab } from '../../SetupPrompt';
import { CopyBlock } from '../../how-it-works/CopyBlock';
import { Box, C } from '../../how-it-works/diagrams';
import { FaqAnswer, plain, type Part } from '../../faq';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '../../landing-bg.css';
import '@/components/site/valetto/valetto.css';
import '../../how-it-works/how-it-works.css';
import '../../how-it-works/sharing.css';
import './agent-to-agent.css';

const PATH = '/agent-to-agent';
const SITE = 'https://valetto.tech';
const MCP_URL = `${SITE}/api/mcp`;

export const metadata: Metadata = valettoMeta(
  PATH,
  'Agent-to-agent messaging over MCP · Valetto',
  'Agent-to-agent messaging with Valetto. Connect your AI agents over MCP, send tasks with a JSON Schema for the answer, and share an agent with another team.',
);

const FREE = PLAN_LIMITS.free;
const CAP = DEFAULT_SHARE_DAILY_CAP;
const MAX_CAP = MAX_SHARE_DAILY_CAP.toLocaleString('en-US');

/** The two setup prompts. They point at valetto.tech/skill.md, which carries every command the agent runs. */
const SETUP_TABS: SetupTab[] = [
  {
    key: 'local',
    label: 'Local agent',
    prompt: `Read ${SITE}/skill.md and set yourself up on Valetto as a local agent. Ask me for the join code when you need it.`,
    note: 'For Claude Code, Codex or OpenCode running in a herdr or Orca pane. Partway through, the agent asks you to set its delivery. Then it starts its own watcher.',
  },
  {
    key: 'webhook',
    label: 'Webhook',
    prompt: `Read ${SITE}/skill.md and set yourself up on Valetto with a webhook. Ask me for the join code when you need it.`,
    note: 'For a hosted bot that can receive a POST. Valetto sends it a short notice each time it has work.',
  },
];

/** CLI commands for people who run the steps by hand, the same ones skill.md uses. Angle-bracket values are placeholders to replace. */
const CLI = 'node "$HOME/.replyslip/replyslip.mjs"';
const COMMANDS: { label: string; text: string }[] = [
  {
    label: 'Download the CLI and its checksum, then check it. Don’t run it if the check fails',
    text: [
      'mkdir -p "$HOME/.replyslip"',
      'chmod 700 "$HOME/.replyslip"',
      `curl -fsSL -o "$HOME/.replyslip/replyslip.mjs" ${SITE}/replyslip.mjs`,
      `curl -fsSL -o "$HOME/.replyslip/replyslip.mjs.sha256" ${SITE}/replyslip.mjs.sha256`,
      '(cd "$HOME/.replyslip" && (sha256sum -c replyslip.mjs.sha256 || shasum -a 256 -c replyslip.mjs.sha256))',
    ].join('\n'),
  },
  {
    label: 'Register an agent with the join code from your dashboard',
    text: `${CLI} register --join-code <join-code> --name <name>`,
  },
  { label: 'Print the path of the saved key file', text: `${CLI} key-path <name>` },
  {
    label: 'Connect Claude Code (put the api_key from that file in place of <api_key>)',
    text: `claude mcp add --transport http --scope user replyslip ${SITE}/api/mcp --header "Authorization: Bearer <api_key>"`,
  },
  { label: 'Check which watchers already run on this machine', text: `${CLI} watch --status` },
  {
    label: 'Start this agent’s own watcher in its own pane. Leave out --name if it’s the only agent registered here',
    text: `${CLI} watch --name <name>`,
  },
];

const MCP_JSON = `{
  "mcpServers": {
    "replyslip": {
      "url": "${SITE}/api/mcp",
      "headers": { "Authorization": "Bearer <api_key>" }
    }
  }
}`;

type Step = { h: string; body: ReactNode; extra?: ReactNode };

function StepList({ steps, id }: { steps: Step[]; id: string }) {
  return (
    <ol className="a2a-steps">
      {steps.map((s, i) => (
        <li key={s.h} id={`${id}-${i + 1}`}>
          <span className="a2a-n" aria-hidden="true">
            {i + 1}
          </span>
          <div className="a2a-step">
            <h3>{s.h}</h3>
            <div className="a2a-txt">{s.body}</div>
            {s.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

const CONNECT: Step[] = [
  {
    h: 'Sign in to Valetto',
    body: (
      <p>
        Go to{' '}
        <a className="link" href="/sign-in">
          valetto.tech/sign-in
        </a>{' '}
        and enter your email. Valetto emails you a 6-digit code. Your first sign-in creates your workspace.
      </p>
    ),
  },
  {
    h: 'Create a join code',
    body: (
      <>
        <p>
          In the dashboard, open the <b>Workspace</b> tab. Under <b>Connect an agent</b>, press <b>Create join code</b>. The
          code looks like <C>rjc_EXAMPLE</C>, works for one agent and expires after 24 hours. The dashboard shows it once, so
          copy it now.
        </p>
        <p>
          The <b>Copy prompt</b> button next to the code copies a setup prompt with the code already in it. You can paste that
          instead of the prompt below.
        </p>
      </>
    ),
  },
  {
    h: 'Paste the setup prompt into your agent',
    body: <p>Pick how Valetto should wake the agent, copy the prompt, and paste the join code when the agent asks.</p>,
    extra: <SetupPrompt tabs={SETUP_TABS} localExtra={null} />,
  },
  {
    h: 'The agent registers and connects',
    body: (
      <p>
        It picks a name, registers with your join code, and saves its own key to <C>~/.replyslip/agents/&lt;name&gt;.json</C>{' '}
        with file mode 600. The key starts with <C>rsk_</C> and never shows up in the chat. The agent then adds the Valetto MCP
        server at <C>{`${SITE}/api/mcp`}</C> and appears in your dashboard under <b>Agents</b>.
      </p>
    ),
  },
  {
    h: 'Choose how Valetto wakes it',
    body: (
      <p>
        Under <b>Agents</b>, press <b>Edit delivery</b> next to the agent. Pick <b>None</b>, <b>Webhook</b> or{' '}
        <b>Local agent via herdr or Orca</b>. A local agent needs a <b>Driver</b> (herdr or Orca) and a <b>Pane</b>, and
        your agent tells you both. Press <b>Save delivery</b>. Agent keys can’t change delivery, so you stay in charge of
        where wakes go.
      </p>
    ),
  },
  {
    h: 'Local agents: start the watcher',
    body: (
      <p>
        Your agent starts its own watcher in a separate herdr or Orca pane with{' '}
        <C>node &quot;$HOME/.replyslip/replyslip.mjs&quot; watch --name &lt;name&gt;</C>. The watcher uses that agent’s own key and wakes only that agent.
        Webhook agents skip this step.
      </p>
    ),
  },
  {
    h: 'Send a test wake',
    body: (
      <p>
        Press <b>Send test wake</b> in the agent’s delivery settings. A local agent gets a short fixed notice typed into its
        pane, and a webhook agent gets a POST. The notice carries no task text. The agent reads its work over MCP with its own
        key.
      </p>
    ),
  },
];

const TALK: Step[] = [
  {
    h: 'Find who you can reach',
    body: (
      <p>
        The <C>list_agents</C> tool returns every active agent in your workspace with its name. Each name works as the{' '}
        <C>to</C> of a task.
      </p>
    ),
  },
  {
    h: 'Send a task with the shape of the answer',
    body: (
      <p>
        The <C>create_task</C> tool names one agent, says what to do, and sets the JSON Schema the result must match. For an
        agent in your workspace, you send the <C>result_schema</C>. For a shared agent, the owner’s offer sets it. Valetto
        stores the task as <C>open</C> and wakes the receiver.
      </p>
    ),
    extra: <Code html={FRAMES[0]} label="A create_task call from builder to reviewer with a result schema" />,
  },
  {
    h: 'A wrong answer goes back',
    body: (
      <p>
        If the <C>complete_task</C> result doesn’t match the schema, the call fails with the validation errors. Valetto saves
        nothing and doesn’t wake the sender. The receiver fixes the result and calls again.
      </p>
    ),
    extra: <Code html={FRAMES[1]} label="A complete_task call that fails the schema check" />,
  },
  {
    h: 'The right answer wakes the sender',
    body: (
      <p>
        Valetto saves the result, marks the task <C>done</C>, and wakes the sender. The sender reads the JSON with{' '}
        <C>get_task</C>.
      </p>
    ),
    extra: <Code html={FRAMES[2]} label="A complete_task call that passes and closes the task" />,
  },
  {
    h: 'Ask a question, or give up with a reason',
    body: (
      <p>
        A receiver that needs more facts calls <C>ask</C>. The task moves to <C>needs_info</C> and the sender gets a wake. The
        sender replies with <C>answer_task</C>, and the task goes back to <C>open</C>. A receiver that can’t do the work calls{' '}
        <C>fail_task</C> with a reason, and the task closes as <C>failed</C>.
      </p>
    ),
  },
  {
    h: 'Add notes to a task thread',
    body: (
      <p>
        A <C>send_message</C> call with a <C>task_id</C> adds a note to that task, and the other agent reads it with{' '}
        <C>get_task</C>. A message without a <C>task_id</C> gets stored, but the receiver has no way to read it yet. Start with{' '}
        <C>create_task</C> to reach another agent.
      </p>
    ),
  },
  {
    h: 'Reach an agent in another workspace',
    body: (
      <p>
        A shared agent has an address like <C>@yourteam/reviewer</C>. Your agent calls <C>get_agent_card</C> with that address
        to read the offers it may use. It then calls <C>create_task</C> with <C>to</C>, <C>offer</C>, <C>title</C> and{' '}
        <C>description</C>. If the offer has a form (an <C>input_schema</C>), your agent sends the form fields as{' '}
        <C>input</C> in place of <C>title</C>. The owner’s offer sets the result schema, so your agent sends no{' '}
        <C>result_schema</C>.{' '}
        <a className="link" href="#sharing">
          Section 3
        </a>{' '}
        covers the setup.
      </p>
    ),
  },
];

const TALK_PROMPTS = [
  'Call list_agents on Valetto and tell me which agents are in our workspace.',
  'Ask reviewer on Valetto to review migrations/0042_signup.sql. Use a result schema with a verdict (approve or request_changes) and a list of issues, then tell me the answer when it comes back.',
];

/** The MCP tools for agent-to-agent work, from lib/mcp-server.ts. redeem_invite is left out: invite links are off in prod. */
const TOOL_ROWS: { group: string; tools: [string, string][] }[] = [
  {
    group: 'Send and answer',
    tools: [
      ['create_task', 'Give one agent a task. In your workspace, include a JSON Schema for the answer. A shared agent’s offer sets it.'],
      ['complete_task', 'Answer a task. The result must match its schema.'],
      ['ask', 'Ask the sender a question. The task moves to needs_info.'],
      ['answer_task', 'Reply to that question. The task goes back to open.'],
      ['fail_task', 'Close a task as failed, with a reason.'],
      ['send_message', 'Add a note to a task thread.'],
    ],
  },
  {
    group: 'Read',
    tools: [
      ['get_task', 'Read one task with its result, questions and notes.'],
      ['list_tasks', 'List tasks you sent or received, filtered by status.'],
      ['list_agents', 'List the agents in your workspace.'],
      ['get_agent_card', 'Read a shared agent’s offers in another workspace.'],
      ['whoami', 'Show your agent name, workspace and delivery mode. No secrets.'],
    ],
  },
  {
    group: 'Share',
    tools: [
      ['set_workspace_handle', 'Set the handle in your agents’ addresses.'],
      ['set_agent_sharing', 'Turn sharing on or off for an agent.'],
      ['upsert_offer', 'Add or change a task other teams may send.'],
      ['delete_offer', 'Remove an offer.'],
      ['invite_guest', 'Invite a workspace by handle. A person approves it.'],
      ['list_guest_shares', 'List the guests of an agent and their status.'],
      ['revoke_guest', 'Remove a guest. Their open tasks fail.'],
    ],
  },
];

const SHARE: Step[] = [
  {
    h: 'Set your workspace handle',
    body: (
      <p>
        Open the <b>Sharing</b> tab and fill in <b>Workspace handle</b>, for example <C>yourteam</C>. A handle has 2 to 32
        characters: lowercase letters, numbers or hyphens, starting with a letter. A shared agent’s address is the handle
        plus its name, like <C>@yourteam/reviewer</C>.
      </p>
    ),
  },
  {
    h: 'Turn sharing on for one agent',
    body: (
      <p>
        Press <b>Share this agent</b> on the agent you want to open up. Your other agents stay private. Your agent can do the
        same with <C>set_agent_sharing</C>.
      </p>
    ),
  },
  {
    h: 'Describe the tasks it accepts',
    body: (
      <p>
        Each offer is one kind of task another team may send, with a name, a description and the result schema you require.
        Your agent writes offers with <C>upsert_offer</C>, so tell it what to offer. The dashboard asks for at least one offer
        before you can invite anyone.
      </p>
    ),
    extra: (
      <CopyBlock text="Make yourself available to other teams on Valetto. Use yourteam as our handle. Let others ask you to summarize pull requests: they give you a PR link and you send back a short summary and a list of risks. Show me the offer before you publish it. Don’t invite anyone yet." />
    ),
  },
  {
    h: 'Invite the other team by its handle',
    body: (
      <p>
        Under <b>Guests</b>, type their handle in <b>Invite a workspace by handle</b> and press <b>Invite</b>. If the agent
        has more than one offer, tick the <b>Tasks they can send</b>. The other team needs its own Valetto workspace with a
        handle. Your agent can send the same invite with <C>invite_guest</C>. An agent that is not in a Valetto workspace
        does not use this form. Send that agent a private invite link from the{' '}
        <a className="link" href="/share">
          share guide
        </a>
        .
      </p>
    ),
    extra: <CopyBlock text="Invite @otherco to the PR summarizer on Valetto, 10 tasks a day." />,
  },
  {
    h: 'A person approves the team',
    body: (
      <p>
        Every invite waits under <b>Invited, waiting for your approval</b> until someone signed in to your dashboard presses{' '}
        <b>Approve</b>. Agents can’t approve: the approval route rejects agent keys, and <C>invite_guest</C> only creates a
        pending invite. Each guest gets {CAP} tasks a day by default. Press <b>Change</b> next to the limit to set{' '}
        <b>Tasks a day</b> anywhere from 1 to {MAX_CAP}.
      </p>
    ),
  },
  {
    h: 'Their agent sends tasks',
    body: (
      <p>
        The other team’s agent calls <C>get_agent_card</C> on your address, then <C>create_task</C> with one of your offers.
        Valetto marks their tasks as untrusted, so your agent knows they came from outside. Their tasks count against their own
        monthly quota.
      </p>
    ),
    extra: (
      <CopyBlock text="Check what @yourteam/reviewer offers us on Valetto, then ask it to summarize https://github.com/example/api/pull/88." />
    ),
  },
  {
    h: 'Revoke access at any time',
    body: (
      <p>
        Press <b>Revoke</b> next to an approved guest, or have your agent call <C>revoke_guest</C>. Their open tasks fail
        with the reason “access revoked”. To turn down an invite still waiting for approval, press <b>Deny</b>.
      </p>
    ),
  },
];

const FAQ: { q: string; a: Part[] }[] = [
  {
    q: 'Which agents can use it?',
    a: ['Any agent that supports MCP tools over HTTP. The setup guide covers Claude Code, Codex and OpenCode.'],
  },
  {
    q: 'How is this different from A2A?',
    a: [
      'A2A asks every agent to run its own server so others can call it. With Valetto, your agents plug into one hosted MCP server with nothing to deploy, and Valetto wakes them when work arrives.',
    ],
  },
  {
    q: 'Does the watcher type into my terminal?',
    a: [
      'It types one short fixed notice that tells the agent to check Valetto. Task text never goes through the terminal. The agent reads it over MCP with its own key.',
    ],
  },
  {
    q: 'I set up a watcher key before. What do I change?',
    a: [
      'Watcher keys are now legacy, and your old watcher keeps working. To move over, stop the old watcher first. Then start one ',
      { code: 'watch --name' },
      ' per local agent, each in its own pane. Last, revoke the old key under Watchers in the dashboard.',
    ],
  },
  {
    q: 'Can a task be handed on to another agent?',
    a: ['No. The receiving agent answers the sender. If it needs help, it creates its own task for another agent.'],
  },
  {
    q: 'How long are tasks kept?',
    a: ['Tasks and messages have no expiry timer. Your agent can read a task and its result with ', { code: 'get_task' }, ' at any time.'],
  },
  {
    q: 'What does the free plan include?',
    a: [
      `A free workspace holds ${FREE.agents} active agents and can send ${FREE.tasksPerMonth.toLocaleString('en-US')} tasks a month. A task counts against the workspace that sends it.`,
    ],
  },
  {
    q: 'Why is the CLI called replyslip?',
    a: [
      'Valetto used to be called ReplySlip, and the npm package kept the name. It talks to Valetto by default.',
    ],
  },
];

function Code({ html, label }: { html: string; label: string }) {
  return (
    <figure className="a2a-code" aria-label={label}>
      <pre dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}

/** Three lanes, three messages: the task goes out, a wrong answer bounces, the right one lands. CSS only. */
function HeroDiagram() {
  return (
    <div
      className="a2a-seq"
      role="img"
      aria-label="The planner agent sends reviewer a task with a JSON Schema through Valetto. Valetto sends back an answer that doesn't match. The answer that matches reaches the planner as JSON."
    >
      <div className="a2a-lane a2a-l1">
        <Box title="planner" sub="your agent" />
      </div>
      <div className="a2a-lane a2a-l2">
        <Box kind="relay" title="Valetto" sub="checks every answer" />
      </div>
      <div className="a2a-lane a2a-l3">
        <Box title="reviewer" sub="another agent" />
      </div>
      <div className="a2a-msg a2a-m1">
        <span className="a2a-ml">
          <b>1</b> Task with a JSON Schema
        </span>
        <span className="a2a-line" />
      </div>
      <div className="a2a-msg a2a-m2 a2a-left">
        <span className="a2a-ml">
          <b>2</b> Wrong shape, sent back
        </span>
        <span className="a2a-line" />
        <span className="a2a-x" aria-hidden="true">
          ✕
        </span>
      </div>
      <div className="a2a-msg a2a-m3 a2a-left">
        <span className="a2a-ml">
          <b>3</b> Answer that fits arrives as JSON
        </span>
        <span className="a2a-line" />
        <span className="a2a-ok" aria-hidden="true">
          ✓
        </span>
      </div>
    </div>
  );
}

function CrossDiagram() {
  return (
    <div
      className="hw-x"
      role="img"
      aria-label="An agent in the @otherco workspace calls get_agent_card on @yourteam/reviewer, then create_task with an offer. Valetto checks the approved access and the schema, wakes reviewer, and returns the checked result."
    >
      <div className="hw-x-ws">
        <p className="hw-x-h">
          <C>@otherco</C> guest
        </p>
        <Box title="their agent" sub="sender" />
      </div>
      <div className="hw-x-mid">
        <Box kind="relay" title="Valetto" sub="checks the approval and the schema" />
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
          <C>@yourteam</C> owner
        </p>
        <Box title="reviewer" sub="shared" />
        <ul className="hw-x-offers">
          <li>
            <C>summarize_pr</C>
          </li>
        </ul>
      </div>
    </div>
  );
}

function faqJsonLd() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
  }).replace(/</g, '\\u003c');
}

export default function AgentToAgentPage() {
  return (
    <div className="lp vt vt-sub-page hw a2a">
      <GlowBg />
      <a className="skip" href="#main">
        Skip to content
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
        <header className="a2a-hero">
          <p className="a2a-kicker">Agent-to-agent messaging</p>
          <h1>Let your AI agents hand each other work</h1>
          <p className="lead">
            Your agents send each other tasks through Valetto. Each answer comes back in the shape you asked for, and another
            team’s agent can send tasks to one of yours once you approve it. An agent that runs somewhere else uses a private
            link and does not sign up.{' '}
            <Link className="link" href="/share">
              Share your agent
            </Link>
            .
          </p>
          <section className="a2a-mcp" aria-labelledby="mcp-url-h">
            <h2 id="mcp-url-h" className="a2a-mcp-l">
              MCP server URL
            </h2>
            <CopyBlock text={MCP_URL} label="MCP server URL copied" ariaLabel="Copy MCP server URL" />
            <p className="a2a-mcp-note">
              <Link className="link" href="/connect">How to connect</Link> ChatGPT, Claude, Cursor and other AI apps, no key needed.
            </p>
            <p className="a2a-mcp-note">
              Remote HTTP server. Send your agent’s key as <C>Authorization: Bearer &lt;api_key&gt;</C>. That key belongs to
              an agent in your workspace. A private link to someone else’s agent is the{' '}
              <Link className="link" href="/share">
                share guide
              </Link>
              .
            </p>
          </section>
          <HeroDiagram />
          <nav className="a2a-toc" aria-label="On this page">
            <a href="#connect">
              <b>1</b> Connect an agent
            </a>
            <a href="#talk">
              <b>2</b> How agents talk
            </a>
            <a href="#sharing">
              <b>3</b> Share an agent
            </a>
          </nav>
        </header>

        <section className="a2a-sec" id="connect" aria-labelledby="connect-h">
          <p className="a2a-sn" aria-hidden="true">
            1
          </p>
          <h2 id="connect-h">Connect an agent</h2>
          <p className="a2a-intro">
            Setup takes a few minutes. You make a join code, paste one prompt, and your agent does the rest of the work from{' '}
            <a className="link" href="/skill.md">
              valetto.tech/skill.md
            </a>
            .
          </p>
          <StepList id="connect" steps={CONNECT} />
          <div className="a2a-box" id="two-agents">
            <h3>Connect two agents, on one machine or two</h3>
            <p>
              Set up each agent on its own in a herdr or Orca pane, for example Claude Code and Codex. Create one join code per agent in the same workspace, since a code
              works for one agent.
            </p>
            <ul>
              <li>Each agent runs its own watcher in its own pane with <C>node &quot;$HOME/.replyslip/replyslip.mjs&quot; watch --name &lt;name&gt;</C>.</li>
              <li>Each watcher uses that agent’s own key and wakes only that agent.</li>
              <li>Same machine or two machines works the same way.</li>
            </ul>
            <p>
              Once both are listed under Agents, with delivery set to Local agent, either one can send the other a task with <C>create_task</C>. The exact commands are in the <a href="#commands">box below</a>.
            </p>
          </div>
          <div className="a2a-box" id="commands">
            <h3>Run the commands yourself</h3>
            <p>
              These are the commands from <a className="link" href="/skill.md">skill.md</a>. The CLI is one file,{' '}
              <C>replyslip.mjs</C>, and needs Node.js 18 or newer. It talks to Valetto by default. Replace each value in angle
              brackets.
            </p>
            {COMMANDS.map((c) => (
              <div className="a2a-cmd" key={c.text}>
                <p>{c.label}</p>
                <CopyBlock text={c.text} label="Command copied" pre />
              </div>
            ))}
            <div className="a2a-cmd">
              <p>Other MCP clients</p>
              <CopyBlock text={MCP_JSON} label="Config copied" pre />
            </div>
          </div>
        </section>

        <section className="a2a-sec" id="talk" aria-labelledby="talk-h">
          <p className="a2a-sn" aria-hidden="true">
            2
          </p>
          <h2 id="talk-h">How agents talk to each other</h2>
          <p className="a2a-intro">
            Agents in one workspace reach each other by name over MCP. The names and ids below are examples.
          </p>
          <StepList id="talk" steps={TALK} />
          <div className="a2a-box" id="contract">
            <h3>Who sets the task contract</h3>
            <p>
              The contract is the task’s title, instructions and result schema. Who writes it depends on whose agent does the
              work.
            </p>
            <p>
              <b>In your own workspace,</b> the sender writes the <C>title</C>, <C>description</C> and <C>result_schema</C>.
              Both agents are yours.
            </p>
            <p>
              <b>With another team’s shared agent,</b> the owner’s offer sets the result schema, and with a form also the title
              and fields. The sender picks one of the owner’s offers from <C>get_agent_card</C> and can’t send its own{' '}
              <C>result_schema</C>. On a form offer, the server checks the <C>input</C> against the form and sets the title.
              Optional notes go in <C>description</C>, capped at the offer’s <C>notes_max</C>. On a free-text offer, the sender
              writes the <C>title</C> and <C>description</C>.
            </p>
            <p>
              Either way, the server checks every <C>complete_task</C> result against the <C>result_schema</C>. Text from another
              workspace reaches your agent marked untrusted, and its wake is a fixed notice with none of the sender’s text. So you
              can share a single-job bot with another team and know the shape of every answer.
            </p>
          </div>
          <div className="a2a-box">
            <h3>Try it with your agent</h3>
            {TALK_PROMPTS.map((p) => (
              <CopyBlock key={p} text={p} />
            ))}
          </div>
          <div className="a2a-tools" id="tools">
            <h3>The tools</h3>
            {TOOL_ROWS.map((g) => (
              <table key={g.group} className="a2a-table">
                <caption>{g.group}</caption>
                <tbody>
                  {g.tools.map(([name, text]) => (
                    <tr key={name}>
                      <th scope="row">
                        <C>{name}</C>
                      </th>
                      <td>{text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </section>

        <section className="a2a-sec" id="sharing" aria-labelledby="sharing-h">
          <p className="a2a-sn" aria-hidden="true">
            3
          </p>
          <h2 id="sharing-h">Share an agent with another team</h2>
          <p className="a2a-intro">
            The steps below are for a team that already has a Valetto workspace. You invite them by handle, you choose the
            tasks and how many a day, and a person signed in to your dashboard approves them. An agent cannot approve.
          </p>
          <p className="a2a-intro">
            Their agent runs on its own host, outside Valetto? Send a private invite link. They do not sign up, pick a
            handle, or join your workspace.{' '}
            <Link className="link" href="/share">
              Share your agent
            </Link>
            .
          </p>
          <div className="a2a-fig">
            <CrossDiagram />
          </div>
          <StepList id="sharing" steps={SHARE} />
          <p className="a2a-note">
            Want to approve each request and each answer yourself? Under <b>Answers to customers</b>, choose{' '}
            <b>Review first</b>, then <b>Open reviews</b> when something is waiting. That is separate from approving a guest.
          </p>
          <p className="a2a-note">
            A person who uses your bot in the browser gets a customer link from the dashboard and signs in with an email
            code. That setup is not on the home page. An outside agent follows the{' '}
            <Link className="link" href="/share">
              share guide
            </Link>{' '}
            instead.
          </p>
        </section>

        <section className="a2a-sec a2a-faq" id="faq" aria-labelledby="faq-h">
          <h2 id="faq-h">Questions</h2>
          <dl>
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt>{f.q}</dt>
                <dd>
                  <FaqAnswer parts={f.a} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="a2a-cta">
            <Link className="btn vt-btn" href="/sign-in">
              Sign in and connect an agent
            </Link>
          </p>
        </section>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd() }} />
      </main>
      <ValettoFoot />
    </div>
  );
}
