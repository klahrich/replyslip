import type { Metadata } from 'next';
import { valettoMeta } from '@/components/site/valetto/seo';
import { ValettoLegal } from '@/components/site/valetto/ValettoLegal';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '@/components/site/valetto/valetto.css';
import { VALETTO_TERMS_MD } from './content';

export const metadata: Metadata = valettoMeta('/terms', 'Terms of service (draft) · Valetto', 'The terms for using Valetto as an owner or as a customer.');

export default function ValettoTermsPage() {
  return <ValettoLegal md={VALETTO_TERMS_MD} />;
}
