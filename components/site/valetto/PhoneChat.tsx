'use client';
/**
 * Hero visual: three channel moments on a phone (a call, a Google review, an email).
 * Each scene plays once (tap the moment, the customer's words fill in, send, "working", the reply), then the next
 * card swipes in. The progress fill on the active dot is the scene timer: its animationend moves the deck on, so
 * pausing the page's animations pauses the rotation too. With reduced motion the phone rests on scene 1's reply;
 * the dots still switch.
 *
 * Class names (.vt-job-tap, .vt-form, .vt-v, .vt-send, .vt-after, .vt-ask, .vt-work, .vt-ans) are the animation beats.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MarkIcon } from '../Mark';

/** The shop's branding: a main colour and an optional accent (falls back to the main colour). */
type Brand = { name: string; main: string; accent?: string; logo: ReactNode };
type Scene = {
  label: string;
  brand: Brand;
  /** Which chrome the status row uses. */
  channel: 'phone' | 'google' | 'email';
  bar: string;
  primary: { title: string; detail: string };
  secondary: string;
  sheetTitle: string;
  sheetNote: string;
  lines: string[];
  send: string;
  hello: string;
  from: string;
  summary: string;
  working: string;
  answer: ReactNode;
};

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M8 4h2.2l1.2 3.2-1.8 1.1a12 12 0 0 0 6.1 6.1l1.1-1.8 3.2 1.2V16a2 2 0 0 1-2.2 2A14 14 0 0 1 6 6.2 2 2 0 0 1 8 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="m12 3.5 2.4 5.2 5.6.7-4.1 3.8 1.1 5.6L12 16.2 6.9 18.8l1.1-5.6L4 9.4l5.6-.7L12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3.5" y="6" width="17" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 7.2 7.5 5.6 7.5-5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const SCENES: Scene[] = [
  {
    label: 'Phone call',
    channel: 'phone',
    brand: {
      name: 'Harbor Plumbing',
      main: '#1a3f66',
      accent: '#e0b15a',
      logo: (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M12 3s5 5.2 5 9.2A5 5 0 0 1 7 12.2C7 8.2 12 3 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 19h4M12 14.5V19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    bar: 'Live call',
    primary: { title: 'Answer the call', detail: 'Kitchen leak · just now' },
    secondary: 'Call them back',
    sheetTitle: 'What they’re saying',
    sheetNote: 'Harbor Plumbing picks up',
    lines: ['The sink is leaking.', 'Under the kitchen cabinet.', 'Can you come today?'],
    send: 'Answer',
    hello: 'Call coming in.',
    from: 'Caller',
    summary: 'The sink is leaking. Can you come today?',
    working: 'Picking up…',
    answer: (
      <div className="vt-b vt-bot vt-ans vt-card">
        <span className="vt-tag vt-tag-go">Answered</span>
        <b className="vt-card-h">Today, between 2 and 4.</b>
        <span className="vt-card-s">I’ll text you to confirm.</span>
      </div>
    ),
  },
  {
    label: 'Google review',
    channel: 'google',
    brand: {
      name: 'Northline Windows',
      main: '#245046',
      accent: '#e2b15a',
      logo: (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect x="5" y="4" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 4v16M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
    },
    bar: 'Google reviews',
    primary: { title: 'Reply to this review', detail: 'Five stars · Dan' },
    secondary: 'Read it later',
    sheetTitle: 'The review',
    sheetNote: 'Dan, on Google',
    lines: ['Five stars.', 'Fair price, and on time.', 'They cleaned up too.'],
    send: 'Post reply',
    hello: 'New review on Google.',
    from: 'Dan',
    summary: 'Five stars. Fair price, on time, and they cleaned up.',
    working: 'Writing the reply…',
    answer: (
      <div className="vt-b vt-bot vt-ans vt-card">
        <span className="vt-tag">Posted</span>
        <span className="vt-stars" aria-hidden="true">
          ★★★★★
        </span>
        <b className="vt-card-h">Thanks, Dan. Glad we got there before the rain.</b>
      </div>
    ),
  },
  {
    label: 'Email reply',
    channel: 'email',
    brand: {
      name: 'Fernwood Furniture',
      main: '#8a3d28',
      accent: '#3f7f6e',
      logo: (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M7 4v16M17 12v8M7 12h10M7 4h3v8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ),
    },
    bar: 'Email',
    primary: { title: 'Reply to Priya', detail: 'Oak table · Saturday' },
    secondary: 'Answer it later',
    sheetTitle: 'What they wrote',
    sheetNote: 'To Fernwood Furniture',
    lines: ['The oak dining table.', 'Is it still in the shop?', 'Can you deliver Saturday?'],
    send: 'Send reply',
    hello: 'New email.',
    from: 'Priya',
    summary: 'Is the oak table still in the shop? Can you deliver Saturday?',
    working: 'Checking the shop…',
    answer: (
      <div className="vt-b vt-bot vt-ans vt-card">
        <span className="vt-tag vt-tag-go">Sent</span>
        <b className="vt-card-h">Yes. The oak table is in the shop.</b>
        <span className="vt-card-s">Saturday delivery is open.</span>
      </div>
    ),
  },
];

const CHANNEL_ICON = { phone: <PhoneIcon />, google: <StarIcon />, email: <MailIcon /> };

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
    <figure ref={ref} className={`vt-phone${idle ? ' vt-idle' : ''}`} aria-label="Examples: a phone call, a Google review, and an email reply">
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
  return (
    <div className={`vt-screen vt-s${n + 1} vt-ch-${s.channel} is-${state}`} style={vars} aria-hidden={state === 'on' ? undefined : true}>
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
        {s.channel === 'phone' ? (
          <span className="vt-live" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7h1Zm2 0h4V5a2 2 0 0 0-4 0v2Z" fill="currentColor" />
          </svg>
        )}
        {s.bar}
      </div>
      <header className="vt-biz">
        <span className="vt-logo" aria-hidden="true">
          {s.brand.logo}
        </span>
        <span>
          <b>{s.brand.name}</b>
          <small>{s.channel === 'phone' ? 'Phone' : s.channel === 'google' ? 'Google reviews' : 'Email'}</small>
        </span>
      </header>
      <ul className="vt-jobs" aria-label={`${s.brand.name}, ${s.label}`}>
        <li className="vt-job vt-job-tap vt-event">
          <span className="vt-job-ic" aria-hidden="true">
            {CHANNEL_ICON[s.channel]}
          </span>
          <span>
            <b>{s.primary.title}</b>
            <small>{s.primary.detail}</small>
          </span>
        </li>
        <li className="vt-job">
          <span className="vt-job-ic" aria-hidden="true">
            ▢
          </span>
          {s.secondary}
        </li>
      </ul>
      <div className="vt-chat">
        <p className="vt-b vt-bot vt-hello">{s.hello}</p>
        <div className="vt-after">
          <p className="vt-b vt-me vt-ask">
            <small>{s.from}</small>
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
      <div className="vt-form" aria-hidden="true">
        <div className="vt-form-top">
          <b>{s.sheetTitle}</b>
          <small>{s.sheetNote}</small>
        </div>
        {s.lines.map((line, i) => (
          <span className="vt-f vt-say" key={line}>
            <span className={`vt-v vt-line vt-v${i + 1}`}>{line}</span>
          </span>
        ))}
        <span className="vt-send">{s.send}</span>
      </div>
      <p className="vt-foot-note">
        <MarkIcon size={11} />
        via Valetto
      </p>
    </div>
  );
}
