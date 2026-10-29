/**
 * Hero visual for the Valetto preview: the customer's private chat page on a phone.
 * Pure markup; valetto.css plays one loop (tap a job, fill its form, send, "working on it", the answer, the email).
 * With reduced motion the phone rests on the finished exchange.
 */
import type { CSSProperties } from 'react';
import { MarkIcon } from '../Mark';

/** The owner's branding: a main colour and an optional accent (falls back to the main colour). */
type Brand = { name: string; main: string; accent?: string };

export function PhoneChat({ brand = { name: 'Acme Jewellers', main: '#6e1f3f', accent: '#c9962e' } }: { brand?: Brand }) {
  const vars = { '--brand-main': brand.main, '--brand-accent': brand.accent ?? brand.main } as CSSProperties;
  return (
    <figure className="vt-phone" aria-label={`Example: a customer’s page for ${brand.name} on a phone`}>
      <div className="vt-device">
        <div className="vt-screen" style={vars}>
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
            valetto.ai/c/k7Qm2xR9vTb4…
          </div>
          <div className="vt-mail" aria-hidden="true">
            <span className="vt-mail-ic">✉</span>
            <span>
              <b>{brand.name}</b>
              Your ring render is ready
            </span>
          </div>
          <header className="vt-biz">
            <span className="vt-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M7 4h10l3 4-8 12L4 8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M4 8h16M9.5 4 12 20M14.5 4 12 20" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </span>
            <span>
              <b>{brand.name}</b>
              <small>Private page for Maya</small>
            </span>
          </header>
          <ul className="vt-jobs" aria-label={`Jobs ${brand.name} granted`}>
            <li className="vt-job vt-job-tap">
              <span className="vt-job-ic" aria-hidden="true">◇</span>Render my ring
            </li>
            <li className="vt-job">
              <span className="vt-job-ic" aria-hidden="true">▢</span>Check order status
            </li>
          </ul>
          <div className="vt-chat">
            <p className="vt-b vt-bot vt-hello">Hi Maya. Pick a job to start.</p>
            <div className="vt-after">
              <p className="vt-b vt-me vt-ask">
                <small>Render my ring</small>
                18k yellow gold · Oval sapphire · Size 6.5 · Thin band
              </p>
              <div className="vt-slot">
                <p className="vt-b vt-bot vt-work">
                  <span className="vt-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Working on it. We’ll email you too.
                </p>
                <div className="vt-b vt-bot vt-ans">
                  <RingRender />
                  <p>Here’s your ring: oval sapphire on a 1.8 mm yellow gold band.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="vt-form" role="group" aria-label="Render my ring form">
            <div className="vt-form-top">
              <b>Render my ring</b>
              <small>Your request goes to {brand.name}.</small>
            </div>
            <span className="vt-f">
              <span className="vt-l">Metal</span>
              <span className="vt-v vt-v1 vt-pick">18k yellow gold</span>
            </span>
            <span className="vt-f">
              <span className="vt-l">Stone</span>
              <span className="vt-v vt-v2 vt-pick">Oval sapphire</span>
            </span>
            <span className="vt-f">
              <span className="vt-l">Ring size</span>
              <span className="vt-v vt-v3 vt-num-in">6.5</span>
            </span>
            <span className="vt-f">
              <span className="vt-l">
                Notes <small>Optional</small>
              </span>
              <span className="vt-v vt-v4">Thin band</span>
            </span>
            <span className="vt-send">Send request</span>
          </div>
          <p className="vt-foot-note">
            <MarkIcon size={11} />
            via Valetto
          </p>
        </div>
      </div>
    </figure>
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
