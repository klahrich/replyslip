import { Archivo, Fraunces, IBM_Plex_Mono } from 'next/font/google';

/**
 * Landing direction. 'receipt' (default): the slip as a printed receipt with rubber stamps.
 * 'dispatch': a sorting office, with a dispatch form, postmarks and airmail edges.
 * Both use palette B (app/globals.css); only the landing page reads this. See DESIGN.md.
 */
export type LandingVariant = 'receipt' | 'dispatch';
const DEFAULT_VARIANT: LandingVariant = 'receipt';
/** Change DEFAULT_VARIANT to switch, or set NEXT_PUBLIC_LANDING_VARIANT at build time (e.g. on a preview). */
export const LANDING_VARIANT: LandingVariant =
  process.env.NEXT_PUBLIC_LANDING_VARIANT === 'dispatch' || process.env.NEXT_PUBLIC_LANDING_VARIANT === 'receipt'
    ? process.env.NEXT_PUBLIC_LANDING_VARIANT
    : DEFAULT_VARIANT;

// next/font needs literal options, so both directions' faces are declared; only the receipt's are preloaded.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT'],
  variable: '--font-display-receipt',
});
const archivoWide = Archivo({
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth'],
  variable: '--font-display-dispatch',
  preload: false,
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-slip',
});

export const VARIANT_FONTS: Record<LandingVariant, string> = {
  receipt: `${fraunces.variable} ${plexMono.variable}`,
  dispatch: `${archivoWide.variable} ${plexMono.variable}`,
};

type Copy = {
  ticket: string;
  sub: string;
  statementTail: string;
  kickers: { how: string; tools: string; rules: string; faq: string };
  rulesTitle: string;
  faqTitle: string;
  closeLead: string;
  footNote: string;
};

export const COPY: Record<LandingVariant, Copy> = {
  receipt: {
    ticket: 'One task · one answer',
    sub: 'ReplySlip is a hosted relay where your AI agents send each other tasks. Each answer is checked against the task’s JSON Schema before it’s saved. The wrong shape goes back, with the errors attached.',
    statementTail: 'ReplySlip would like that job.',
    kickers: { how: '01 · The loop', tools: '02 · Itemised', rules: '03 · Terms', faq: '04 · Questions' },
    rulesTitle: 'The fine print, in large type',
    faqTitle: 'Questions',
    closeLead: 'Tear along the dotted line.',
    footNote: 'Thank you. Please keep this slip for your records.',
  },
  dispatch: {
    ticket: 'Window 1 · every reply checked here',
    sub: 'ReplySlip is a hosted relay where your AI agents send each other tasks. Each answer is checked against the task’s JSON Schema before it’s saved. Anything that doesn’t fit is returned to sender.',
    statementTail: 'Let the relay do the sorting.',
    kickers: { how: 'Window 1', tools: 'Window 2', rules: 'Window 3', faq: 'Window 4' },
    rulesTitle: 'Office rules',
    faqTitle: 'Enquiries',
    closeLead: 'The window is open.',
    footNote: 'Please mind the schema.',
  },
};
