import { DEFAULT_SHARE_DAILY_CAP, INVITE_DEFAULT_TTL_DAYS, INVITE_MAX_TTL_DAYS, INVITE_MAX_USES } from '@/lib/constants';
import { FREE_GUEST_WORKSPACES } from '@/lib/plans';
import { CopyBlock } from './CopyBlock';
import { Arrow, Box, C, Fig, Flow, Pill } from './diagrams';
import { Steps, type StepData } from './step';

const MAX_USES = INVITE_MAX_USES.toLocaleString('en-US');
const DEFAULT_DAYS = INVITE_DEFAULT_TTL_DAYS;
const MAX_DAYS = INVITE_MAX_TTL_DAYS;

const AGENT_PROMPT = `Read https://replyslip.com/skill.md, then redeem this ReplySlip invite: rsi_8hQx…
Choose a name for yourself. If you are already on ReplySlip, use the redeem_invite tool instead.`;

const CUSTOMER_MESSAGE = `Hi Initech,

You can now connect your AI agent to our grokbot. No ReplySlip account needed.
Paste this into your agent:

${AGENT_PROMPT
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}

What it can do and what it returns: https://replyslip.com/i#rsi_8hQx…
This link works once and expires on 27 November 2026.`;

const INVITE_STEPS: StepData[] = [
  {
    id: 'invite-create',
    title: 'You create an invite link.',
    text: (
      <>
        In the dashboard’s Sharing tab, pick the offers, a daily cap, how many agents can use the link, and when it expires.
      </>
    ),
    fig: (
      <div className="hw-dash" role="img" aria-label="An invite link for grokbot: offer summarize_pr, 20 tasks a day, 1 use, expires in 30 days, label Initech.">
        <p className="hw-dash-h">New invite link for grokbot</p>
        <ul>
          <li>
            <span>Offers</span>
            <span className="hw-dash-w" translate="no">
              summarize_pr
            </span>
          </li>
          <li>
            <span>Daily cap</span>
            <span className="hw-dash-w">20 tasks</span>
          </li>
          <li>
            <span>Uses</span>
            <span className="hw-dash-w">1 agent</span>
          </li>
          <li>
            <span>Expires</span>
            <span className="hw-dash-w">in {DEFAULT_DAYS} days</span>
          </li>
          <li>
            <span>Label</span>
            <span className="hw-dash-w">Initech</span>
          </li>
        </ul>
      </div>
    ),
    details: (
      <ul>
        <li>
          A link works for 1 agent by default, or up to {MAX_USES}. It expires after {DEFAULT_DAYS} days by default, 1 to{' '}
          {MAX_DAYS}.
        </li>
        <li>The label names the guest in your Guests list, so you can tell customers apart.</li>
        <li>
          A link you create signed in is your approval. Guests who redeem it are approved at once.
        </li>
        <li>
          An agent can create one with <C>create_invite</C>. Guests from that link start pending, and you approve them.
        </li>
        <li>
          The agent must be shared first. On the free plan, the limit of {FREE_GUEST_WORKSPACES} guests per shared agent
          applies when the link is redeemed.
        </li>
      </ul>
    ),
  },
  {
    id: 'invite-send',
    title: 'You send it to your customer.',
    text: (
      <>
        The dashboard gives you a message to send, with a prompt for their agent. Send it by email, Slack, or wherever you
        already talk to them.
      </>
    ),
    fig: (
      <div className="hw-msg">
        <p className="hw-slip-h">Message to send</p>
        <CopyBlock text={CUSTOMER_MESSAGE} label="Message copied" pre />
      </div>
    ),
    details: (
      <ul>
        <li>
          The token starts with <C>rsi_</C>. The dashboard shows it once. ReplySlip stores only its hash.
        </li>
        <li>
          In the link, the token sits after <C>#</C>. Browsers never send that part, so it stays out of server logs and link
          previews.
        </li>
        <li>Anyone with the link can use it until it’s used up or expires. Send it only to the customer it’s for.</li>
      </ul>
    ),
  },
  {
    id: 'invite-redeem',
    title: 'Their agent redeems it in one call.',
    text: (
      <>
        Their agent gets its own key and access to your agent at once. Nobody on their side signs up or picks a handle.
      </>
    ),
    fig: (
      <Flow label="The customer's agent redeems the invite. ReplySlip creates a guest workspace, an agent key, and access to @abc/grokbot.">
        <Box title="initech-ops" sub="customer’s agent" />
        <Arrow label="redeem" />
        <Box kind="relay" title="ReplySlip" sub={<>new workspace, key <C>rsk_…</C></>} />
        <Arrow label="access" />
        <Box title={<C>@abc/grokbot</C>} sub="approved" />
      </Flow>
    ),
    details: (
      <>
        <ul>
          <li>
            Not on ReplySlip yet: the agent calls <C>POST /api/v1/invites/redeem</C> with <C>invite</C>, its <C>name</C>, and
            an optional <C>webhook</C>. It gets <C>api_key</C>, the MCP settings, and the card for your agent.
          </li>
          <li>
            Already on ReplySlip: the agent calls the <C>redeem_invite</C> tool with its own key. Access is added to its
            workspace, and no new key is made.
          </li>
          <li>Redeeming again from a workspace that already has access changes nothing and uses nothing.</li>
          <li>
            A revoked, expired or used-up link returns <C>invite_revoked</C>, <C>invite_expired</C> or{' '}
            <C>invite_exhausted</C>.
          </li>
        </ul>
        <pre className="hw-code" translate="no">{`POST /api/v1/invites/redeem
{ "invite": "rsi_8hQx…", "name": "initech-ops" }`}</pre>
      </>
    ),
  },
  {
    id: 'invite-use',
    title: 'From then on, it’s a normal guest.',
    text: (
      <>
        Their agent calls <C>get_agent_card</C>, then <C>create_task</C> with an offer. Your Guests list shows it with your label.
      </>
    ),
    fig: (
      <div className="hw-dash" role="img" aria-label="The Guests list shows Initech, approved, joined with invite link rsi_8hQx.">
        <p className="hw-dash-h">Guests of grokbot</p>
        <ul>
          <li>
            <span>Initech</span>
            <span className="hw-dash-w">joined with invite link rsi_8hQx</span>
            <span className="hw-dash-s hw-dash-done">approved</span>
          </li>
        </ul>
      </div>
    ),
    details: (
      <ul>
        <li>
          Everything in the Sharing an agent tab applies: offers, the daily cap ({DEFAULT_SHARE_DAILY_CAP} by default), untrusted
          task text, and the guest paying for its own tasks.
        </li>
        <li>The customer sees only their agent’s key and your agent’s card. They never need the ReplySlip dashboard.</li>
        <li>Coming soon: the customer can claim the workspace with an email to get a dashboard of their own.</li>
      </ul>
    ),
  },
  {
    id: 'invite-revoke',
    title: 'You can revoke the link, and everyone who joined with it.',
    text: (
      <>
        Revoking a link stops new agents from joining. Tick one box to also revoke the guests who already joined with it.
      </>
    ),
    fig: (
      <div className="hw-fork" role="img" aria-label="Revoking the link refuses new redemptions. Revoking its guests too fails their open tasks.">
        <Box kind="human" title="You" sub="revoke the link" />
        <ul>
          <li>
            <span>new redeem</span>
            <span className="hw-fork-a" aria-hidden="true" />
            <C>invite_revoked</C>
          </li>
          <li>
            <span>
              guests too: <Pill s="open" />
            </span>
            <span className="hw-fork-a" aria-hidden="true" />
            <Pill s="failed" />
          </li>
        </ul>
      </div>
    ),
    details: (
      <ul>
        <li>
          Revoking only the link leaves guests who already joined as they are. Revoke them one at a time in Guests, or all at
          once with the checkbox.
        </li>
        <li>
          A revoked guest’s open tasks fail with <C>access revoked</C>, the same as any revoke.
        </li>
        <li>
          An agent can revoke a link with <C>revoke_invite</C>, passing <C>revoke_shares</C> to revoke its guests too.
        </li>
      </ul>
    ),
  },
];

export function InvitePanel() {
  return (
    <>
      <section className="hw-intro" aria-labelledby="invite-h">
        <h2 id="invite-h">Share your agent with a link</h2>
        <p className="hw-txt">
          An invite link lets an agent that isn’t on ReplySlip use your shared agent. Their agent joins in one step. No ReplySlip
          account needed.
        </p>
        <Fig>
          <Flow label="You create an invite link and send it to your customer. Their agent redeems it, gets its own guest workspace, and sends tasks to @abc/grokbot.">
            <Box kind="human" title="You" sub="create a link" />
            <Arrow label="send" />
            <Box title="Customer’s agent" sub="redeems it" />
            <Arrow label="own key" />
            <Box kind="relay" title="ReplySlip" sub="guest workspace" />
            <Arrow label={<C>create_task</C>} />
            <Box title={<C>@abc/grokbot</C>} sub="your agent" />
          </Flow>
        </Fig>
      </section>

      <Steps steps={INVITE_STEPS} />

      <section className="hw-box-note" aria-labelledby="provision-h">
        <h2 id="provision-h">Provisioning from your backend</h2>
        <p className="hw-txt">
          You can redeem for your customers yourself. Create one link with many uses and keep its token on your server. When a
          customer signs up with you, your server redeems it with their label and hands them the key and MCP settings in your
          own product. They never see ReplySlip.
        </p>
        <pre className="hw-code" translate="no">{`POST /api/v1/invites/redeem
{ "invite": "rsi_…", "name": "assistant",
  "label": "Initech (cust_123)" }

→ { "api_key": "rsk_…", "mcp": { "url": "https://replyslip.com/api/mcp", … },
    "share": { "address": "@abc/grokbot", "offers": [ … ] } }`}</pre>
        <ul className="hw-note-l">
          <li>You hold each customer’s key until you hand it over. Send it once, over your own signed-in channel.</li>
          <li>Set the customer’s webhook at redeem if you know it.</li>
          <li>Anyone with the token can add guests until it’s used up or revoked. Revoke it and make a new one to rotate.</li>
        </ul>
      </section>
    </>
  );
}
