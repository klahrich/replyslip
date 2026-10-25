import { MarkIcon } from '@/components/site/Mark';
import './hero-flow.css';

/**
 * Hero visual: Claude Code on a laptop sends a task through ReplySlip to a hosted bot, and the checked reply slip
 * comes back through ReplySlip. Drawn on the same paper slip card the demo uses. Purely illustrative, so it is a
 * single labelled image to assistive tech. The only motion is CSS and the resting frame is the final state.
 */
export function HeroFlow() {
  return (
    <figure
      className="slip flow"
      role="img"
      aria-label="Claude Code on your laptop sends a task through ReplySlip to a hosted bot in the cloud and gets back a checked reply slip"
    >
      <div className="flow-row">
        <span className="flow-label">
          <span className="flow-tag">Task ·</span> Review the signup migration
        </span>
        <Agent name="Claude Code" where="your laptop" area="a" />
        <span className="flow-go flow-go-a">
          <span className="flow-dot" />
          <Head />
        </span>
        <div className="flow-node flow-hub">
          <span className="flow-name">
            <MarkIcon size={22} />
            ReplySlip
          </span>
          <span className="flow-where">checks the reply</span>
        </div>
        <span className="flow-go flow-go-b">
          <span className="flow-dot" />
          <Head />
        </span>
        <Agent name="Hosted bot" where="the cloud" area="b" />
      </div>
      <div className="flow-back">
        <svg className="flow-up" viewBox="0 0 10 8" aria-hidden="true">
          <path d="M5 0L10 8H0Z" />
        </svg>
        <div className="flow-reply">
          <svg className="flow-left" viewBox="0 0 8 10" aria-hidden="true">
            <path d="M8 0L0 5L8 10Z" />
          </svg>
          <div className="flow-reply-head">
            <svg className="flow-check" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="8" />
              <path d="M4.6 8.3l2.2 2.2 4.6-4.8" />
            </svg>
            <span>
              <b>Reply slip</b> · checked
            </span>
          </div>
          <div className="flow-tear" />
          <code translate="no">
            {'{'}
            <span className="k">&quot;verdict&quot;</span>: <span className="s">&quot;approve&quot;</span>
            {'}'}
          </code>
        </div>
      </div>
    </figure>
  );
}

function Head() {
  return (
    <svg className="flow-head" viewBox="0 0 8 10" aria-hidden="true">
      <path d="M0 0L8 5L0 10Z" />
    </svg>
  );
}

function Agent({ name, where, area }: { name: string; where: string; area: string }) {
  return (
    <div className={`flow-node flow-agent flow-${area}`}>
      <span className="flow-name">
        <i className="flow-sq" />
        {name}
      </span>
      <span className="flow-where">{where}</span>
    </div>
  );
}
