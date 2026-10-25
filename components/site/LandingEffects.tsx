'use client';

import { useEffect } from 'react';

/**
 * Progressive enhancements only; every element is visible and readable before this runs.
 * The task-list status flip, the pinned "how a task works" scenes and the FAQ pane.
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

    // how a task works: pin the section and show one scene at a time, when motion is welcome and the tallest scene fits
    const how = document.querySelector<HTMLElement>('[data-how]');
    const pin = how?.querySelector<HTMLElement>('.how-pin');
    const box = how?.querySelector<HTMLElement>('.scenes');
    const scenes = how ? [...how.querySelectorAll<HTMLElement>('.scene')] : [];
    if (how && pin && box && scenes.length) {
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      let cur = -1;
      let raf = 0;
      let top = 0;
      let band = 1;
      const show = (i: number) => {
        if (i === cur) return;
        cur = i;
        scenes.forEach((s, j) => s.classList.toggle('on', j === i));
      };
      const onScroll = () => {
        if (!how.classList.contains('fx')) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const i = Math.floor((top - how.getBoundingClientRect().top) / band);
          show(Math.max(0, Math.min(scenes.length - 1, i)));
        });
      };
      // keyboard focus inside a faded scene scrolls the track to that scene
      const onFocus = (e: FocusEvent) => {
        const i = scenes.findIndex((s) => s.contains(e.target as Node));
        if (i < 0 || i === cur || !how.classList.contains('fx')) return;
        scrollTo({ top: how.getBoundingClientRect().top + scrollY - top + i * band + 1, behavior: 'instant' });
        show(i);
      };
      // phones stack: with the browser bars, the live slip and a card rarely fit one screen
      const wide = matchMedia('(min-width: 900px)');
      let lastW = 0;
      let lastH = 0;
      const setup = (grew = false) => {
        const was = how.classList.contains('fx');
        if (!grew) {
          lastW = innerWidth;
          lastH = innerHeight;
        }
        how.classList.add('fx');
        how.style.removeProperty('--track');
        const vh = innerHeight;
        const full = pin.offsetHeight;
        const head = box.getBoundingClientRect().top - pin.getBoundingClientRect().top;
        // centre the heading and scene together; if only the scene fits, the heading scrolls off above it
        let on = !motion.matches && wide.matches;
        if (full + 48 <= vh) top = (vh - full) / 2;
        else if (full - head + 32 <= vh) top = 16 - head;
        // the slip grew past the screen while in use (printed errors): stay pinned, bottom on the screen's edge
        else if (grew && was) top = vh - full - 16;
        else on = false;
        if (grew && !was) on = false;
        how.classList.toggle('fx', on);
        if (on) {
          band = 0.8 * vh;
          how.style.setProperty('--pin-top', `${top}px`);
          how.style.setProperty('--track', `${full + scenes.length * band}px`);
          cur = -1;
          onScroll();
        } else scenes.forEach((s) => s.classList.add('on'));
        // the track changes the page height; keep a deep link below it in view
        if (was !== on && location.hash) {
          const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
          if (t && !how.contains(t) && how.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) {
            t.scrollIntoView({ behavior: 'instant' });
          }
        }
      };
      let rt: ReturnType<typeof setTimeout> | undefined;
      const later = (grew: boolean) => {
        clearTimeout(rt);
        rt = setTimeout(() => setup(grew), 150);
      };
      const reset = () => setup();
      // ignore the small height changes of a phone's collapsing address bar
      const onResize = () => {
        if (innerWidth !== lastW || Math.abs(innerHeight - lastH) > 160) later(false);
      };
      // the live slip changes height when it prints a result; re-measure so the pinned block still fits
      let slipH = -1;
      const ro = new ResizeObserver(([e]) => {
        const h = Math.round(e?.contentRect.height ?? 0);
        if (slipH >= 0 && h !== slipH && innerWidth === lastW) later(true);
        slipH = h;
      });
      const slip = how.querySelector('.how-try');
      setup();
      if (slip) ro.observe(slip);
      addEventListener('scroll', onScroll, { passive: true });
      addEventListener('resize', onResize);
      motion.addEventListener('change', reset);
      wide.addEventListener('change', reset);
      how.addEventListener('focusin', onFocus);
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        clearTimeout(rt);
        ro.disconnect();
        removeEventListener('scroll', onScroll);
        removeEventListener('resize', onResize);
        motion.removeEventListener('change', reset);
        wide.removeEventListener('change', reset);
        how.removeEventListener('focusin', onFocus);
        how.classList.remove('fx');
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
