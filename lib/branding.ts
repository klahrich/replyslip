import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { getDb, type Db } from '@/db';
import { agentBranding, type AgentBrandingRow } from '@/db/schema';
import {
  BRANDING_LOGO_MAX_BYTES,
  BRANDING_LOGO_MAX_PX,
  BRANDING_LOGO_MIN_PX,
  BRANDING_LOGO_OUTPUT_PX,
  BRANDING_LOGO_RATE_KIND,
  BRANDING_LOGO_UPLOADS_PER_HOUR,
} from './constants';
import { normalizeColor, normalizeDisplayName, ownerBranding, ownerDisplayName } from './customer-branding';
import { HttpError } from './errors';
import { deleteLogoQuietly, logoStore } from './logo-store';
import { consumeKeyedRateLimit } from './rate-limit';
import { lockOwnerAgent } from './sharing';

type ImageType = 'png' | 'jpeg' | 'webp';

const DECLARED: Record<string, ImageType> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
};

async function present(db: Db, agent: { id: string; workspaceId: string }, row: AgentBrandingRow | null) {
  const fallback = row?.displayName ? null : await ownerDisplayName(db, agent.workspaceId);
  return { branding: ownerBranding(row, fallback) };
}

async function rowFor(db: Db, agentId: string): Promise<AgentBrandingRow | null> {
  const [row] = await db.select().from(agentBranding).where(eq(agentBranding.agentId, agentId)).limit(1);
  return row ?? null;
}

export async function getOwnerBranding(workspaceId: string, agentId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    return present(tx, agent, await rowFor(tx, agent.id));
  });
}

export type BrandingUpdate = {
  display_name?: unknown;
  primary_color?: unknown;
  accent_color?: unknown;
};

/** PUT branding: only the keys present change; null clears a key. */
export async function updateOwnerBranding(workspaceId: string, agentId: string, input: BrandingUpdate) {
  const changes: Partial<Pick<AgentBrandingRow, 'displayName' | 'primaryColor' | 'accentColor'>> = {};
  if (input.display_name !== undefined) changes.displayName = normalizeDisplayName(input.display_name);
  if (input.primary_color !== undefined) changes.primaryColor = normalizeColor(input.primary_color, 'primary_color');
  if (input.accent_color !== undefined) changes.accentColor = normalizeColor(input.accent_color, 'accent_color');
  return getDb().transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    if (Object.keys(changes).length === 0) return present(tx, agent, await rowFor(tx, agent.id));
    const now = new Date();
    const [row] = await tx
      .insert(agentBranding)
      .values({ agentId: agent.id, ...changes, updatedAt: now })
      .onConflictDoUpdate({ target: agentBranding.agentId, set: { ...changes, updatedAt: now } })
      .returning();
    return present(tx, agent, row ?? null);
  });
}

/** DELETE branding: back to the defaults, logo included. */
export async function deleteOwnerBranding(workspaceId: string, agentId: string) {
  const db = getDb();
  const { result, oldPath } = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const [removed] = await tx.delete(agentBranding).where(eq(agentBranding.agentId, agent.id)).returning();
    return { result: await present(tx, agent, null), oldPath: removed?.logoBlobPath ?? null };
  });
  await deleteLogoQuietly(oldPath);
  return result;
}

export async function deleteOwnerLogo(workspaceId: string, agentId: string) {
  const db = getDb();
  const { result, oldPath } = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const existing = await rowFor(tx, agent.id);
    if (!existing?.logoBlobPath) return { result: await present(tx, agent, existing), oldPath: null };
    const [row] = await tx
      .update(agentBranding)
      .set({ logoBlobPath: null, logoUrl: null, logoWidth: null, logoHeight: null, logoSha256: null, updatedAt: new Date() })
      .where(eq(agentBranding.agentId, agent.id))
      .returning();
    return { result: await present(tx, agent, row ?? null), oldPath: existing.logoBlobPath };
  });
  await deleteLogoQuietly(oldPath);
  return result;
}

/** Magic bytes only; the file name and declared type never decide (13.4). */
export function sniffImageType(bytes: Buffer): ImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/** An APNG has an acTL chunk before its first IDAT. libvips reads only the first frame, so check by hand. */
function isApng(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

export type ProcessedLogo = { webp: Buffer; width: number; height: number; sha256: string };

/** Steps 2-4 of 13.4: sniff, decode safely, re-encode as metadata-free WebP inside 512x512. */
export async function processLogo(bytes: Buffer, declaredType: string): Promise<ProcessedLogo> {
  const unsupported = () =>
    new HttpError(415, 'unsupported_image_type', 'Upload a PNG, JPEG, or WebP image.');
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw unsupported();
  const declared = DECLARED[declaredType];
  if (!declared || declared !== sniffed) throw unsupported();
  const decodeFailed = () => new HttpError(400, 'image_decode_failed', 'This image could not be read. Try another file.');
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: 4096 * 4096, animated: true }).metadata();
  } catch {
    throw decodeFailed();
  }
  if (meta.format !== sniffed) throw unsupported();
  if ((meta.pages ?? 1) > 1 || (sniffed === 'png' && isApng(bytes))) {
    throw new HttpError(400, 'image_animated', 'Animated images are not supported. Upload a still image.');
  }
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (
    width < BRANDING_LOGO_MIN_PX ||
    height < BRANDING_LOGO_MIN_PX ||
    width > BRANDING_LOGO_MAX_PX ||
    height > BRANDING_LOGO_MAX_PX
  ) {
    throw new HttpError(
      400,
      'image_dimensions',
      `The logo must be between ${BRANDING_LOGO_MIN_PX}x${BRANDING_LOGO_MIN_PX} and ${BRANDING_LOGO_MAX_PX}x${BRANDING_LOGO_MAX_PX} pixels.`,
      { width, height },
    );
  }
  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'truncated' })
      .rotate()
      .resize({ width: BRANDING_LOGO_OUTPUT_PX, height: BRANDING_LOGO_OUTPUT_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw decodeFailed();
  }
  return {
    webp: output.data,
    width: output.info.width,
    height: output.info.height,
    sha256: createHash('sha256').update(output.data).digest('hex'),
  };
}

/** PUT branding/logo. The old blob is deleted only after the new row is committed (13.5). */
export async function uploadOwnerLogo(
  workspaceId: string,
  agentId: string,
  read: (maxBytes: number) => Promise<{ bytes: Buffer; contentType: string }>,
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const limit = await consumeKeyedRateLimit(tx, {
      kind: BRANDING_LOGO_RATE_KIND,
      key: agent.workspaceId,
      limit: BRANDING_LOGO_UPLOADS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    if (limit.limited) {
      throw new HttpError(429, 'rate_limited', 'Too many logo uploads. Try again later.', {
        retry_after_seconds: limit.retryAfterSeconds,
      });
    }
  });
  const { bytes, contentType } = await read(BRANDING_LOGO_MAX_BYTES);
  const logo = await processLogo(bytes, contentType);
  const blob = await logoStore().put(`branding/${agentId}/${logo.sha256}.webp`, logo.webp);
  let written: { result: Awaited<ReturnType<typeof present>>; oldPath: string | null };
  try {
    written = await db.transaction(async (tx) => {
      const agent = await lockOwnerAgent(tx, workspaceId, agentId);
      const existing = await rowFor(tx, agent.id);
      const now = new Date();
      const logoColumns = {
        logoBlobPath: blob.pathname,
        logoUrl: blob.url,
        logoWidth: logo.width,
        logoHeight: logo.height,
        logoSha256: logo.sha256,
        updatedAt: now,
      };
      const [row] = await tx
        .insert(agentBranding)
        .values({ agentId: agent.id, ...logoColumns })
        .onConflictDoUpdate({ target: agentBranding.agentId, set: logoColumns })
        .returning();
      return { result: await present(tx, agent, row ?? null), oldPath: existing?.logoBlobPath ?? null };
    });
  } catch (err) {
    await deleteLogoQuietly(blob.pathname);
    throw err;
  }
  if (written.oldPath !== blob.pathname) await deleteLogoQuietly(written.oldPath);
  return written.result;
}
