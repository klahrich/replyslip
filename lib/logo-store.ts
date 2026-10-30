import { del, put } from '@vercel/blob';
import { HttpError } from './errors';

/** Where branding logos live. Vercel Blob in production; tests swap in a fake. */
export type LogoStore = {
  put(pathname: string, body: Buffer): Promise<{ url: string; pathname: string }>;
  del(pathname: string): Promise<void>;
};

function blobConfigured(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

const vercelBlobStore: LogoStore = {
  async put(pathname, body) {
    if (!blobConfigured()) {
      throw new HttpError(503, 'logo_storage_unavailable', 'Logo uploads are not set up on this server yet.');
    }
    const blob = await put(pathname, body, {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'image/webp',
      cacheControlMaxAge: 31_536_000,
    });
    return { url: blob.url, pathname: blob.pathname };
  },
  async del(pathname) {
    if (!blobConfigured()) return;
    await del(pathname);
  },
};

let store: LogoStore = vercelBlobStore;

export function logoStore(): LogoStore {
  return store;
}

/** Test hook. Pass null to restore Vercel Blob. */
export function setLogoStoreForTests(next: LogoStore | null): void {
  store = next ?? vercelBlobStore;
}

/** Deletes after the row change committed. A failure is logged, never thrown (13.5). */
export async function deleteLogoQuietly(pathname: string | null | undefined): Promise<void> {
  if (!pathname) return;
  try {
    await store.del(pathname);
  } catch (err) {
    console.error('branding logo delete failed', { pathname, error: err instanceof Error ? err.message : String(err) });
  }
}
