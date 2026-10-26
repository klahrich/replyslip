'use client';

import { useEffect, useRef, useState } from 'react';

// The loop is a 2x capture of the wide card's border box at 546x340, so it only fits a card of that shape. hero-flow.css
// holds the card at that shape wherever it is the wide row (desktop and tablets); phones keep the narrow card.
const LOOP_ASPECT = 1092 / 680;
const FIT = 0.01;

/**
 * Progressive enhancement for HeroFlow: once the page has loaded, lays a short video loop of the same card over it.
 * The still card stays underneath and is all you get without JS, with reduced motion, with Save-Data on, until the
 * video is actually playing (autoplay can be refused, e.g. by a data saver), if it fails, or when the card is not the
 * wide 546x340 shape the loop was drawn at (the narrow top-to-bottom layout, phones).
 */
export function HeroLoop() {
  const ref = useRef<HTMLVideoElement>(null);
  const [load, setLoad] = useState(false);

  // fetch nothing until the page has loaded (never competes with LCP), and only for a card the loop fits
  useEffect(() => {
    const card = document.querySelector<HTMLElement>('[data-hero-card]');
    if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches || saveData()) return;
    let wait = 0;
    const ro = new ResizeObserver(() => {
      if (!fits(card)) return;
      ro.disconnect();
      setLoad(true);
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
    if (!load || !video || !card) return;
    let playing = false;
    let dead = false;
    // shown only while it is really playing, so a refused or stalled autoplay leaves the still card in place
    const sync = () => {
      if (dead || !fits(card)) {
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
  }, [load]);

  if (!load) return null;
  return (
    <video
      ref={ref}
      className='flow-loop'
      aria-hidden='true'
      tabIndex={-1}
      autoPlay
      muted
      loop
      playsInline
      preload='auto'
      poster='/hero/hero-poster.png'
      disablePictureInPicture
      disableRemotePlayback
    >
      {/* WebM is half the size; Safari gets the H.264 MP4 it decodes in hardware */}
      {apple() ? null : <source src='/hero/hero-loop.webm' type='video/webm' />}
      <source src='/hero/hero-loop.mp4' type='video/mp4' />
    </video>
  );
}

function saveData() {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

function apple() {
  return navigator.vendor.startsWith('Apple');
}

function fits(card: HTMLElement) {
  const r = card.getBoundingClientRect();
  return r.height > 0 && Math.abs(r.width / r.height / LOOP_ASPECT - 1) < FIT;
}
