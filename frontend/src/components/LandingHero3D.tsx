import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

const HeroPageScene = lazy(() => import('./HeroPageScene'));

/**
 * The landing hero stage: a construction-line reveal, two dot-matrix hands
 * reaching in from either edge, and "The Highlighted Page" settling into the
 * frame between them — then the whole thing scales and fades out as one unit
 * to hand off to the content beneath.
 *
 * Everything here is cheap DOM/canvas work; the WebGL scene is lazy-loaded so
 * three.js stays out of the first-paint chunk.
 */

/**
 * Stylised reaching arm + hand, index finger extended. Stippled into dots
 * rather than stroked, which is the halftone treatment in ref-07/08/09 —
 * inverted to ink-on-cream because this page is paper, not black.
 */
const HAND_PATH_D = `
  M 0,84
  C 45,74 100,68 150,67
  C 195,66 222,68 248,76
  C 262,80 268,72 276,60
  C 288,44 302,32 318,27
  C 333,23 349,25 362,34
  C 376,43 386,55 389,68
  C 391,78 387,86 378,89
  C 368,93 357,89 349,80
  C 340,70 331,61 321,55
  C 313,50 306,52 302,59
  C 298,66 302,72 309,75
  C 302,84 291,91 279,92
  C 270,93 264,88 263,80
  C 262,90 253,97 242,97
  C 233,97 227,91 227,82
  C 221,92 210,96 200,93
  C 192,90 189,83 192,75
  C 182,80 169,81 161,74
  C 154,68 153,59 158,51
  C 146,58 132,60 122,54
  C 113,49 109,39 113,30
  C 96,44 72,52 45,54
  C 28,55 12,52 0,45
  Z
`;

const HAND_W = 400;
const HAND_H = 110;
const HAND_CSS_W = 360;
const HAND_CSS_H = 200;
/** Sampling grid in CSS pixels — 5px spacing is the prototype's dot density. */
const DOT_STEP = 5;

function renderDotHand(canvas: HTMLCanvasElement, mirrored: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(HAND_CSS_W * dpr);
  const h = Math.round(HAND_CSS_H * dpr);

  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${HAND_CSS_W}px`;
  canvas.style.height = `${HAND_CSS_H}px`;

  const offsetX = HAND_CSS_W * 0.5 - HAND_W * 0.42;
  const offsetY = HAND_CSS_H * 0.5 - HAND_H * 0.55;

  // Fill the silhouette into an offscreen mask, then sample it on a grid.
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!mctx || !ctx) return;

  mctx.scale(dpr, dpr);
  if (mirrored) {
    mctx.translate(HAND_CSS_W, 0);
    mctx.scale(-1, 1);
  }
  mctx.translate(offsetX, offsetY);
  mctx.fillStyle = '#000';
  mctx.fill(new Path2D(HAND_PATH_D));

  const data = mctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.round(DOT_STEP * dpr));

  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha <= 40) continue;
      // Jitter position and radius so the grid reads as organic stipple.
      const jitterX = (Math.random() - 0.5) * 2.2 * dpr;
      const jitterY = (Math.random() - 0.5) * 2.2 * dpr;
      const r = (0.9 + Math.random() * 1.5 * (alpha / 255)) * dpr;
      ctx.beginPath();
      ctx.arc(x + jitterX, y + jitterY, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(13,14,14,${0.55 + Math.random() * 0.35})`;
      ctx.fill();
    }
  }
}

function HeroPlaceholder() {
  return (
    <div className="em-hero-placeholder" aria-hidden="true">
      <span className="em-hero-placeholder-card" />
    </div>
  );
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

export default function LandingHero3D({ children }: { children: ReactNode }) {
  const pinWrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<SVGSVGElement>(null);
  const handsRef = useRef<HTMLDivElement>(null);
  const handLeftRef = useRef<HTMLCanvasElement>(null);
  const handRightRef = useRef<HTMLCanvasElement>(null);

  const reducedMotion = useReducedMotion();
  const [webglReady] = useState(() => supportsWebGL());
  const [sceneReady, setSceneReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);

  const onSceneReady = useCallback(() => setSceneReady(true), []);

  // Stipple both hands once, and redraw if DPR changes (monitor swap / zoom).
  useEffect(() => {
    const draw = () => {
      if (handLeftRef.current) renderDotHand(handLeftRef.current, false);
      if (handRightRef.current) renderDotHand(handRightRef.current, true);
    };
    draw();
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener('change', draw);
    return () => media.removeEventListener('change', draw);
  }, []);

  // Kick the reveal on the frame after mount so the initial dash state paints first.
  useEffect(() => {
    if (reducedMotion) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPlaying(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [reducedMotion]);

  // Pause the render loop entirely while the tab is backgrounded.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Scroll hand-off: the hero scales/fades as one unit over ~2x viewport of scroll.
  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      const wrap = pinWrapRef.current;
      const inner = innerRef.current;
      if (!wrap || !inner) return;

      const total = wrap.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const scrolled = -wrap.getBoundingClientRect().top;
      const p = Math.min(1, Math.max(0, scrolled / total));

      inner.style.opacity = String(Math.max(0, 1 - p * 1.3));
      inner.style.transform = `scale(${1 - p * 0.16}) translateY(${p * -30}px)`;

      // Applied to the un-animated parents so it multiplies with each child's
      // own opacity instead of clobbering it (and so the hands' entrance
      // animation, which owns `opacity`, can't win the cascade against it).
      const fade = String(Math.max(0, 1 - p * 2.4));
      if (revealRef.current) revealRef.current.style.opacity = fade;
      if (handsRef.current) handsRef.current.style.opacity = fade;
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const stateClass = reducedMotion ? ' is-static' : (playing ? ' is-playing' : '');

  return (
    <div className="em-hero-pin-wrap" ref={pinWrapRef}>
      <div className="em-hero-pin">
        <div className={`em-hero-inner${stateClass}`} ref={innerRef}>
          <div className="em-hero-copy-block">{children}</div>

          <svg
            className="em-hero-reveal"
            ref={revealRef}
            viewBox="0 0 920 640"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <line className="em-hero-line is-faint" x1="460" y1="230" x2="70" y2="10" pathLength="1" />
            <line className="em-hero-line is-faint" x1="460" y1="230" x2="850" y2="10" pathLength="1" />
            <line className="em-hero-line is-faint" x1="460" y1="410" x2="70" y2="630" pathLength="1" />
            <line className="em-hero-line is-faint" x1="460" y1="410" x2="850" y2="630" pathLength="1" />
            <line className="em-hero-line" x1="460" y1="230" x2="460" y2="40" pathLength="1" />
            <line className="em-hero-line" x1="460" y1="410" x2="460" y2="600" pathLength="1" />
            <rect className="em-hero-frame" x="350" y="150" width="220" height="340" rx="4" pathLength="1" />
          </svg>

          <div className="em-hero-hands" ref={handsRef} aria-hidden="true">
            <canvas className="em-hero-hand is-left" ref={handLeftRef} />
            <canvas className="em-hero-hand is-right" ref={handRightRef} />
          </div>

          <div className="em-hero-stage" aria-hidden="true">
            {webglReady ? (
              <Suspense fallback={<HeroPlaceholder />}>
                <HeroPageScene
                  reducedMotion={reducedMotion}
                  paused={paused}
                  onReady={onSceneReady}
                />
              </Suspense>
            ) : (
              <HeroPlaceholder />
            )}
            {webglReady && !sceneReady ? <HeroPlaceholder /> : null}
          </div>

          <div className="em-hero-chip em-hero-chip-one">
            <span className="em-hero-chip-dot" />
            Answers cite your own sources
          </div>
          <div className="em-hero-chip em-hero-chip-two">
            Your material, indexed
          </div>

          <div className="em-hero-grain" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
