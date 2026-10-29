/**
 * Owner branding → CSS variables on the page root (spec 7 "Theme" and 13.4).
 * The server already sends foregrounds; we recompute them when missing and check whether the main
 * color is readable as text on white (13.4 `primary_on_white_ok`, not in the 15.1 branding object).
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
function mix(hex: string, toward: [number, number, number], t: number): string {
  const c = channels(hex).map((v, i) => Math.round(v + (toward[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** The main color, darkened only as much as needed to pass 4.5:1 as text on white. */
export function textSafe(hex: string, bg = '#FFFFFF'): string {
  let out = hex;
  for (let t = 0.1; contrast(out, bg) < 4.5 && t <= 1; t += 0.1) out = mix(hex, [0, 0, 0], t);
  return out;
}

export function brandStyle(b: Branding): CSSProperties {
  const primary = HEX.test(b.primary_color) ? b.primary_color : VALETTO_DEFAULT_PRIMARY;
  const primaryFg = b.primary_foreground && HEX.test(b.primary_foreground) && contrast(primary, b.primary_foreground) >= 4.5 ? b.primary_foreground : readableOn(primary);
  const accent = b.accent_color && HEX.test(b.accent_color) ? b.accent_color : null;
  const vars: Record<string, string> = {
    '--primary': primary,
    '--primary-foreground': primaryFg,
    '--primary-text': textSafe(primary),
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
