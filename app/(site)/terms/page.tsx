import { LegalPage, legalMeta } from '../_legal/LegalPage';
import { TERMS_MD } from './content';

export const metadata = legalMeta(
  '/terms',
  'Terms of service',
  'The terms for the hosted ReplySlip service: acceptable use, sharing, free plan limits, liability and the open-source licences.',
);

export default function TermsPage() {
  return <LegalPage md={TERMS_MD} />;
}
