// The portrait loop is a 2x capture of the narrow card at 338px wide, and the card's pad of slips peeks out 12px to
// its left. hero-flow.css lays the narrow card out at exactly that width and zooms it by --hero-zoom, so on stages
// narrower than 350px (phones under 390) the whole card shrinks in proportion and keeps the loop's shape.
const STAGE = 338 + 12;

export function setHeroZoom(stage: HTMLElement) {
  document.documentElement.style.setProperty('--hero-zoom', String(Math.min(1, stage.clientWidth / STAGE)));
}

// The same, run inline at the end of the card on first load, so the card has its final size before the first paint.
export const HERO_ZOOM_SCRIPT = `(function(s){var p=s&&s.parentElement&&s.parentElement.parentElement;if(p)document.documentElement.style.setProperty('--hero-zoom',String(Math.min(1,p.clientWidth/${STAGE})))})(document.currentScript)`;
