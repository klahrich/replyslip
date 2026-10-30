import type { Metadata } from 'next';
import { valettoMeta } from '@/components/site/valetto/seo';
import { ValettoLegal } from '@/components/site/valetto/ValettoLegal';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '@/components/site/valetto/valetto.css';
import { VALETTO_PRIVACY_MD } from './content';

export const metadata: Metadata = valettoMeta('/privacy', 'Privacy policy (draft) · Valetto', 'What Valetto stores and how to have it deleted.');

export default function ValettoPrivacyPage() {
  return <ValettoLegal md={VALETTO_PRIVACY_MD} />;
}
