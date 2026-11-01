import { Bricolage_Grotesque, Martian_Mono } from 'next/font/google';

// Valetto's type, scoped to the Valetto pages (landing, early access, privacy, terms): Bricolage Grotesque for text,
// Martian Mono for the hero headline and small labels. valetto.css maps them onto .vt. Both are variable fonts:
// the headline uses weight 450 and the narrower width, and Bricolage's optical size keeps large text tight.
const sans = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-vt-sans', axes: ['opsz'] });
const mono = Martian_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-vt-mono', axes: ['wdth'] });

export default function ValettoLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sans.variable} ${mono.variable} vt-type`}>{children}</div>;
}
