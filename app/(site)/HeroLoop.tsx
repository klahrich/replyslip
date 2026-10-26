'use client';

import { useEffect, useRef, useState } from 'react';
import { setHeroZoom } from './hero-zoom';

// Two loops, each a 2x capture of one card layout's border box: the wide row at 546x340 and the narrow top-to-bottom
// card at 338x351. hero-flow.css holds the card at the matching shape in each layout (the narrow one zoomed down on
// small phones), so a loop is only shown on a card of its own shape.
const LOOPS = {
  wide: { aspect: 1092 / 680, name: 'hero-loop', poster: 'hero-poster' },
  tall: { aspect: 676 / 702, name: 'hero-loop-portrait', poster: 'hero-poster-portrait' },
} as const;
type Shape = keyof typeof LOOPS;
const FIT = 0.01;

/**
 * Progressive enhancement for HeroFlow: once the page has loaded, lays a short video loop of the same card over it.
 * The still card stays underneath and is all you get without JS, with reduced motion, with Save-Data on, until the
 * video is actually playing (autoplay can be refused, e.g. by a data saver), if it fails, or while the card is
 * neither of the shapes the loops were drawn at (mid-resize).
 */
export function HeroLoop() {
  const ref = useRef<HTMLVideoElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);

  // keeps the narrow card's zoom in step with its stage (the inline script in the card set it for the first paint)
  useEffect(() => {
    const stage = document.querySelector<HTMLElement>('[data-hero-card]')?.parentElement;
    if (!stage) return;
    const ro = new ResizeObserver(() => setHeroZoom(stage));
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // fetch nothing until the page has loaded (never competes with LCP), then the loop for the card's current shape;
  // a layout change (rotating a tablet) swaps it
  useEffect(() => {
    const card = document.querySelector<HTMLElement>('[data-hero-card]');
    if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches || saveData()) return;
    let wait = 0;
    const ro = new ResizeObserver(() => {
      const now = shapeOf(card);
      if (now) setShape(now);
    });
    const start = () => {
      wait = window.setTimeout(() => ro.observe(card), 200);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      clearTimeout(wait);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    const card = video?.parentElement;
    if (!shape || !video || !card) return;
    let playing = false;
    let dead = false;
    // shown only while it is really playing, so a refused or stalled autoplay leaves the still card in place
    const sync = () => {
      if (dead || shapeOf(card) !== shape) {
        delete card.dataset.loop;
        video.pause();
        return;
      }
      if (playing) card.dataset.loop = card.dataset.loop === 'on' ? 'on' : 'in';
      else void video.play().catch(() => undefined);
    };
    const onReady = () => sync();
    const onPlaying = () => {
      playing = true;
      sync();
    };
    const onPause = () => {
      playing = false;
    };
    // the video is over the card and opaque once its fade ends; only then hide the card's own ink and motion
    const onFaded = (e: TransitionEvent) => {
      if (e.propertyName === 'opacity' && card.dataset.loop === 'in')
        card.dataset.loop = 'on';
    };
    const onError = () => {
      dead = true;
      sync();
    };
    const sources = video.querySelectorAll('source');
    const last = sources[sources.length - 1];
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('transitionend', onFaded);
    video.addEventListener('error', onError);
    last?.addEventListener('error', onError);
    const ro = new ResizeObserver(sync);
    ro.observe(card);
    return () => {
      ro.disconnect();
      video.removeEventListener('canplaythrough', onReady);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('transitionend', onFaded);
      video.removeEventListener('error', onError);
      last?.removeEventListener('error', onError);
      delete card.dataset.loop;
    };
  }, [shape]);

  if (!shape) return null;
  const loop = LOOPS[shape];
  return (
    <video
      key={shape}
      ref={ref}
      className='flow-loop'
      aria-hidden='true'
      tabIndex={-1}
      autoPlay
      muted
      loop
      playsInline
      preload='auto'
      poster={`/hero/${loop.poster}.png`}
      disablePictureInPicture
      disableRemotePlayback
    >
      {/* WebM is half the size; Safari gets the H.264 MP4 it decodes in hardware */}
      {apple() ? null : <source src={`/hero/${loop.name}.webm`} type='video/webm' />}
      <source src={`/hero/${loop.name}.mp4`} type='video/mp4' />
    </video>
  );
}

function saveData() {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

function apple() {
  return navigator.vendor.startsWith('Apple');
}

function shapeOf(card: HTMLElement): Shape | null {
  const r = card.getBoundingClientRect();
  if (!r.height) return null;
  const k = r.width / r.height;
  return (Object.keys(LOOPS) as Shape[]).find((s) => Math.abs(k / LOOPS[s].aspect - 1) < FIT) ?? null;
}
