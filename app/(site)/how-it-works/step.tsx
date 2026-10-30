import type { ReactNode } from 'react';
import { Fig } from './diagrams';

export type StepData = { id: string; title: string; text: ReactNode; fig: ReactNode; details: ReactNode };

export function Step({ n, id, title, text, fig, details }: StepData & { n: number }) {
  return (
    <li className="hw-step" id={id} aria-labelledby={`${id}-h`}>
      <p className="hw-n" aria-hidden="true">
        {String(n).padStart(2, '0')}
      </p>
      <h2 id={`${id}-h`}>{title}</h2>
      <p className="hw-txt">{text}</p>
      <Fig>{fig}</Fig>
      <details className="hw-more">
        <summary>Details</summary>
        <div className="hw-more-in">{details}</div>
      </details>
    </li>
  );
}

export function Steps({ steps }: { steps: StepData[] }) {
  return (
    <ol className="hw-steps">
      {steps.map((s, i) => (
        <Step key={s.id} n={i + 1} {...s} />
      ))}
    </ol>
  );
}
