'use client';

import { useEffect, useRef } from 'react';

// Each light drifts on two layered sines per axis with incommensurate periods (seconds), so the path never visibly repeats.
const PATHS = [
  { ax: [80, 32], px: [23, 37], ay: [52, 22], py: [31, 44], phase: 0.0, breathe: 35 },
  { ax: [92, 34], px: [29, 19], ay: [60, 26], py: [37, 26], phase: 2.1, breathe: 33 },
  { ax: [64, 26], px: [21, 43], ay: [46, 20], py: [41, 24], phase: 4.3, breathe: 39 },
];
const TAU = 2 * Math.PI;
const PULL = 0.08; // share of the light-to-cursor distance a light leans by
const MAX_PULL = 140; // px
const FOLLOW = 1.4; // s, time constant toward the cursor
const SETTLE = 4; // s, time constant back to rest
const IDLE = 1500; // ms without pointer movement before lights return to rest

/** The hero's sage lights, moved by one rAF loop (transform and opacity only). */
export function GlowBg() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = root.current;
    if (!layer || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = [...layer.querySelectorAll<HTMLElement>('.g')];
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const stage = document.querySelector<HTMLElement>('[data-hero-demo]');
    const rest = els.map(() => ({ x: 0, y: 0 }));
    const pull = els.map(() => ({ x: 0, y: 0 }));
    const measure = () =>
      els.forEach((el, i) => {
        rest[i].x = el.offsetLeft + el.offsetWidth / 2;
        rest[i].y = el.offsetTop + el.offsetHeight / 2;
      });
    measure();

    let px = 0, py = 0, lastMove = -Infinity, boost = 0, boostTo = 0;
    const t0 = performance.now() - Math.random() * 60000; // random start point on the path
    let raf = 0, last = 0, visible = true;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const active = fine && now - lastMove < IDLE;
      const k = 1 - Math.exp(-dt / (active ? FOLLOW : SETTLE));
      boost += (boostTo - boost) * (1 - Math.exp(-dt / 1.2));
      els.forEach((el, i) => {
        const p = PATHS[i], r = rest[i], q = pull[i];
        let tx = 0, ty = 0;
        if (active) {
          tx = Math.max(-MAX_PULL, Math.min(MAX_PULL, (px - r.x) * PULL));
          ty = Math.max(-MAX_PULL, Math.min(MAX_PULL, (py - r.y) * PULL));
        }
        q.x += (tx - q.x) * k;
        q.y += (ty - q.y) * k;
        const dx = p.ax[0] * Math.sin((TAU * t) / p.px[0] + p.phase) + p.ax[1] * Math.sin((TAU * t) / p.px[1] + p.phase * 1.7);
        const dy = p.ay[0] * Math.cos((TAU * t) / p.py[0] + p.phase) + p.ay[1] * Math.sin((TAU * t) / p.py[1] + p.phase * 0.6);
        const s = 1 + 0.06 * Math.sin((TAU * t) / p.breathe + p.phase);
        el.style.transform = `translate3d(${(dx + q.x).toFixed(1)}px,${(dy + q.y).toFixed(1)}px,0) scale(${s.toFixed(3)})`;
        el.style.opacity = (0.86 + 0.14 * Math.sin((TAU * t) / (p.breathe * 0.77) + p.phase) + (i === 1 ? 0.25 : 0.12) * boost).toFixed(3);
      });
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      const on = visible && !document.hidden;
      layer.classList.toggle('lp-idle', !on); // pauses the CSS band drift offscreen
      if (on) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(layer);
    const onVis = () => run();
    const onMove = (e: PointerEvent) => {
      const b = layer.getBoundingClientRect();
      px = e.clientX - b.left;
      py = e.clientY - b.top;
      lastMove = performance.now();
    };
    const onLeave = () => (lastMove = -Infinity);
    const onFocusIn = () => (boostTo = 1);
    const onFocusOut = () => (boostTo = 0);
    let rt: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(measure, 150);
    };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('resize', onResize);
    if (fine) {
      addEventListener('pointermove', onMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
    }
    stage?.addEventListener('focusin', onFocusIn);
    stage?.addEventListener('focusout', onFocusOut);
    run();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rt);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('resize', onResize);
      removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      stage?.removeEventListener('focusin', onFocusIn);
      stage?.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return (
    <div className="lp-bg" ref={root} aria-hidden="true">
      <i className="g g1" />
      <i className="g g2" />
      <i className="g g3" />
      <i className="st" />
    </div>
  );
}
