'use client';

import { useEffect } from 'react';

/**
 * Progressive enhancements only; every element is visible and readable before this runs.
 * Scroll reveals, the tagline words, the task-list status flip, the pinned "how a task works" stage and the FAQ pane.
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

    // scroll reveals: sections fade up as they enter; anything already on screen is shown at once.
    // The page is only marked (.rv) here, so without script nothing is ever hidden.
    const root = document.querySelector<HTMLElement>('.landing');
    if (root && !reduce) {
      const vh = innerHeight;
      const shown = (el: Element) => el.getBoundingClientRect().top < vh * 0.92;
      const rvs = [...document.querySelectorAll<HTMLElement>('.reveal')];
      const words = [...document.querySelectorAll<HTMLElement>('.tag-lines .w')];
      rvs.filter(shown).forEach((el) => el.classList.add('in'));
      words.filter((w) => w.getBoundingClientRect().top < vh * 0.6).forEach((w) => w.classList.add('on'));
      root.classList.add('rv');
      const ro = new IntersectionObserver(
        (es) => {
          for (const e of es)
            if (e.isIntersecting || e.boundingClientRect.bottom < 0) {
              e.target.classList.add('in');
              ro.unobserve(e.target);
            }
        },
        { rootMargin: '0px 0px -8% 0px' },
      );
      rvs.filter((el) => !el.classList.contains('in')).forEach((el) => ro.observe(el));
      // tagline: each word lights as it crosses a line 40% up the screen; words crossing together are staggered in reading order
      const wo = new IntersectionObserver(
        (es) => {
          const hits = es
            .filter((e) => e.isIntersecting || e.boundingClientRect.bottom < 0)
            .map((e) => e.target as HTMLElement);
          hits.sort((x, y) => words.indexOf(x) - words.indexOf(y));
          hits.forEach((w, i) => {
            w.style.transitionDelay = `${i * 90}ms`;
            w.classList.add('on');
            wo.unobserve(w);
          });
        },
        { rootMargin: '0px 0px -40% 0px' },
      );
      words.filter((w) => !w.classList.contains('on')).forEach((w) => wo.observe(w));
      cleanups.push(() => {
        ro.disconnect();
        wo.disconnect();
        root.classList.remove('rv');
      });
    }

    // pinned stage
    const steps = [...document.querySelectorAll<HTMLElement>('.steps li')];
    const frames = [...document.querySelectorAll<HTMLElement>('.frame > pre')];
    const caps = ['builder → relay', 'reviewer → relay', 'reviewer → relay'];
    const cap = document.getElementById('stage-cap');
    const setStep = (i: number) => {
      steps.forEach((s, j) => s.classList.toggle('on', j === i));
      frames.forEach((f, j) => f.classList.toggle('cur', j === i));
      if (cap) cap.textContent = caps[i] ?? '';
    };
    const so = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.forEach((s) => so.observe(s));
    cleanups.push(() => so.disconnect());

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
