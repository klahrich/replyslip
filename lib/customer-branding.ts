/**
 * Branding object for customer pages (spec 15.1 and 17.3). Owner branding (section 13) is a later PR,
 * so every bot gets this placeholder: the agent's name and the Valetto default colors.
 */
export const VALETTO_PRIMARY = '#1F2937';
export const VALETTO_ACCENT = '#2563EB';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the color. */
export function foregroundFor(hex: string): '#000000' | '#FFFFFF' {
  const l = luminance(hex);
  return contrast(l, 0) >= contrast(l, 1) ? '#000000' : '#FFFFFF';
}

export type Branding = {
  display_name: string;
  logo_url: string | null;
  logo_width: number | null;
  logo_height: number | null;
  primary_color: string;
  primary_foreground: string;
  on_primary: string;
  primary_on_white_ok: boolean;
  accent_color: string;
  accent_foreground: string;
  show_footer: true;
};

export function defaultBranding(agentName: string): Branding {
  const primaryForeground = foregroundFor(VALETTO_PRIMARY);
  return {
    display_name: agentName,
    logo_url: null,
    logo_width: null,
    logo_height: null,
    primary_color: VALETTO_PRIMARY,
    primary_foreground: primaryForeground,
    on_primary: primaryForeground,
    primary_on_white_ok: contrast(luminance(VALETTO_PRIMARY), 1) >= 4.5,
    accent_color: VALETTO_ACCENT,
    accent_foreground: foregroundFor(VALETTO_ACCENT),
    show_footer: true,
  };
}
