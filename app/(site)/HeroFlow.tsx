import './hero-flow.css';

/**
 * Hero visual: a local agent on one end, a hosted bot on the other. The task goes out
 * along the top line and its checked reply slip comes back along the bottom one.
 * Purely illustrative, so it is a single labelled image to assistive tech. The only
 * motion is CSS and the resting frame is the final state.
 */
export function HeroFlow() {
  return (
    <figure
      className="flow"
      role="img"
      aria-label="Claude Code on your laptop sends a task to a hosted bot in the cloud and gets back a checked reply slip"
    >
      <div className="flow-mid">
        <Agent name="Claude Code" where="your laptop" />
        <div className="flow-task">
          <span className="flow-label">Review the signup migration</span>
          <span className="flow-line">
            <span className="flow-dot" />
            <svg className="flow-head" viewBox="0 0 8 10" aria-hidden="true">
              <path d="M0 0L8 5L0 10Z" />
            </svg>
          </span>
        </div>
        <Agent name="Hosted bot" where="the cloud" />
      </div>
      <div className="flow-back">
        <svg className="flow-up" viewBox="0 0 10 8" aria-hidden="true">
          <path d="M5 0L10 8H0Z" />
        </svg>
        <div className="flow-slip">
          <svg className="flow-left" viewBox="0 0 8 10" aria-hidden="true">
            <path d="M8 0L0 5L8 10Z" />
          </svg>
          <div className="flow-slip-head">
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

function Agent({ name, where }: { name: string; where: string }) {
  return (
    <div className="flow-agent">
      <span className="flow-name">{name}</span>
      <span className="flow-where">{where}</span>
    </div>
  );
}
