import { Bricolage_Grotesque, Martian_Mono } from 'next/font/google';

// /oauth/* isn't under /valetto, so it loads Valetto's type itself, the same two fonts as app/(site)/valetto/layout.tsx.
const sans = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-vt-sans', axes: ['opsz'] });
const mono = Martian_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-vt-mono', axes: ['wdth'] });

export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sans.variable} ${mono.variable} vt-type`}>{children}</div>;
}
