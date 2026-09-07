import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

const HeroPageScene = lazy(() => import('./HeroPageScene'));

/**
 * The landing hero stage: a construction-line reveal, two stippled dot clusters
 * converging from either edge, and "The Highlighted Page" settling into the
 * frame between them — then the whole thing scales and fades out as one unit
 * to hand off to the content beneath.
 *
 * Everything here is cheap DOM/canvas work; the WebGL scene is lazy-loaded so
 * three.js stays out of the first-paint chunk.
 */

/* Stipple runs amber at the inner tip, where the clusters meet the object and
   the warmth ties into the highlighter, and deepens to sepia at the outer edge.
   Flat amber across the whole mass measures ~1.9:1 on cream, at which point the
   dots stop resolving as texture at all. */
const DOT_TIP = '#e9a13a';
const DOT_MID = '#b07038';
const DOT_OUTER = '#4e3626';

const CLUSTER_W = 360;
const CLUSTER_H = 200;
/** Sampling grid in CSS pixels — 5px spacing is the original dot density. */
const DOT_STEP = 5;
/** Below this mask alpha a sample produces no dot, softening the tip edge. */
const DOT_ALPHA_FLOOR = 24;

/** Small deterministic PRNG, so the silhouette is stable across re-renders. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An abstract converging mass: a tapering plume of overlapping soft-edged lobes
 * that breaks into satellites as it reaches inward. Blurred while drawn and
 * faded along its length, so the sampler — which scales dot radius by mask
 * alpha — thins the stipple out naturally instead of clipping it at a hard edge.
 */
function paintClusterMask(mctx: CanvasRenderingContext2D, w: number, h: number) {
  const rand = seededRandom(0x5eed);
  mctx.fillStyle = '#000';
  mctx.filter = 'blur(7px)';

  const LOBES = 18;
  for (let i = 0; i < LOBES; i += 1) {
    const t = i / (LOBES - 1);
    const x = w * (0.01 + t * 0.78) + (rand() - 0.5) * w * 0.03;
    const y = h * (0.5 - t * 0.06)
      + Math.sin(t * Math.PI * 1.1) * h * 0.07
      + (rand() - 0.5) * h * 0.05;
    const rx = Math.max(2, w * (0.14 - t * 0.10) * (0.8 + rand() * 0.45));
    const ry = Math.max(2, h * (0.32 - t * 0.245) * (0.8 + rand() * 0.45));
    mctx.beginPath();
    mctx.ellipse(x, y, rx, ry, (rand() - 0.5) * 0.6, 0, Math.PI * 2);
    mctx.fill();
  }

  // Satellites drifting off the tip toward the object.
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5;
    const r = Math.max(1.5, w * (0.02 - t * 0.013) * (0.7 + rand() * 0.7));
    mctx.beginPath();
    mctx.ellipse(w * (0.8 + t * 0.19), h * (0.47 + (rand() - 0.5) * 0.16), r, r * 1.35, 0, 0, Math.PI * 2);
    mctx.fill();
  }

  mctx.filter = 'none';
  mctx.globalCompositeOperation = 'destination-in';
  const fall = mctx.createLinearGradient(0, 0, w, 0);
  fall.addColorStop(0, 'rgba(0,0,0,1)');
  fall.addColorStop(0.5, 'rgba(0,0,0,.8)');
  fall.addColorStop(1, 'rgba(0,0,0,.22)');
  mctx.fillStyle = fall;
  mctx.fillRect(0, 0, w, h);
  mctx.globalCompositeOperation = 'source-over';
}

function renderDotCluster(canvas: HTMLCanvasElement, mirrored: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(CLUSTER_W * dpr);
  const h = Math.round(CLUSTER_H * dpr);

  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${CLUSTER_W}px`;
  canvas.style.height = `${CLUSTER_H}px`;

  // Paint the shape into an offscreen mask, then sample it on a grid.
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!mctx || !ctx) return;

  mctx.scale(dpr, dpr);
  if (mirrored) {
    mctx.translate(CLUSTER_W, 0);
    mctx.scale(-1, 1);
  }
  paintClusterMask(mctx, CLUSTER_W, CLUSTER_H);

  const data = mctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.round(DOT_STEP * dpr));

  // The tip points inward, so the amber end flips with the mirror.
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  if (mirrored) {
    grad.addColorStop(0, DOT_TIP);
    grad.addColorStop(0.45, DOT_MID);
    grad.addColorStop(1, DOT_OUTER);
  } else {
    grad.addColorStop(0, DOT_OUTER);
    grad.addColorStop(0.55, DOT_MID);
    grad.addColorStop(1, DOT_TIP);
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = grad;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha <= DOT_ALPHA_FLOOR) continue;
      // Jitter position and radius so the grid reads as organic stipple.
      const jitterX = (Math.random() - 0.5) * 2.2 * dpr;
      const jitterY = (Math.random() - 0.5) * 2.2 * dpr;
      const r = (0.9 + Math.random() * 1.5 * (alpha / 255)) * dpr;
      // Per-dot alpha via globalAlpha, since fillStyle is holding the gradient.
      ctx.globalAlpha = (0.55 + Math.random() * 0.35) * (alpha / 255);
      ctx.beginPath();
      ctx.arc(x + jitterX, y + jitterY, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
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

export default function LandingHero3D({
  children,
  wordmark,
}: {
  children: ReactNode;
  /** Oversized backdrop phrase, rendered behind the object. Decorative. */
  wordmark: string;
}) {
  const pinWrapRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<SVGSVGElement>(null);
  const clustersRef = useRef<HTMLDivElement>(null);
  const clusterLeftRef = useRef<HTMLCanvasElement>(null);
  const clusterRightRef = useRef<HTMLCanvasElement>(null);

  const reducedMotion = useReducedMotion();
  const [webglReady] = useState(() => supportsWebGL());
  const [sceneReady, setSceneReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);

  const onSceneReady = useCallback(() => setSceneReady(true), []);

  // Stipple both clusters once, and redraw if DPR changes (monitor swap / zoom).
  useEffect(() => {
    const draw = () => {
      if (clusterLeftRef.current) renderDotCluster(clusterLeftRef.current, false);
      if (clusterRightRef.current) renderDotCluster(clusterRightRef.current, true);
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

  // Warm field that follows the cursor: a lerped radial highlight written to CSS
  // custom properties, low contrast enough to be felt rather than seen.
  useEffect(() => {
    const pin = pinRef.current;
    if (!pin) return undefined;

    if (reducedMotion) {
      pin.style.setProperty('--em-px', '50%');
      pin.style.setProperty('--em-py', '44%');
      return undefined;
    }

    let raf = 0;
    let targetX = 50;
    let targetY = 44;
    let currentX = 50;
    let currentY = 44;

    const onMove = (event: PointerEvent) => {
      const rect = pin.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width) * 100;
      targetY = ((event.clientY - rect.top) / rect.height) * 100;
    };
    const onLeave = () => { targetX = 50; targetY = 44; };
    const tick = () => {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      pin.style.setProperty('--em-px', `${currentX.toFixed(2)}%`);
      pin.style.setProperty('--em-py', `${currentY.toFixed(2)}%`);
      raf = requestAnimationFrame(tick);
    };

    pin.addEventListener('pointermove', onMove);
    pin.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      pin.removeEventListener('pointermove', onMove);
      pin.removeEventListener('pointerleave', onLeave);
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
      // own opacity instead of clobbering it (and so the clusters' entrance
      // animation, which owns `opacity`, can't win the cascade against it).
      const fade = String(Math.max(0, 1 - p * 2.4));
      if (revealRef.current) revealRef.current.style.opacity = fade;
      if (clustersRef.current) clustersRef.current.style.opacity = fade;
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
      <div className="em-hero-pin" ref={pinRef}>
        <div className={`em-hero-inner${stateClass}`} ref={innerRef}>
          <div className="em-hero-bloom" aria-hidden="true" />

          {/* Backdrop phrase — sits behind the object, which renders over it. */}
          <div className="em-hero-wordmark" aria-hidden="true"><span>{wordmark}</span></div>

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

          <div className="em-hero-clusters" ref={clustersRef} aria-hidden="true">
            <canvas className="em-hero-cluster is-left" ref={clusterLeftRef} />
            <canvas className="em-hero-cluster is-right" ref={clusterRightRef} />
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
