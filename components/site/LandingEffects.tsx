'use client';

import { useEffect } from 'react';

/**
 * Progressive enhancements only; every element is visible and readable before this runs.
 * The task-list status flip, the "how a task works" rows fading in and the FAQ pane.
 */
export function LandingEffects() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // task list: once in view, the open task quietly becomes done, then rests on open
    const flip = document.getElementById('flip');
    if (flip && !reduce) {
      let t: ReturnType<typeof setTimeout> | undefined;
      let n = 0;
      let seen = false;
      const loop = () => {
        flip.classList.toggle('flip');
        if (++n < 4) t = setTimeout(loop, 4200);
      };
      const fo = new IntersectionObserver(
        (es) => {
          if (seen || !es.some((e) => e.isIntersecting)) return;
          seen = true;
          fo.disconnect();
          t = setTimeout(loop, 1200);
        },
        { threshold: 0.6 },
      );
      fo.observe(flip);
      const onVis = () => {
        clearTimeout(t);
        if (seen && !document.hidden && n < 4) t = setTimeout(loop, 1200);
      };
      document.addEventListener('visibilitychange', onVis);
      cleanups.push(() => {
        clearTimeout(t);
        fo.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        flip.classList.remove('flip');
      });
    }

    // how a task works: rows below the fold wait hidden, then fade in once as they scroll into view
    const rows = [...document.querySelectorAll<HTMLElement>('[data-how] .scene')];
    if (rows.length && !reduce) {
      const ro = new IntersectionObserver(
        (es) => {
          for (const e of es) {
            if (!e.isIntersecting) continue;
            e.target.classList.remove('hid');
            ro.unobserve(e.target);
          }
        },
        { threshold: 0.2, rootMargin: '0px 0px -5% 0px' },
      );
      // rows already on screen or above it (an anchor jump, a reload mid-page) stay as they are
      for (const r of rows) {
        if (r.getBoundingClientRect().top < innerHeight * 0.9) continue;
        r.classList.add('hid');
        ro.observe(r);
      }
      cleanups.push(() => {
        ro.disconnect();
        rows.forEach((r) => r.classList.remove('hid'));
      });
    }

    // faq: index on the left, one answer in the pane (wide screens)
    const pane = document.getElementById('faq-pane');
    const ds = [...document.querySelectorAll<HTMLDetailsElement>('.faq details')];
    if (pane && ds.length) {
      const wide = matchMedia('(min-width: 900px)');
      let fadeT: ReturnType<typeof setTimeout> | undefined;
      const select = (d: HTMLDetailsElement) => {
        ds.forEach((x) => x.classList.toggle('sel', x === d));
        pane.classList.add('fade');
        clearTimeout(fadeT);
        fadeT = setTimeout(
          () => {
            pane.innerHTML = d.querySelector('.ans')?.innerHTML ?? '';
            pane.classList.remove('fade');
          },
          reduce ? 0 : 150,
        );
      };
      const setup = () => {
        if (wide.matches) {
          pane.hidden = false;
          pane.removeAttribute('aria-hidden');
          pane.setAttribute('aria-live', 'polite');
          ds.forEach((d) => (d.open = false));
          select(ds.find((d) => d.classList.contains('sel')) ?? ds[0]!);
        } else {
          pane.hidden = true;
          ds.forEach((d) => d.classList.remove('sel'));
        }
      };
      const offs = ds.map((d) => {
        const s = d.querySelector('summary')!;
        const onClick = (e: Event) => {
          if (wide.matches) {
            e.preventDefault();
            select(d);
          } else {
            ds.forEach((x) => {
              if (x !== d) x.open = false;
            });
          }
        };
        const onHover = () => {
          if (wide.matches) select(d);
        };
        s.addEventListener('click', onClick);
        s.addEventListener('mouseenter', onHover);
        s.addEventListener('focus', onHover);
        return () => {
          s.removeEventListener('click', onClick);
          s.removeEventListener('mouseenter', onHover);
          s.removeEventListener('focus', onHover);
        };
      });
      wide.addEventListener('change', setup);
      setup();
      cleanups.push(() => {
        clearTimeout(fadeT);
        wide.removeEventListener('change', setup);
        offs.forEach((off) => off());
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
