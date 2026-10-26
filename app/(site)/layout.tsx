import { SiteAnalytics } from './SiteAnalytics';

/** Public site pages. Only these load Vercel Web Analytics; the dashboard and API do not. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteAnalytics />
    </>
  );
}
