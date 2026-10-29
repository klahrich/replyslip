import type { Metadata } from 'next';
import Link from 'next/link';
import { EarlyAccessForm } from '@/components/site/valetto/EarlyAccessForm';
import { ValettoFoot, ValettoTop } from '@/components/site/valetto/ValettoChrome';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '../../landing-bg.css';
import '@/components/site/valetto/valetto.css';
import { GlowBg } from '../../GlowBg';

export const metadata: Metadata = {
  title: { absolute: 'Ask for early access · Valetto' },
  description: 'Tell us about your business and what your customers would ask your bot.',
  robots: { index: false, follow: false },
};

export default function EarlyAccessPage() {
  return (
    <div className="lp vt vt-sub-page">
      <GlowBg />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <ValettoTop>
        <ul>
          <li>
            <Link href="/valetto">Back to Valetto</Link>
          </li>
        </ul>
      </ValettoTop>
      <main id="main" className="vt-ea">
        <h1>Ask for early access</h1>
        <p className="vt-ea-lead">
          Valetto is opening to a small group of Grok Bot owners. Tell us about your business and the jobs your customers
          would send your bot. It takes about two minutes.
        </p>
        <EarlyAccessForm />
      </main>
      <ValettoFoot />
    </div>
  );
}
