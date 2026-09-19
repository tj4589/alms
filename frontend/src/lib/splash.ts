// The splash is markup in index.html, not a React component, because what it
// covers is React arriving. This dismisses it once the app has actually
// painted something.

const SPLASH_ID = 'em-splash';

// A splash that appears and vanishes inside one frame reads as a flicker, so
// it is held briefly. Short enough not to be a wait the app invented; long
// enough that the eye registers one thing rather than a glitch.
const MINIMUM_VISIBLE_MS = 400;

const FADE_MS = 260;

export function dismissSplash(): void {
  const splash = document.getElementById(SPLASH_ID);
  if (!splash) return;

  const shownAt = Number(splash.dataset.shownAt || '0');
  const elapsed = shownAt ? Date.now() - shownAt : MINIMUM_VISIBLE_MS;
  const hold = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);

  window.setTimeout(() => {
    splash.classList.add('is-gone');
    const remove = () => splash.remove();
    splash.addEventListener('transitionend', remove, { once: true });
    // transitionend does not fire when motion is reduced, or if the element
    // is never composited, so the removal does not depend on it.
    window.setTimeout(remove, FADE_MS + 120);
  }, hold);
}

/**
 * Waits for the browser to have painted before dismissing.
 *
 * React's render call returns before the commit is on screen, so dismissing
 * straight after it can uncover a blank frame. Two frames is the usual way to
 * land after paint.
 */
export function dismissSplashAfterPaint(): void {
  window.requestAnimationFrame(() => window.requestAnimationFrame(dismissSplash));
}
