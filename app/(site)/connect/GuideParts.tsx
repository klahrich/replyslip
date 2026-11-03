import type { ReactNode } from 'react';

/** Pieces shared by the connect guides (/connect and /connect/meta-muse). */

export const MCP_URL = 'https://valetto.tech/api/mcp';

export function Mini({ items }: { items: ReactNode[] }) {
  return (
    <ol className="cx-mini">
      {items.map((it, i) => (
        <li key={i}>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  );
}

export function Shot({
  src,
  alt,
  w,
  h,
  children,
  wide,
  caption,
}: {
  src: string;
  alt: string;
  w: number;
  h: number;
  children?: ReactNode;
  wide?: boolean;
  caption?: ReactNode;
}) {
  return (
    <figure className={wide ? 'cx-shot cx-shot-wide' : 'cx-shot'}>
      <div className="cx-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static screenshots, served as-is */}
        <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" />
        {children}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function Dot({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <span className="cx-dot" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
      {n}
    </span>
  );
}

/** The dashboard's Connected apps list, with a marker on Revoke. A narrow version swaps in on phones. */
export function ConnectedAppsShot() {
  return (
    <figure className="cx-shot cx-shot-wide cx-apps-shot">
      <div className="cx-frame">
        <picture>
          <source
            media="(max-width: 560px)"
            srcSet="/connect/step6-connected-apps-mobile.webp"
            width={700}
            height={1060}
          />
          <img
            src="/connect/step6-connected-apps.webp"
            width={1560}
            height={554}
            loading="lazy"
            decoding="async"
            alt="The Connected apps list in the Valetto dashboard with three sample rows: Cursor, marked Unverified, ChatGPT and Claude. Each row shows its agent, when it connected, when it was last used, when it expires, and a Revoke link."
          />
        </picture>
        <span className="cx-dot cx-dot-revoke" aria-hidden="true">
          1
        </span>
      </div>
      <figcaption>
        <span className="cx-dot cx-dot-inline" aria-hidden="true">
          1
        </span>{' '}
        Revoke cuts an app off. You can connect it again any time.
      </figcaption>
    </figure>
  );
}
