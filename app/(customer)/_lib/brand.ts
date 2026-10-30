/**
 * Owner branding → CSS variables on the page root (spec 7 "Theme", 13.4 and 17.3).
 * The server's `on_primary` and `primary_on_white_ok` win. The local WCAG check below runs only when
 * a field is missing (older responses).
 */
import type { CSSProperties } from 'react';
import type { Branding } from './types';

const HEX = /^#[0-9a-f]{6}$/i;
export const VALETTO_DEFAULT_PRIMARY = '#2B2B30';

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Black or white, whichever reads better on `bg`. */
export function readableOn(bg: string): '#000000' | '#FFFFFF' {
  return contrast(bg, '#000000') >= contrast(bg, '#FFFFFF') ? '#000000' : '#FFFFFF';
}
/** WCAG 4.5:1 against white, used only when the server didn't send `primary_on_white_ok`. */
function okOnWhite(hex: string): boolean {
  return contrast(hex, '#FFFFFF') >= 4.5;
}
/** 17.3: exactly "#000000" or "#FFFFFF"; any other value (missing, lowercase, a name) is ignored. */
function onPrimaryHex(v: unknown): '#000000' | '#FFFFFF' | null {
  return v === '#000000' || v === '#FFFFFF' ? v : null;
}
/** Text color for "brand-colored" words when the main color fails on white (13.4: fills and borders only). */
const NEUTRAL_TEXT = '#18181B';

export function brandStyle(b: Branding): CSSProperties {
  const primary = HEX.test(b.primary_color) ? b.primary_color : VALETTO_DEFAULT_PRIMARY;
  const usable = primary === b.primary_color; // the server's verdicts describe the owner's color, not our default
  const primaryFg =
    (usable && onPrimaryHex(b.on_primary)) ||
    (b.primary_foreground && HEX.test(b.primary_foreground) && contrast(primary, b.primary_foreground) >= 4.5 ? b.primary_foreground : readableOn(primary));
  const textOk = usable && typeof b.primary_on_white_ok === 'boolean' ? b.primary_on_white_ok : okOnWhite(primary);
  const accent = b.accent_color && HEX.test(b.accent_color) ? b.accent_color : null;
  const vars: Record<string, string> = {
    '--primary': primary,
    '--primary-foreground': primaryFg,
    '--primary-text': textOk ? primary : NEUTRAL_TEXT,
    '--ring': primary,
    // shadcn's --accent is the hover/selected tint; the owner's accent is --brand-accent (used sparingly).
    '--accent': `color-mix(in srgb, ${primary} 8%, #ffffff)`,
    // No accent set: highlights use the main color.
    '--brand-accent': accent ?? primary,
    '--brand-accent-foreground': accent ? (b.accent_foreground && HEX.test(b.accent_foreground) ? b.accent_foreground : readableOn(accent)) : primaryFg,
  };
  return vars as CSSProperties;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? 'V').slice(0, 2)).toUpperCase();
}
