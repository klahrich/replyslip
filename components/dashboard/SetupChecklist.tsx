import type { Agent, JoinCode } from './types';

type Step = { label: string; done: boolean; note?: string; href?: string; link?: string };

/** Three setup steps, worked out from data the dashboard already loads. Hidden once all are done. */
export function SetupChecklist({ handle, agents, codes }: { handle: string | null; agents: Agent[]; codes: JoinCode[] }) {
  const live = agents.filter((a) => !a.revoked_at);
  const waiting = codes.some((c) => c.status === 'pending');
  const steps: Step[] = [
    { label: 'Set your workspace handle', done: !!handle, href: handle ? undefined : '#sharing', link: 'Sharing' },
    {
      label: 'Create a join code and have an agent join',
      done: live.length > 0,
      note: live.length > 0 ? undefined : waiting ? 'A code is waiting for an agent.' : undefined,
      href: live.length > 0 ? undefined : '#connect',
      link: 'Connect an agent',
    },
    {
      label: 'Share an agent',
      done: live.some((a) => a.shared),
      note: live.length > 0 ? 'Turn sharing on for an agent.' : 'Do this once an agent has joined.',
      href: live.length > 0 ? '#sharing' : undefined,
      link: 'Sharing',
    },
  ];
  // The share note only matters while that step is open.
  if (steps[2].done) steps[2].note = steps[2].href = undefined;

  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <section className="dash-card dash-setup" aria-labelledby="setup-h">
      <h2 id="setup-h">Set up</h2>
      <p className="dash-muted">
        {done} of {steps.length} done
      </p>
      <ol className="dash-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'is-done' : undefined}>
            <span className="dash-step-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span>
              <span className="dash-step-label">{s.label}</span>
              <span className="vh">{s.done ? ' (done)' : ' (not done)'}</span>
              {s.note || s.href ? (
                <span className="dash-muted dash-step-note">
                  {s.note}
                  {s.note && s.href ? ' ' : ''}
                  {s.href ? (
                    <a className="link" href={s.href}>
                      {s.link}
                    </a>
                  ) : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
