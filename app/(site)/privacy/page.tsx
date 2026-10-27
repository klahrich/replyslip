import { LegalPage, legalMeta } from '../_legal/LegalPage';
import { PRIVACY_MD } from './content';

export const metadata = legalMeta(
  '/privacy',
  'Privacy policy',
  'What ReplySlip collects, where it goes, how long we keep it, and how to get it deleted.',
);

export default function PrivacyPage() {
  return <LegalPage md={PRIVACY_MD} />;
}
