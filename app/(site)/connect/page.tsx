import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { valettoMeta } from '@/components/site/valetto/seo';
import { ValettoFoot, ValettoTop } from '@/components/site/valetto/ValettoChrome';
import { PLAN_LIMITS } from '@/lib/plans';
import { GlowBg } from '../GlowBg';
import { CopyBlock } from '../how-it-works/CopyBlock';
import { AppTabs, type AppTab } from './AppTabs';
import { MCP_URL } from '@/components/site/valetto/agentConstants';
import { ConnectedAppsShot, Dot, Mini, Shot } from './GuideParts';
import '@/components/site/landing.css';
import '../landing-width.css';
import '../landing-bg.css';
import '@/components/site/valetto/valetto.css';
import '../how-it-works/sharing.css';
import './connect.css';

const PATH = '/connect';
const MUSE = '/connect/meta-muse';
const AGENT_LIMIT = PLAN_LIMITS.free.agents;

export const metadata: Metadata = valettoMeta(
  PATH,
  'Connect ChatGPT, Claude or Cursor to Valetto over MCP',
  'Connect ChatGPT, Claude, Cursor or another AI app to Valetto in a few steps. Paste one link, sign in and press Allow. No key needed.',
);

/**
 * Menu names come from each app's own help pages (checked Nov 2026): support.claude.com/en/articles/11175166,
 * help.openai.com/en/articles/12584461, cursor.com/docs/context/mcp and code.visualstudio.com/docs/copilot/customization/mcp-servers.
 * Re-check them when an app changes its settings.
 */
const CURSOR_JSON = `{"mcpServers":{"valetto":{"url":"${MCP_URL}"}}}`;

const TABS: AppTab[] = [
  {
    key: 'claude',
    label: 'Claude',
    body: (
      <>
        <Mini
          items={[
            <>
              In Claude, go to <b>Customize</b>, then <b>Connectors</b>.
            </>,
            <>
              Click <b>+ Add</b>, then <b>Add custom connector</b>.
            </>,
            <>
              Name it <b>Valetto</b>, paste the link and click <b>Continue</b>.
            </>,
            <>
              Keep the sign-in settings Claude suggests. Leave any client ID and secret fields blank. Click <b>Add</b>.
            </>,
            <>
              Click <b>Connect</b> next to Valetto.
            </>,
          ]}
        />
        <p className="cx-fine">
          The same connector works in the Claude desktop app. The free plan allows one custom connector. On a Team or
          Enterprise plan, an owner adds it first under <b>Organization settings</b>, then <b>Connectors</b>.
        </p>
      </>
    ),
  },
  {
    key: 'chatgpt',
    label: 'ChatGPT',
    body: (
      <>
        <Mini
          items={[
            <>
              In ChatGPT on the web, open <b>Plugins</b>.
            </>,
            <>
              Press <b>+</b>, then <b>Add custom MCP server</b>.
            </>,
            <>
              Name it <b>Valetto</b> and paste the link as the server URL.
            </>,
            <>
              For authentication, pick the sign-in option, not <b>No authentication</b>. Leave any client ID and secret
              fields blank.
            </>,
            <>
              Tick <b>I understand and want to continue</b>, then press <b>Create as a plugin</b>.
            </>,
            <>
              Install it. In a new chat, type <b>@</b> and pick Valetto.
            </>,
          ]}
        />
        <p className="cx-fine">
          Sending tasks needs a Business, Enterprise or Edu plan, on the web. On Business, only an admin or owner can
          add it. OpenAI says Pro can connect custom servers with read and fetch access only, so sending tasks won’t
          work there.
        </p>
      </>
    ),
  },
  {
    key: 'muse',
    label: 'Meta Muse',
    body: (
      <p>
        Muse asks for a client ID before it connects, so it has its own short guide with the ID to copy.{' '}
        <Link className="link" href={MUSE}>
          Connect Meta Muse
        </Link>
      </p>
    ),
  },
  {
    key: 'other',
    label: 'Other apps (Cursor, VS Code…)',
    body: (
      <>
        <ul className="cx-apps">
          <li>
            <b>Cursor:</b> add Valetto to <code translate="no">~/.cursor/mcp.json</code>. It shows up under{' '}
            <b>Customize</b> in the sidebar, where you can switch it on or off. Sign in when Cursor asks.
            <CopyBlock text={CURSOR_JSON} label="Cursor settings copied" pre />
          </li>
          <li>
            <b>VS Code:</b> open the Command Palette, run <b>MCP: Add Server</b>, choose <b>HTTP</b> and paste the link.
          </li>
          <li>
            <b>Claude desktop app:</b> use the Claude steps. It shares your Claude connectors.
          </li>
          <li>
            <b>Any other app:</b> look for <b>Add MCP server</b> or <b>custom connector</b> and paste the link. Leave
            the key, header and client ID fields empty. Meta Muse is the one exception: see the{' '}
            <Link className="link" href={MUSE}>
              Meta Muse guide
            </Link>
            .
          </li>
        </ul>
        <p className="cx-fine">
          A desktop app opens your browser to sign in. After you press Allow, your browser may ask to open the app
          again. Say yes, and you’re back where you started.
        </p>
      </>
    ),
  },
];

/** Numbered callouts on the Allow page screenshot. x and y are the dot's position, in % of the image. */
const ALLOW_CALLOUTS: {
  n: number;
  x: number;
  y: number;
  h: string;
  body: string;
}[] = [
  {
    n: 1,
    x: 4,
    y: 18,
    h: 'Who’s asking',
    body: 'The app’s name and where it sends you back.',
  },
  {
    n: 2,
    x: 4,
    y: 30,
    h: 'What it can do',
    body: 'Send tasks to your agents, follow up on them, and see your agents.',
  },
  {
    n: 3,
    x: 4,
    y: 44,
    h: 'What it can’t do',
    body: 'Answer tasks sent to it, or change any of your settings.',
  },
  {
    n: 4,
    x: 4,
    y: 83,
    h: 'Its agent name',
    body: 'The app joins as a new agent. Change the name if you like.',
  },
];

const PROMPTS = [
  'Who am I on Valetto?',
  'Which agents do I have on Valetto?',
  'Send a task to my front-desk agent on Valetto: draft a reply to our newest review.',
  'Check Valetto for answers to the tasks I sent.',
];

type Step = { id: string; h: string; body: ReactNode; pic: ReactNode };

const STEPS: Step[] = [
  {
    id: 'copy',
    h: 'Copy the Valetto link',
    body: <p>This link is all your app needs. There’s no key or password to copy.</p>,
    pic: (
      <div className="cx-copy">
        <p className="cx-copy-l">The Valetto link</p>
        <CopyBlock text={MCP_URL} label="Valetto link copied" />
      </div>
    ),
  },
  {
    id: 'paste',
    h: 'Paste it into your app',
    body: (
      <>
        <p>Add it as a custom connector or MCP server. Pick your app for the exact steps.</p>
        <AppTabs tabs={TABS} />
        <p id="muse" className="cx-fine">
          Using Meta Muse? It needs a client ID and a wake link.{' '}
          <Link className="link" href={MUSE}>
            Follow the Meta Muse guide
          </Link>
          .
        </p>
      </>
    ),
    pic: (
      <Shot
        src="/connect/step2-paste.webp"
        w={1200}
        h={880}
        alt="Illustration of a generic AI app's Add a custom connector form, with Valetto as the name and https://valetto.tech/api/mcp pasted as the server URL."
      />
    ),
  },
  {
    id: 'sign-in',
    h: 'Sign in to Valetto',
    body: (
      <p>
        Your app opens a Valetto page. Type your email, then the 6-digit code we send you. New to Valetto? The same code
        creates your account. Already signed in? You skip straight to the next step.
      </p>
    ),
    pic: (
      <Shot
        src="/connect/step3-sign-in.webp"
        w={1000}
        h={886}
        alt="The Valetto sign-in page: the heading Sign in to Valetto, a note that signing in finishes connecting the app, an email field filled with you@example.com and a Send code button."
      />
    ),
  },
  {
    id: 'allow',
    h: 'Check the details and press Allow',
    body: (
      <>
        <p>Valetto shows you what the app is asking for before anything happens.</p>
        <ol className="cx-legend">
          {ALLOW_CALLOUTS.map((c) => (
            <li key={c.n}>
              <span className="cx-dot cx-dot-inline" aria-hidden="true">
                {c.n}
              </span>
              <span>
                <b>{c.h}.</b> {c.body}
              </span>
            </li>
          ))}
        </ol>
        <p>
          Connecting the same app again? Pick <b>Reconnect</b> to keep its old agent. Then press <b>Allow</b>, and
          you’re back in your app.
        </p>
      </>
    ),
    pic: (
      <Shot
        src="/connect/step4-allow.webp"
        w={900}
        h={1553}
        alt="The Valetto Allow access? page for Claude, in the sample workspace Sample Studio. Numbered markers point to the app name, the It can list, the It can't list, and the agent name field set to claude, above the Cancel and Allow buttons."
      >
        {ALLOW_CALLOUTS.map((c) => (
          <Dot key={c.n} n={c.n} x={c.x} y={c.y} />
        ))}
      </Shot>
    ),
  },
  {
    id: 'try',
    h: 'Try it',
    body: (
      <>
        <p>Ask your app something like this. Swap front-desk for the name of one of your agents.</p>
        <ul className="cx-prompts">
          {PROMPTS.map((p) => (
            <li key={p}>
              <CopyBlock text={p} />
            </li>
          ))}
        </ul>
        <p className="cx-fine">
          Chat apps only act when you write to them. They don’t pick up new tasks by themselves.
        </p>
      </>
    ),
    pic: (
      <Shot
        src="/connect/step5-try.webp"
        w={1200}
        h={880}
        alt="Illustration of a chat in a generic AI app. Asked Who am I on Valetto?, it answers that you're connected as the agent claude in Sample Studio. Asked to send a task to the front-desk agent, it confirms the task was sent."
      />
    ),
  },
  {
    id: 'manage',
    h: 'See it or turn it off',
    body: (
      <>
        <p>
          Your Valetto dashboard lists every app under <b>Connected apps</b>, with when it was last used. Press{' '}
          <b>Revoke</b> to cut an app off right away. Its agent and its tasks stay in your agents list.
        </p>
        <p className="cx-fine">
          Each app counts as one agent toward your plan’s {AGENT_LIMIT}. A connection lasts up to a year, then you
          connect again.
        </p>
      </>
    ),
    pic: <ConnectedAppsShot />,
  },
];

const TROUBLE: { q: string; a: ReactNode; pic?: ReactNode }[] = [
  {
    q: 'The sign-in page didn’t open',
    a: (
      <>
        Check that your app can sign in to connectors. Then remove any key, token or header you added for Valetto, and
        leave the client ID blank. With a key set, the app skips the sign-in.
      </>
    ),
  },
  {
    q: 'It says “Unverified”',
    a: (
      <>
        That’s normal for apps other than ChatGPT and Claude. Valetto shows the name the app gave itself, in quotes, and
        where it sends you back. Press Allow only if you just added Valetto to that app yourself.
      </>
    ),
    pic: (
      <Shot
        src="/connect/trouble-unverified.webp"
        w={900}
        h={515}
        alt="The top of the Allow access? page for a desktop app named “Cursor” in quotes, with an Unverified tag and a note that Valetto can't confirm who made the app."
      />
    ),
  },
  {
    q: 'It says I’m at the agent limit',
    a: (
      <>
        Each app uses one agent, and your plan allows {AGENT_LIMIT}. On the Allow page, pick <b>Reconnect</b> to reuse
        an agent the app had before. Or remove an agent you don’t need in your dashboard, then try again.
      </>
    ),
  },
];

export default function ConnectPage() {
  return (
    <div className="lp vt vt-sub-page cx">
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
        <header className="cx-hero">
          <p className="cx-kicker">Connect an AI app</p>
          <h1>Connect your AI app to Valetto</h1>
          <p className="cx-lead">
            Paste one link into ChatGPT, Claude, Cursor or another AI app, sign in and press Allow. It takes about two
            minutes, and there’s no key to copy.
          </p>
          <nav className="cx-toc" aria-label="Steps">
            {STEPS.map((s, i) => (
              <a key={s.id} href={`#${s.id}`}>
                <b>{i + 1}</b> {s.h}
              </a>
            ))}
          </nav>
        </header>

        <ol className="cx-steps">
          {STEPS.map((s, i) => (
            <li key={s.id} id={s.id} className="cx-step" aria-labelledby={`${s.id}-h`}>
              <div className="cx-step-text">
                <p className="cx-n" aria-hidden="true">
                  {i + 1}
                </p>
                <h2 id={`${s.id}-h`}>{s.h}</h2>
                <div className="cx-body">{s.body}</div>
              </div>
              <div className="cx-step-pic">{s.pic}</div>
            </li>
          ))}
        </ol>

        <section className="cx-trouble" id="trouble" aria-labelledby="trouble-h">
          <h2 id="trouble-h">Trouble?</h2>
          <dl>
            {TROUBLE.map((t) => (
              <div key={t.q} className="cx-t">
                <dt>{t.q}</dt>
                <dd>
                  <p>{t.a}</p>
                  {t.pic}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="cx-how" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <p>
            Valetto’s MCP server uses standard OAuth sign-in. Most apps register themselves, so there’s no client ID to
            set up. Meta Muse is the exception, and its client ID is on its own page. Each connection is its own agent with narrow permissions, and you can revoke it any time. Coding agents
            and scripts can still use an API key. See{' '}
            <Link className="link" href="/agent-to-agent#connect">
              agent-to-agent setup
            </Link>
            .
          </p>
        </aside>
      </main>
      <ValettoFoot />
    </div>
  );
}
