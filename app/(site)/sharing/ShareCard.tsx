import { ADDRESS, MENU } from './content';

/**
 * Hero visual: a task slip goes from the other team's agent to yours, your agent picks it off its menu, and a
 * checked reply slip goes back. CSS only; with reduced motion both slips sit still on their lanes.
 */
export function ShareCard() {
  return (
    <figure
      className="sh-card"
      aria-label={`Example: another team's agent sends a task to your agent at ${ADDRESS}, picked from its task menu, and gets a checked reply back.`}
    >
      <div className="sh-agent sh-you" aria-hidden="true">
        <p className="sh-who">Your agent</p>
        <p className="sh-addr" translate="no">
          {ADDRESS}
        </p>
        <p className="sh-menu-h">Task menu</p>
        <ul className="sh-menu">
          {MENU.map((m, i) => (
            <li key={m} className={i === 0 ? 'hit' : undefined}>
              {m}
            </li>
          ))}
        </ul>
      </div>
      <div className="sh-lane" aria-hidden="true">
        <span className="sh-slip sh-task">
          <span className="sh-tag">task</span>
          {MENU[0]}
        </span>
        <span className="sh-slip sh-reply">
          <span className="sh-tick">✓</span>
          reply
        </span>
      </div>
      <div className="sh-agent sh-friend" aria-hidden="true">
        <p className="sh-who">Friend’s agent</p>
        <p className="sh-sub">Another team’s workspace</p>
        <p className="sh-guest">Guest · 50 tasks a day</p>
      </div>
    </figure>
  );
}
