'use client';

import { useEffect } from 'react';

/**
 * Plays each [data-play] block once when it is a third in view. Content is visible without this script:
 * .anim (added here, only when motion is welcome) hides the words until .play starts them. No scroll locking.
 */
export function ValettoEffects() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = [...document.querySelectorAll<HTMLElement>('[data-play]')];
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('play');
          io.unobserve(e.target);
        }),
      { threshold: 0.35 },
    );
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.65 && r.bottom > 0) return; // already in view on load: leave it at rest
      el.classList.add('anim');
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return null;
}
