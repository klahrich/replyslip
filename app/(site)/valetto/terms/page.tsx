import type { Metadata } from 'next';
import { ValettoLegal } from '@/components/site/valetto/ValettoLegal';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '@/components/site/valetto/valetto.css';
import { VALETTO_TERMS_MD } from './content';

export const metadata: Metadata = {
  title: { absolute: 'Terms of service (draft) · Valetto' },
  robots: { index: false, follow: false },
};

export default function ValettoTermsPage() {
  return <ValettoLegal md={VALETTO_TERMS_MD} />;
}
