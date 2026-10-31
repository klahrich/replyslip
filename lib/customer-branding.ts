import { eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { agentBranding, users, workspaces, type AgentBrandingRow } from '@/db/schema';
import { HttpError } from './errors';
import { chosenWorkspaceName } from './workspace-name';

/**
 * Branding object for customer pages (spec 13, 15.1, 17.2, 17.3, 17.18). A bot with no
 * agent_branding row gets the Valetto default colors. The display name is the owner's
 * branding display_name, else their chosen workspace name, else NEUTRAL_DISPLAY_NAME.
 * It is never the internal agent name (17.18).
 */
export const VALETTO_PRIMARY = '#1F2937';
export const VALETTO_ACCENT = '#2563EB';
export const NEUTRAL_DISPLAY_NAME = 'This business';
export const DISPLAY_NAME_MAX = 60;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the color. */
export function foregroundFor(hex: string): '#000000' | '#FFFFFF' {
  const l = luminance(hex);
  return contrast(l, 0) >= contrast(l, 1) ? '#000000' : '#FFFFFF';
}

/** True when the color is readable as text on a white page (WCAG AA, 4.5:1). */
export function onWhiteOk(hex: string): boolean {
  return contrast(luminance(hex), 1) >= 4.5;
}

export type Branding = {
  display_name: string;
  logo_url: string | null;
  logo_width: number | null;
  logo_height: number | null;
  primary_color: string;
  primary_foreground: '#000000' | '#FFFFFF';
  on_primary: '#000000' | '#FFFFFF';
  primary_on_white_ok: boolean;
  accent_color: string;
  accent_foreground: '#000000' | '#FFFFFF';
  show_footer: true;
};

/** The six keys get_agent_card may show (13.6). */
export type CardBranding = Pick<
  Branding,
  'display_name' | 'primary_color' | 'primary_foreground' | 'accent_color' | 'accent_foreground' | 'logo_url'
>;

type StoredBranding = Pick<
  AgentBrandingRow,
  'displayName' | 'primaryColor' | 'accentColor' | 'logoUrl' | 'logoWidth' | 'logoHeight'
>;

export function serializeBranding(row: StoredBranding | null, ownerName: string | null): Branding {
  const custom = row?.primaryColor ?? null;
  const primary = custom ?? VALETTO_PRIMARY;
  // 17.2: a null accent is derived from the primary. With no custom primary either, both are Valetto's.
  const accent = row?.accentColor ?? (custom ? primary : VALETTO_ACCENT);
  const primaryForeground = foregroundFor(primary);
  const hasLogo = !!row?.logoUrl;
  return {
    display_name: row?.displayName ?? ownerName ?? NEUTRAL_DISPLAY_NAME,
    logo_url: hasLogo ? row!.logoUrl : null,
    logo_width: hasLogo ? (row!.logoWidth ?? null) : null,
    logo_height: hasLogo ? (row!.logoHeight ?? null) : null,
    primary_color: primary,
    primary_foreground: primaryForeground,
    on_primary: primaryForeground,
    primary_on_white_ok: onWhiteOk(primary),
    accent_color: accent,
    accent_foreground: foregroundFor(accent),
    show_footer: true,
  };
}

/**
 * Branding for responses anyone holding a link can read (R1 and the used-up 410), which never name the agent.
 * Logos uploaded before uploads moved to a random folder live under `branding/<agentId>/`, so a logo URL that
 * contains the agent id is dropped (no logo) until the owner uploads it again.
 */
export function publicBranding(branding: Branding, agentId: string): Branding {
  if (!branding.logo_url || !branding.logo_url.toLowerCase().includes(agentId.toLowerCase())) return branding;
  return { ...branding, logo_url: null, logo_width: null, logo_height: null };
}

export function defaultBranding(displayName: string | null): Branding {
  return serializeBranding(null, displayName);
}

export function cardBranding(branding: Branding): CardBranding {
  return {
    display_name: branding.display_name,
    primary_color: branding.primary_color,
    primary_foreground: branding.primary_foreground,
    accent_color: branding.accent_color,
    accent_foreground: branding.accent_foreground,
    logo_url: branding.logo_url,
  };
}

/** Owner dashboard shape (13.3): the resolved object, plus the raw fields the owner set. */
export function ownerBranding(row: AgentBrandingRow | null, ownerName: string | null) {
  return {
    ...serializeBranding(row, ownerName),
    custom: {
      display_name: row?.displayName ?? null,
      primary_color: row?.primaryColor ?? null,
      accent_color: row?.accentColor ?? null,
    },
    updated_at: row?.updatedAt.toISOString() ?? null,
  };
}

const COLOR = /^#[0-9A-Fa-f]{6}$/;

export function normalizeColor(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !COLOR.test(value)) {
    throw new HttpError(400, 'invalid_color', `${field} must be a color like #1A2B3C.`, { field });
  }
  return value.toUpperCase();
}

// Control (Cc) and format (Cf: soft hyphen, word joiner, zero-width, bidi controls, tags) characters,
// plus line and paragraph separators (13.4).
export const FORBIDDEN_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Common look-alikes folded onto Latin after NFKC (which already folds fullwidth and most compatibility
 * forms). Enough to catch "Valetto" spelled with Cyrillic, Greek, or digits; not a full UTS #39 table.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  а: 'a', в: 'b', с: 'c', е: 'e', ё: 'e', һ: 'h', і: 'l', ї: 'l', ј: 'j', к: 'k', ӏ: 'l', м: 'm', н: 'h',
  о: 'o', р: 'p', ԛ: 'q', ѕ: 's', т: 't', у: 'y', ѵ: 'v', ԝ: 'w', х: 'x', ү: 'y', л: 'l', п: 'n', г: 'r',
  // Greek
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'l', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', λ: 'l',
  ϲ: 'c', ϳ: 'j', ω: 'w',
  // Digits and symbols
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '|': 'l', '!': 'l',
  // Latin look-alikes
  i: 'l', ı: 'l', ł: 'l', ŀ: 'l', ƚ: 'l', ɩ: 'l', ʋ: 'v', ʌ: 'v', ŧ: 't', ø: 'o', đ: 'd',
  // Small capitals (no case mapping, and NFKC leaves them alone)
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'l', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm',
  ɴ: 'n', ᴏ: 'o', ᴘ: 'p', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z',
  // Armenian (lowercased first, so capitals such as Օ arrive here as օ)
  օ: 'o', ս: 'u', ո: 'n', ռ: 'n', հ: 'h', ց: 'g', զ: 'q', ա: 'w', լ: 'l', ւ: 'l', ք: 'p',
};

/** NFKC, lowercase, combining marks stripped, look-alikes folded. Spacing and punctuation are kept. */
function foldChars(value: string): string {
  const base = value
    .replace(/\p{Cf}/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  let out = '';
  for (const ch of base) out += CONFUSABLES[ch] ?? ch;
  return out.normalize('NFKC');
}

/** foldChars with everything but letters and digits dropped. */
export function confusableFold(value: string): string {
  return foldChars(value).replace(/[^\p{L}\p{N}]/gu, '');
}

/** Joins each run of consecutive short pieces (1 or 2 letters) into one; longer pieces stay as they are. */
function joinShortRuns(pieces: string[]): string[] {
  const out: string[] = [];
  let run = '';
  for (const piece of pieces) {
    if ([...piece].length <= 2) {
      run += piece;
      continue;
    }
    if (run) out.push(run);
    run = '';
    out.push(piece);
  }
  if (run) out.push(run);
  return out;
}

/**
 * The folded words of a name, in two views; a name is reserved if either view has "valetto" in a word.
 * - Whitespace words with punctuation inside dropped: "Va-letto", "Va_letto", "v.a.l.e.t.t.o".
 * - Pieces split on spaces and punctuation, with runs of 1- or 2-letter pieces joined:
 *   "v a l e t t o", "Va le tt o", "v.a l.e t.t.o".
 * Real word boundaries between longer words are kept ("Valet Toronto", "Chevalet Tobacco").
 */
export function foldedWords(value: string): string[] {
  const folded = foldChars(value);
  const words = folded
    .split(/[\s\p{Z}]+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const pieces = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return [...words, ...joinShortRuns(pieces)];
}

// "valetto" after the same fold (i and l fold together, so the check is done on the folded copy).
const RESERVED_FOLDED = confusableFold('valetto');

/** True when any word of the name contains "Valetto", spelled with look-alikes, punctuation, or spaced letters. */
export function looksLikeValetto(value: string): boolean {
  return foldedWords(value).some((word) => word.includes(RESERVED_FOLDED));
}

export function normalizeDisplayName(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_display_name', 'display_name must be text.');
  }
  // Checked before trim(): trim() quietly drops U+FEFF and would hide it.
  if (FORBIDDEN_NAME_CHARS.test(value)) {
    throw new HttpError(400, 'invalid_display_name', 'display_name has characters that are not allowed.');
  }
  const name = value.normalize('NFC').trim();
  if (name.length < 1 || [...name].length > DISPLAY_NAME_MAX) {
    throw new HttpError(400, 'invalid_display_name', `display_name must be 1-${DISPLAY_NAME_MAX} characters.`);
  }
  if (looksLikeValetto(name)) {
    throw new HttpError(400, 'invalid_display_name', 'display_name cannot contain "Valetto".');
  }
  return name;
}

/** The owner workspace's chosen name, or null while it still has a default name (17.18). */
export async function ownerDisplayName(db: Db, workspaceId: string, name?: string): Promise<string | null> {
  let workspaceName = name;
  if (workspaceName === undefined) {
    const [workspace] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    workspaceName = workspace?.name ?? '';
  }
  const members = await db.select({ email: users.email }).from(users).where(eq(users.workspaceId, workspaceId));
  return chosenWorkspaceName(workspaceName, members.map((m) => m.email));
}

export async function brandingRow(db: Db, agentId: string): Promise<AgentBrandingRow | null> {
  const [row] = await db.select().from(agentBranding).where(eq(agentBranding.agentId, agentId)).limit(1);
  return row ?? null;
}

export async function brandingFor(
  db: Db,
  agent: { id: string; workspaceId: string },
  ownerWorkspaceName?: string,
): Promise<Branding> {
  const row = await brandingRow(db, agent.id);
  // The workspace fallback only matters when the owner did not set a display name.
  const fallback = row?.displayName ? null : await ownerDisplayName(db, agent.workspaceId, ownerWorkspaceName);
  return serializeBranding(row, fallback);
}

/** Batch version for lists (R3). */
export async function brandingForMany(
  db: Db,
  bots: { id: string; workspaceId: string }[],
): Promise<Map<string, Branding>> {
  const out = new Map<string, Branding>();
  if (bots.length === 0) return out;
  const rows = await db
    .select()
    .from(agentBranding)
    .where(inArray(agentBranding.agentId, bots.map((b) => b.id)));
  const byAgent = new Map(rows.map((row) => [row.agentId, row]));
  const names = new Map<string, string | null>();
  for (const bot of bots) {
    const row = byAgent.get(bot.id) ?? null;
    let fallback: string | null = null;
    if (!row?.displayName) {
      if (!names.has(bot.workspaceId)) names.set(bot.workspaceId, await ownerDisplayName(db, bot.workspaceId));
      fallback = names.get(bot.workspaceId) ?? null;
    }
    out.set(bot.id, serializeBranding(row, fallback));
  }
  return out;
}
