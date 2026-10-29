'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { brandStyle, initials } from '../_lib/brand';
import type { Branding } from '../_lib/types';
import { cn } from '../_lib/utils';

export function LogoTile({ branding, size = 44, className }: { branding: Branding; size?: number; className?: string }) {
  const radius = Math.round(size * 0.24);
  if (branding.logo_url) {
    return (
      // Logos are our own re-encoded WebP on a separate origin (spec 13.5); next/image adds nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logo_url}
        alt=""
        width={size}
        height={size}
        className={cn('shrink-0 object-cover shadow-sm ring-1 ring-black/5', className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center bg-primary font-semibold text-primary-foreground shadow-sm', className)}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.36) }}
    >
      {initials(branding.display_name)}
    </span>
  );
}

/** Neutral frame used before branding is known, or when a link is dead. */
export function PlainFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pt-10 pb-6 sm:px-6 sm:pt-16">{children}</main>
      <ValettoFooter />
    </div>
  );
}

export function ValettoFooter() {
  return (
    <footer className="px-4 pt-6 pb-8 text-center text-[13px] text-muted-foreground">
      <a href="https://valetto.ai" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 hover:text-foreground">
        <span>via</span>
        <span className="font-semibold tracking-tight text-foreground/80">Valetto</span>
      </a>
    </footer>
  );
}

/** Branded page: a slim header with the owner's logo and name, a centered column, and the Valetto footer. */
export function BrandFrame({
  branding,
  agentId,
  account,
  children,
  wide = false,
}: {
  branding: Branding;
  agentId?: string;
  account?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const name = (
    <span className="flex min-w-0 items-center gap-3">
      <LogoTile branding={branding} size={40} />
      <span className="truncate text-[17px] font-semibold tracking-tight">{branding.display_name}</span>
    </span>
  );
  return (
    <div className="flex min-h-dvh flex-col" style={brandStyle(branding)}>
      <div aria-hidden className="h-1 w-full bg-primary" />
      <header className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className={cn('mx-auto flex h-16 w-full items-center justify-between gap-3 px-4 sm:px-6', wide ? 'max-w-[720px]' : 'max-w-[560px]')}>
          {agentId ? (
            <Link href={`/c/${agentId}`} className="-mx-1 min-w-0 rounded-lg px-1 py-1">
              {name}
            </Link>
          ) : (
            name
          )}
          {account}
        </div>
      </header>
      <main className={cn('mx-auto flex w-full flex-1 flex-col px-4 pt-6 pb-6 sm:px-6 sm:pt-10', wide ? 'max-w-[720px]' : 'max-w-[560px]')}>{children}</main>
      {branding.show_footer && <ValettoFooter />}
    </div>
  );
}
