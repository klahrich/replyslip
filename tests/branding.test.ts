import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE as deleteBrandingRoute, GET as getBrandingRoute, PUT as putBrandingRoute } from '@/app/api/v1/agents/[id]/branding/route';
import { DELETE as deleteLogoRoute, PUT as putLogoRoute } from '@/app/api/v1/agents/[id]/branding/logo/route';
import { POST as revokeAgentRoute } from '@/app/api/v1/agents/[id]/revoke/route';
import { GET as getBotRoute } from '@/app/api/v1/c/bots/[agent_id]/route';
import { GET as resolveLink } from '@/app/api/v1/c/links/[token]/route';
import { getDb } from '@/db';
import { agentBranding, rateEvents } from '@/db/schema';
import { BRANDING_LOGO_RATE_KIND, BRANDING_LOGO_UPLOADS_PER_HOUR } from '@/lib/constants';
import { confusableFold, contrast, foregroundFor, looksLikeValetto, luminance, onWhiteOk, serializeBranding } from '@/lib/customer-branding';
import { setLogoStoreForTests, type LogoStore } from '@/lib/logo-store';
import { getAgentCard } from '@/lib/sharing';
import { approvedCustomer, createLink, ORIGIN, owner, senderOf, type Owner } from './customer-fixtures';
import { call, signIn } from './helpers';

type FakeStore = LogoStore & { files: Map<string, Buffer>; deleted: string[]; failDelete: boolean };

function fakeStore(): FakeStore {
  const files = new Map<string, Buffer>();
  const store: FakeStore = {
    files,
    deleted: [],
    failDelete: false,
    async put(pathname, body) {
      const stored = pathname.replace(/\.webp$/, `-${randomUUID().slice(0, 8)}.webp`);
      files.set(stored, body);
      return { url: `https://blob.test/${stored}`, pathname: stored };
    },
    async del(pathname) {
      if (store.failDelete) throw new Error('blob down');
      store.deleted.push(pathname);
      files.delete(pathname);
    },
  };
  return store;
}

let store: FakeStore;
beforeEach(() => {
  store = fakeStore();
  setLogoStoreForTests(store);
});
afterEach(() => setLogoStoreForTests(null));

const url = (o: Owner, logo = false) => `http://localhost/api/v1/agents/${o.agentId}/branding${logo ? '/logo' : ''}`;

function putBranding(o: Owner, body: unknown, init: { cookie?: string; bearer?: string; headers?: Record<string, string> } = {}) {
  return call(putBrandingRoute, url(o), {
    method: 'PUT',
    cookie: init.bearer ? undefined : (init.cookie ?? o.cookie),
    bearer: init.bearer,
    params: { id: o.agentId },
    body,
    headers: init.headers ?? ORIGIN,
  });
}

async function putLogo(o: Owner, bytes: Buffer, contentType: string, headers: Record<string, string> = ORIGIN) {
  const res = await putLogoRoute(
    new Request(url(o, true), {
      method: 'PUT',
      headers: { cookie: o.cookie, 'content-type': contentType, ...headers },
      body: new Uint8Array(bytes),
    }),
    { params: Promise.resolve({ id: o.agentId }) },
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: '#336699' } }).png().toBuffer();

describe('branding colors', () => {
  it('picks readable foregrounds and flags light primaries on white', () => {
    expect(foregroundFor('#1F2937')).toBe('#FFFFFF');
    expect(foregroundFor('#FFD600')).toBe('#000000');
    expect(onWhiteOk('#1F2937')).toBe(true);
    expect(onWhiteOk('#FFD600')).toBe(false);
    for (let i = 0; i < 4096; i++) {
      const hex = `#${(i * 4099).toString(16).padStart(6, '0').slice(-6).toUpperCase()}`;
      const fg = foregroundFor(hex);
      const other = fg === '#000000' ? '#FFFFFF' : '#000000';
      expect(contrast(luminance(hex), luminance(fg))).toBeGreaterThanOrEqual(contrast(luminance(hex), luminance(other)));
    }
  });

  it('never returns a null accent', () => {
    expect(serializeBranding(null, null)).toMatchObject({
      display_name: 'This business',
      primary_color: '#1F2937',
      accent_color: '#2563EB',
      primary_foreground: '#FFFFFF',
      primary_on_white_ok: true,
      logo_url: null,
      show_footer: true,
    });
  });
});

const VALETTO_VARIANTS = [
  'Valetto',
  'VALETTO',
  'Va\u00ADletto', // soft hyphen
  'Val\u2060etto', // word joiner
  'Vale\u200Dtto', // zero-width joiner
  'V\u0430l\u0435tt\u043E', // Cyrillic а е о
  '\uFF36\uFF21\uFF2C\uFF25\uFF34\uFF34\uFF2F', // fullwidth ＶＡＬＥＴＴＯ
  '\uFF56alett\uFF4F', // mixed fullwidth
  '\u03BDal\u03B5tt\u03BF', // Greek ν ε ο
  'Va1etto',
  'VaIetto', // capital I as l
  'V4l3tt0',
  'Valett0',
  'Vàlëttó', // accents
  'Va\u0301letto', // combining mark
  'V a l e t t o',
  'Va-letto',
  'Va.l.e.t.t.o',
  'Va_letto Pro',
  'My valetto shop',
  'VaLeT\u0442O', // Cyrillic т
  '\u24CB\u24D0\u24DB\u24D4\u24E3\u24E3\u24DE', // circled letters
  '\uD835\uDC15aletto', // mathematical bold V
];

describe('reserved name', () => {
  it('folds look-alikes to plain ASCII', () => {
    expect(confusableFold('V\u0430l\u0435tt\u043E')).toBe('valetto');
    expect(confusableFold('\uFF36\uFF21\uFF2C\uFF25\uFF34\uFF34\uFF2F')).toBe('valetto');
    expect(confusableFold('Va\u00ADletto')).toBe('valetto');
  });

  it('spots every Valetto variant', () => {
    for (const name of VALETTO_VARIANTS) expect(looksLikeValetto(name), JSON.stringify(name)).toBe(true);
  });

  it('leaves ordinary names alone', () => {
    for (const name of ['Acme Tables', 'Valley Toys', 'Violet', 'Let it go', 'Velvet Tot', 'Wallet Co', 'Palette', 'Valencia', 'Vale Totem', 'Valet Services']) {
      expect(looksLikeValetto(name), name).toBe(false);
    }
  });
});

describe('PUT /api/v1/agents/:id/branding', () => {
  it('saves, normalizes, falls back, and resets', async () => {
    const o = await owner();
    const res = await putBranding(o, { display_name: '  Acme Tables  ', primary_color: '#ffd600' });
    expect(res.status, res.text).toBe(200);
    expect(res.data.branding).toMatchObject({
      display_name: 'Acme Tables',
      primary_color: '#FFD600',
      accent_color: '#FFD600',
      primary_foreground: '#000000',
      on_primary: '#000000',
      primary_on_white_ok: false,
      custom: { display_name: 'Acme Tables', primary_color: '#FFD600', accent_color: null },
    });
    const accent = await putBranding(o, { accent_color: '#00aa55' });
    expect(accent.data.branding).toMatchObject({ primary_color: '#FFD600', accent_color: '#00AA55', display_name: 'Acme Tables' });
    const cleared = await putBranding(o, { primary_color: null, accent_color: null });
    expect(cleared.data.branding).toMatchObject({ primary_color: '#1F2937', accent_color: '#2563EB' });

    const got = await call(getBrandingRoute, url(o), { cookie: o.cookie, params: { id: o.agentId } });
    expect(got.data.branding.display_name).toBe('Acme Tables');

    const reset = await call(deleteBrandingRoute, url(o), { method: 'DELETE', cookie: o.cookie, params: { id: o.agentId }, headers: ORIGIN });
    expect(reset.status).toBe(200);
    expect(reset.data.branding.custom).toEqual({ display_name: null, primary_color: null, accent_color: null });
  });

  it('rejects bad colors and names', async () => {
    const o = await owner();
    for (const primary_color of ['red', '#FFF', '#GGGGGG', 12, '#1F2937 ']) {
      const res = await putBranding(o, { primary_color });
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('invalid_color');
    }
    for (const display_name of ['', '   ', 'x'.repeat(61), 'Acme\u202Eevil', 'A\u200Bcme', 'Line\nbreak', 'Valetto Pro', 42]) {
      const res = await putBranding(o, { display_name });
      expect(res.status, JSON.stringify(display_name)).toBe(400);
      expect(res.data.error.code).toBe('invalid_display_name');
    }
    for (const display_name of ['Acme\u00ADTables', 'Acme\u2060Tables', 'Acme\uFEFF', 'A\u200Ccme', 'A\u061Ccme', '\u2066Acme\u2069']) {
      const res = await putBranding(o, { display_name });
      expect(res.status, JSON.stringify(display_name)).toBe(400);
      expect(res.data.error.code).toBe('invalid_display_name');
    }
    for (const display_name of VALETTO_VARIANTS) {
      const res = await putBranding(o, { display_name });
      expect(res.status, JSON.stringify(display_name)).toBe(400);
      expect(res.data.error.code).toBe('invalid_display_name');
    }
    expect((await putBranding(o, { display_name: 'Vale Totem' })).status).toBe(200);
    expect((await putBranding(o, { display_name: 'é'.repeat(60) })).status).toBe(200);
    expect((await putBranding(o, { logo_url: 'https://evil.example/x.png' })).status).toBe(400);
  });

  it('is owner-session only and checks origin', async () => {
    const o = await owner();
    const other = await owner();
    expect((await putBranding(o, { display_name: 'X' }, { cookie: other.cookie })).status).toBe(404);
    const byKey = await putBranding(o, { display_name: 'X' }, { bearer: o.agentKey });
    expect(byKey.status).toBe(403);
    expect(byKey.data.error.code).toBe('human_required');
    const anon = await call(putBrandingRoute, url(o), { method: 'PUT', params: { id: o.agentId }, body: {} });
    expect(anon.status).toBe(401);
    const cross = await putBranding(o, { display_name: 'X' }, { headers: { origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    expect(cross.data.error.code).toBe('bad_origin');
  });
});

describe('PUT /api/v1/agents/:id/branding/logo', () => {
  it('re-encodes PNG, JPEG, and WebP to a metadata-free WebP, replaces, and deletes', async () => {
    const o = await owner();
    const first = await putLogo(o, await png(1024, 512), 'image/png');
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    const logoUrl = first.data.branding.logo_url as string;
    expect(logoUrl).toMatch(/^https:\/\/blob\.test\/branding\//);
    const [path1] = [...store.files.keys()];
    const meta = await sharp(store.files.get(path1!)!).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 256 });
    expect(meta.exif).toBeUndefined();

    const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#aa0000' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-location' } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const second = await putLogo(o, jpeg, 'image/jpeg');
    expect(second.status).toBe(200);
    expect(store.deleted).toEqual([path1]);
    const [path2] = [...store.files.keys()];
    const meta2 = await sharp(store.files.get(path2!)!).metadata();
    expect(meta2).toMatchObject({ format: 'webp', width: 300, height: 300 });
    expect(meta2.exif).toBeUndefined();

    const webp = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#00aa00' } }).webp().toBuffer();
    expect((await putLogo(o, webp, 'image/webp')).status).toBe(200);

    const removed = await call(deleteLogoRoute, url(o, true), { method: 'DELETE', cookie: o.cookie, params: { id: o.agentId }, headers: ORIGIN });
    expect(removed.status).toBe(200);
    expect(removed.data.branding.logo_url).toBeNull();
    expect(store.files.size).toBe(0);
  });

  it('rejects disguised, mislabeled, animated, oversized, tiny, huge, and truncated images', async () => {
    const o = await owner();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>');
    expect((await putLogo(o, svg, 'image/png')).data.error.code).toBe('unsupported_image_type');
    expect((await putLogo(o, svg, 'image/svg+xml')).data.error.code).toBe('unsupported_image_type');
    expect((await putLogo(o, Buffer.from('<html><script>x</script></html>'), 'image/png')).status).toBe(415);
    const real = await png(100, 100);
    expect((await putLogo(o, real, 'image/jpeg')).status).toBe(415);
    expect((await putLogo(o, real, 'application/octet-stream')).status).toBe(415);

    const animated = await sharp(
      [await png(80, 80), await sharp({ create: { width: 80, height: 80, channels: 4, background: '#ff0000' } }).png().toBuffer()],
      { join: { animated: true } },
    )
      .webp()
      .toBuffer();
    expect((await putLogo(o, animated, 'image/webp')).data.error.code).toBe('image_animated');

    const big = Buffer.concat([real, Buffer.alloc(600 * 1024)]);
    const tooBig = await putLogo(o, big, 'image/png');
    expect(tooBig.status).toBe(413);
    expect(tooBig.data.error.code).toBe('image_too_large');

    expect((await putLogo(o, await png(32, 32), 'image/png')).data.error.code).toBe('image_dimensions');
    expect((await putLogo(o, await png(3000, 100), 'image/png')).data.error.code).toBe('image_dimensions');

    // A tiny file whose header claims 30000x30000 (a decompression bomb) never gets decoded.
    const bomb = Buffer.from(await png(64, 64));
    bomb.writeUInt32BE(30000, 16);
    bomb.writeUInt32BE(30000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    const bombed = await putLogo(o, bomb, 'image/png');
    expect(bombed.status).toBe(400);
    expect(['image_dimensions', 'image_decode_failed']).toContain(bombed.data.error.code);

    const truncated = (await png(200, 200)).subarray(0, 60);
    const cut = await putLogo(o, Buffer.from(truncated), 'image/png');
    expect(cut.status).toBe(400);
    expect(cut.data.error.code).toBe('image_decode_failed');

    expect(store.files.size).toBe(0);
  });

  it('rate limits uploads per workspace, and checks origin', async () => {
    const o = await owner();
    const cross = await putLogo(o, await png(100, 100), 'image/png', { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    const me = await signIn(o.email);
    await getDb()
      .insert(rateEvents)
      .values(Array.from({ length: BRANDING_LOGO_UPLOADS_PER_HOUR }, () => ({ kind: BRANDING_LOGO_RATE_KIND, email: me.workspace.id })));
    const res = await putLogo(o, await png(100, 100), 'image/png');
    expect(res.status).toBe(429);
    expect(res.data.error.code).toBe('rate_limited');
  });

  it('counts only uploads that reach storage against the rate limit', async () => {
    const o = await owner();
    const me = await signIn(o.email);
    const count = async () =>
      (await getDb().select().from(rateEvents).where(eq(rateEvents.email, me.workspace.id))).filter(
        (row) => row.kind === BRANDING_LOGO_RATE_KIND,
      ).length;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const big = Buffer.concat([await png(100, 100), Buffer.alloc(600 * 1024)]);
    for (let i = 0; i < BRANDING_LOGO_UPLOADS_PER_HOUR + 5; i++) {
      const res = await putLogo(o, i % 3 === 0 ? big : i % 3 === 1 ? svg : await png(10, 10), 'image/png');
      expect([400, 413, 415]).toContain(res.status);
    }
    expect(await count()).toBe(0);
    const ok = await putLogo(o, await png(100, 100), 'image/png');
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    expect(await count()).toBe(1);

    // A storage failure is refunded too.
    const realPut = store.put;
    store.put = async () => {
      throw new Error('blob down');
    };
    const down = await putLogo(o, await png(100, 100), 'image/png');
    expect(down.status).toBeGreaterThanOrEqual(500);
    store.put = realPut;
    expect(await count()).toBe(1);
  });

  it('commits the new logo even when deleting the old blob fails', async () => {
    const o = await owner();
    await putLogo(o, await png(100, 100), 'image/png');
    store.failDelete = true;
    const res = await putLogo(o, await png(120, 120), 'image/png');
    expect(res.status).toBe(200);
    const [row] = await getDb().select().from(agentBranding).where(eq(agentBranding.agentId, o.agentId));
    expect(row!.logoWidth).toBe(120);
  });

  it('removes branding and the logo when the agent is revoked', async () => {
    const o = await owner();
    await putBranding(o, { display_name: 'Acme' });
    await putLogo(o, await png(100, 100), 'image/png');
    const revoked = await call(revokeAgentRoute, `http://localhost/api/v1/agents/${o.agentId}/revoke`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId },
      body: {},
      headers: ORIGIN,
    });
    expect(revoked.status, revoked.text).toBe(200);
    expect(await getDb().select().from(agentBranding).where(eq(agentBranding.agentId, o.agentId))).toEqual([]);
    expect(store.files.size).toBe(0);
  });
});

describe('branding on customer surfaces', () => {
  it('shows on R1, R4, and get_agent_card (public-safe keys only)', async () => {
    const o = await owner();
    await putBranding(o, { display_name: 'Acme Tables', primary_color: '#0A7E8C' });
    await putLogo(o, await png(100, 100), 'image/png');

    const { token } = await createLink(o, { kind: 'personal' });
    const r1 = await call(resolveLink, `http://localhost/api/v1/c/links/${token}`, {
      params: { token },
      headers: { 'x-forwarded-for': `10.8.${Math.floor(Math.random() * 250)}.1` },
    });
    expect(r1.data.bot.branding).toMatchObject({ display_name: 'Acme Tables', primary_color: '#0A7E8C', accent_color: '#0A7E8C' });

    const customer = await approvedCustomer(o);
    const r4 = await call(getBotRoute, `http://localhost/api/v1/c/bots/${o.agentId}`, { cookie: customer.cookie, params: { agent_id: o.agentId } });
    expect(r4.data.bot.branding.logo_url).toMatch(/^https:\/\/blob\.test\//);

    const sender = await senderOf(customer);
    const card = await getAgentCard(
      { workspaceId: customer.workspace.id, agentId: sender.id, agentName: sender.name, keyId: 'test' } as never,
      `@${o.handle}/Grok`,
    );
    const branding = (card as any).branding ?? (card as any).card?.branding;
    expect(Object.keys(branding).sort()).toEqual(
      ['accent_color', 'accent_foreground', 'display_name', 'logo_url', 'primary_color', 'primary_foreground'].sort(),
    );
    expect(branding.display_name).toBe('Acme Tables');
  });
});
