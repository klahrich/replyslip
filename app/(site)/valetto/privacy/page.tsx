import type { Metadata } from 'next';
import { ValettoLegal } from '@/components/site/valetto/ValettoLegal';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '@/components/site/valetto/valetto.css';
import { VALETTO_PRIVACY_MD } from './content';

export const metadata: Metadata = {
  title: { absolute: 'Privacy policy (draft) · Valetto' },
  robots: { index: false, follow: false },
};

export default function ValettoPrivacyPage() {
  return <ValettoLegal md={VALETTO_PRIVACY_MD} />;
}
