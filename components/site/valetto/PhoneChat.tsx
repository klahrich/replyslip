'use client';
/**
 * Hero visual for the Valetto preview: a customer's private page on a phone, for three example businesses.
 * Each scene plays once (tap a job, fill its form, send, "working on it", the answer), then the next card swipes in.
 * The progress fill on the active dot is the scene timer: its animationend moves the deck on, so pausing the page's
 * animations pauses the rotation too. With reduced motion the phone rests on scene 1's answer; the dots still switch.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MarkIcon } from '../Mark';

/** The owner's branding: a main colour and an optional accent (falls back to the main colour). */
type Brand = { name: string; main: string; accent?: string; logo: ReactNode };
type Field = { label: string; value: string; kind?: 'pick' | 'num'; optional?: boolean };
type Scene = {
  label: string;
  brand: Brand;
  customer: string;
  link: string;
  jobs: [string, string];
  /** Form rows; a nested pair renders side by side. */
  fields: (Field | [Field, Field])[];
  summary: string;
  working: string;
  answer: ReactNode;
};

const SCENES: Scene[] = [
  {
    label: 'Ring render',
    brand: {
      name: 'Acme Jewellers',
      main: '#6e1f3f',
      accent: '#c9962e',
      logo: (
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M7 4h10l3 4-8 12L4 8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M4 8h16M9.5 4 12 20M14.5 4 12 20" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      ),
    },
    customer: 'Maya',
    link: 'k7Qm2xR9vTb4',
    jobs: ['Render my ring', 'Check order status'],
    fields: [
      { label: 'Metal', value: '18k yellow gold', kind: 'pick' },
      { label: 'Stone', value: 'Oval sapphire', kind: 'pick' },
      { label: 'Ring size', value: '6.5', kind: 'num' },
      { label: 'Notes', value: 'Thin band', optional: true },
    ],
    summary: '18k yellow gold · Oval sapphire · Size 6.5 · Thin band',
    working: 'Working on it. We’ll email you too.',
    answer: (
      <div className="vt-b vt-bot vt-ans vt-ans-img">
        <RingRender />
        <p>Here’s your ring: oval sapphire on a 1.8 mm yellow gold band.</p>
      </div>
    ),
  },
  {
    label: 'Window quote',
    brand: {
      name: 'Northline Windows',
      main: '#1d4e89',
      accent: '#e8a33d',
      logo: (
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="5" y="4" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 4v16M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
    },
    customer: 'Dan',
    link: 'p3Lw8sN2qHe6',
    jobs: ['Get a window quote', 'Book a measuring visit'],
    fields: [
      { label: 'Window type', value: 'Casement', kind: 'pick' },
      [
        { label: 'Width (in)', value: '36', kind: 'num' },
        { label: 'Height (in)', value: '48', kind: 'num' },
      ],
      { label: 'Frame', value: 'White vinyl', kind: 'pick' },
      { label: 'Quantity', value: '4', kind: 'num' },
    ],
    summary: 'Casement · 36 × 48 in · White vinyl · 4 windows',
    working: 'Working on it.',
    answer: (
      <div className="vt-b vt-bot vt-ans vt-card">
        <span className="vt-tag">Estimate</span>
        <b className="vt-card-h">4 casement windows</b>
        <span className="vt-card-s">36 × 48 in · White vinyl · Double pane</span>
        <span className="vt-price">$3,100 to $3,600</span>
        <span className="vt-card-s">Supply and install. We confirm the price after a free measuring visit.</span>
      </div>
    ),
  },
  {
    label: 'Delivery status',
    brand: {
      name: 'Fernwood Furniture',
      main: '#9a3d22',
      accent: '#3f7f6e',
      logo: (
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M7 4v16M17 12v8M7 12h10M7 4h3v8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ),
    },
    customer: 'Priya',
    link: 'f9Tc4mV7xRa1',
    jobs: ['Where’s my delivery?', 'Change my delivery date'],
    fields: [
      { label: 'Order number', value: 'FW-20418' },
      { label: 'Notes', value: 'Side door, please', optional: true },
    ],
    summary: 'Order FW-20418 · Side door, please',
    working: 'Checking your order.',
    answer: (
      <div className="vt-b vt-bot vt-ans vt-card">
        <span className="vt-tag vt-tag-go">Out for delivery</span>
        <b className="vt-card-h">Arriving today between 2 and 4 pm.</b>
        <span className="vt-card-s">Oak dining table · Order FW-20418. The driver knows to use the side door.</span>
        <ol className="vt-track" aria-label="Delivery progress">
          <li className="done">Packed</li>
          <li className="done">Shipped</li>
          <li className="now">Today</li>
          <li>Delivered</li>
        </ol>
      </div>
    ),
  },
];

export function PhoneChat() {
  const [on, setOn] = useState(0);
  const [out, setOut] = useState<number | null>(null);
  const [idle, setIdle] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Pause the rotation while the phone is off screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setIdle(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = (i: number) => {
    if (i === on) return;
    setOut(on);
    setOn(i);
  };

  return (
    <figure ref={ref} className={`vt-phone${idle ? ' vt-idle' : ''}`} aria-label="Examples: three businesses’ customer pages on a phone">
      <div className="vt-device" key={`d${on}`} data-swap={out === null ? undefined : ''}>
        <div className="vt-deck">
          {SCENES.map((s, i) => (
            <SceneScreen key={s.label} s={s} n={i} state={i === on ? 'on' : i === out ? 'out' : 'off'} />
          ))}
        </div>
      </div>
      <figcaption className="vt-scenes">
        <span className="vt-dots-nav">
          {SCENES.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={i === on ? 'on' : undefined}
              aria-label={`Show example ${i + 1}: ${s.label}`}
              aria-current={i === on ? 'true' : undefined}
              onClick={() => go(i)}
            >
              <i key={i === on ? `t${on}` : 'x'} onAnimationEnd={() => go((on + 1) % SCENES.length)} />
            </button>
          ))}
        </span>
        <span className="vt-scene-name">
          {SCENES[on].label} · {SCENES[on].brand.name}
        </span>
      </figcaption>
    </figure>
  );
}

function SceneScreen({ s, n, state }: { s: Scene; n: number; state: 'on' | 'out' | 'off' }) {
  const vars = { '--brand-main': s.brand.main, '--brand-accent': s.brand.accent ?? s.brand.main } as CSSProperties;
  const order = s.fields.flat();
  const field = (f: Field) => {
    const cls = `vt-v vt-v${order.indexOf(f) + 1}${f.kind === 'pick' ? ' vt-pick' : f.kind === 'num' ? ' vt-num-in' : ''}`;
    return (
      <span className="vt-f" key={f.label}>
        <span className="vt-l">
          {f.label}
          {f.optional ? <small>Optional</small> : null}
        </span>
        <span className={cls}>{f.value}</span>
      </span>
    );
  };
  return (
    <div className={`vt-screen vt-s${n + 1} is-${state}`} style={vars} aria-hidden={state === 'on' ? undefined : true}>
      <div className="vt-status" aria-hidden="true">
        <span>9:41</span>
        <span className="vt-notch" />
        <span className="vt-bars">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="vt-url">
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7h1Zm2 0h4V5a2 2 0 0 0-4 0v2Z" fill="currentColor" />
        </svg>
        valetto.ai/c/{s.link}…
      </div>
      <header className="vt-biz">
        <span className="vt-logo" aria-hidden="true">
          {s.brand.logo}
        </span>
        <span>
          <b>{s.brand.name}</b>
          <small>Private page for {s.customer}</small>
        </span>
      </header>
      <ul className="vt-jobs" aria-label={`Jobs ${s.brand.name} allows`}>
        <li className="vt-job vt-job-tap">
          <span className="vt-job-ic" aria-hidden="true">◇</span>
          {s.jobs[0]}
        </li>
        <li className="vt-job">
          <span className="vt-job-ic" aria-hidden="true">▢</span>
          {s.jobs[1]}
        </li>
      </ul>
      <div className="vt-chat">
        <p className="vt-b vt-bot vt-hello">Hi {s.customer}. Pick a job to start.</p>
        <div className="vt-after">
          <p className="vt-b vt-me vt-ask">
            <small>{s.jobs[0]}</small>
            {s.summary}
          </p>
          <div className="vt-slot">
            <p className="vt-b vt-bot vt-work">
              <span className="vt-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {s.working}
            </p>
            {s.answer}
          </div>
        </div>
      </div>
      <div className="vt-form" role="group" aria-label={`${s.jobs[0]} form`}>
        <div className="vt-form-top">
          <b>{s.jobs[0]}</b>
          <small>Your request goes to {s.brand.name}.</small>
        </div>
        {s.fields.map((f) =>
          Array.isArray(f) ? (
            <span className="vt-row" key={f[0].label}>
              {field(f[0])}
              {field(f[1])}
            </span>
          ) : (
            field(f)
          ),
        )}
        <span className="vt-send">Send request</span>
      </div>
      <p className="vt-foot-note">
        <MarkIcon size={11} />
        via Valetto
      </p>
    </div>
  );
}

function RingRender() {
  return (
    <svg className="vt-render" viewBox="0 0 240 120" role="img" aria-label="Render of a gold ring with an oval sapphire">
      <defs>
        <radialGradient id="vt-bg" cx="50%" cy="40%" r="70%">
          <stop offset="0" stopColor="#f6f3ec" />
          <stop offset="1" stopColor="#d9d4c7" />
        </radialGradient>
        <linearGradient id="vt-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e3a1" />
          <stop offset=".45" stopColor="#c99a3c" />
          <stop offset=".7" stopColor="#f2d687" />
          <stop offset="1" stopColor="#9c7224" />
        </linearGradient>
        <radialGradient id="vt-gem" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#9fc3ff" />
          <stop offset=".45" stopColor="#2b57b8" />
          <stop offset="1" stopColor="#0c1f5c" />
        </radialGradient>
      </defs>
      <rect width="240" height="120" fill="url(#vt-bg)" />
      <ellipse cx="120" cy="108" rx="62" ry="6" fill="#000" opacity=".12" />
      <ellipse cx="120" cy="74" rx="46" ry="30" fill="none" stroke="url(#vt-gold)" strokeWidth="5" />
      <path d="M108 44l-4-8h32l-4 8" fill="#c99a3c" />
      <ellipse cx="120" cy="30" rx="15" ry="11" fill="url(#vt-gem)" stroke="#d8b25a" strokeWidth="1.6" />
      <ellipse cx="115" cy="26" rx="4" ry="2.4" fill="#fff" opacity=".7" />
      <path d="M150 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" opacity=".9" />
    </svg>
  );
}
