'use client';

import { useEffect } from 'react';

/**
 * Scroll reveals, the hero status flip, the pinned "how a task works" stage,
 * the tools row and the FAQ pane. Ported from the static draft's inline script.
 */
export function LandingEffects() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // reveals
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es)
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    // hero exhibit: the open task quietly becomes done, then rests on open
    const flip = document.getElementById('flip');
    if (flip && !reduce) {
      let t: ReturnType<typeof setTimeout> | undefined;
      let n = 0;
      const loop = () => {
        flip.classList.toggle('flip');
        if (++n < 4) t = setTimeout(loop, 5600);
      };
      t = setTimeout(loop, 3200);
      const onVis = () => {
        clearTimeout(t);
        if (!document.hidden && n < 4) t = setTimeout(loop, 3200);
      };
      document.addEventListener('visibilitychange', onVis);
      cleanups.push(() => {
        clearTimeout(t);
        document.removeEventListener('visibilitychange', onVis);
        flip.classList.remove('flip');
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

    // tools row: light the panel at the start of the row
    const row = document.getElementById('tool-row');
    const prev = document.getElementById('tool-prev');
    const next = document.getElementById('tool-next');
    if (row && prev && next) {
      const tools = [...row.querySelectorAll<HTMLElement>('.tool')];
      let lit = 0;
      let raf = 0;
      const light = (i: number) => {
        lit = i;
        tools.forEach((t, j) => t.classList.toggle('lit', j === i));
      };
      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const x = row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).scrollPaddingLeft || '0');
          let best = 0;
          let d = Infinity;
          tools.forEach((t, j) => {
            const dd = Math.abs(t.getBoundingClientRect().left - x);
            if (dd < d) {
              d = dd;
              best = j;
            }
          });
          if (best !== lit) light(best);
        });
      };
      const go = (i: number) => {
        const k = Math.max(0, Math.min(tools.length - 1, i));
        tools[k]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'start' });
        light(k);
      };
      const onPrev = () => go(lit - 1);
      const onNext = () => go(lit + 1);
      row.addEventListener('scroll', onScroll, { passive: true });
      prev.addEventListener('click', onPrev);
      next.addEventListener('click', onNext);
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        row.removeEventListener('scroll', onScroll);
        prev.removeEventListener('click', onPrev);
        next.removeEventListener('click', onNext);
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
