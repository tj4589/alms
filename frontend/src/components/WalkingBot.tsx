import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import WalkingBotFallback from './WalkingBotFallback';
import './WalkingBot.css';

export type WalkingBotSprite = {
  /** Transparent horizontal sheet: eight walk frames, neutral, then turn. */
  src: string;
  frameWidth: number;
  frameHeight: number;
  /** Distance covered by one eight-frame cycle, in source-image pixels. */
  strideLength: number;
};

export type WalkingBotProps = {
  className?: string;
  size?: 'small' | 'medium' | 'large';
  /** Seconds for a 500px journey; shorter lanes take proportionately less time. */
  travelDuration?: number;
  pauseDuration?: number;
  initialDirection?: 'left' | 'right';
  decorative?: boolean;
  label?: string;
  sprite?: WalkingBotSprite;
};

const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export default function WalkingBot({
  className = '', size = 'medium', travelDuration = 8, pauseDuration = 0.5,
  initialDirection = 'left', decorative = true, label = 'Maxe, your study companion', sprite,
}: WalkingBotProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const facingRef = useRef<HTMLSpanElement>(null);
  const validSprite = sprite && sprite.frameWidth > 0 && sprite.frameHeight > 0 && sprite.strideLength > 0 ? sprite : undefined;
  const source = validSprite?.src;
  const frameWidth = validSprite?.frameWidth;
  const frameHeight = validSprite?.frameHeight;
  const strideLength = validSprite?.strideLength;

  useEffect(() => {
    const stage = stageRef.current;
    const track = trackRef.current;
    const facing = facingRef.current;
    if (!stage || !track || !facing) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Set<Animation>();
    let visible = false;
    let generation = 0;
    let lastWidth = -1;
    let lastBotWidth = -1;

    const syncPause = () => {
      const paused = !visible || document.hidden || media.matches;
      stage.dataset.paused = String(paused);
      animations.forEach(animation => paused ? animation.pause() : animation.play());
    };
    const run = async (element: HTMLElement, frames: Keyframe[], duration: number) => {
      const animation = element.animate(frames, { duration, fill: 'forwards' });
      animations.add(animation);
      syncPause();
      try {
        await animation.finished;
        animation.commitStyles();
      } finally {
        animations.delete(animation);
        animation.cancel();
      }
    };
    const restart = () => {
      const current = ++generation;
      animations.forEach(animation => animation.cancel());
      animations.clear();
      const distance = Math.max(0, stage.clientWidth - track.offsetWidth - 16);
      const botHeight = track.offsetHeight;
      const pixelsPerSecond = 500 / positive(travelDuration, 8);
      const spriteStride = source && frameHeight && strideLength ? strideLength * botHeight / frameHeight : botHeight * 0.34;
      // Whole gait cycles per crossing avoid stopping halfway through a step.
      const cycles = Math.max(1, Math.round(distance / spriteStride));
      const duration = distance / pixelsPerSecond * 1000;
      const cycleDuration = duration / cycles;
      // Contact lasts half a cycle. Match the middle 76% of travel, which
      // covers 84% of the lane, so the planted foot counters that speed.
      const halfStride = distance / cycles * (.84 / .76) / 4;
      stage.style.setProperty('--walking-bot-cycle', `${cycleDuration}ms`);
      stage.style.setProperty('--walking-bot-half-stride', `${halfStride}px`);
      // The fallback SVG renders at 1.44 times the character box width.
      stage.style.setProperty('--walking-bot-leg-travel', `${halfStride / (track.offsetWidth * 1.44 / 640)}px`);
      stage.dataset.phase = 'rest';
      track.style.transform = `translate3d(${initialDirection === 'left' ? distance : 0}px,0,0)`;
      facing.style.transform = `scaleX(${initialDirection === 'left' ? 1 : -1})`;
      syncPause();
      if (media.matches || distance < botHeight * 0.4) return;

      const loop = async () => {
        let left = initialDirection === 'left';
        while (current === generation) {
          const from = left ? distance : 0;
          const to = left ? 0 : distance;
          stage.dataset.phase = 'walk';
          await run(track, [
            { transform: `translate3d(${from}px,0,0)`, easing: 'cubic-bezier(.42,0,1,1)', offset: 0 },
            { transform: `translate3d(${from + (to - from) * .08}px,0,0)`, offset: .12 },
            { transform: `translate3d(${from + (to - from) * .92}px,0,0)`, easing: 'cubic-bezier(0,0,.58,1)', offset: .88 },
            { transform: `translate3d(${to}px,0,0)`, offset: 1 },
          ], duration);
          if (current !== generation) return;
          stage.dataset.phase = 'rest';
          await run(track, [], positive(pauseDuration, .5) * 1000);
          if (current !== generation) return;
          stage.dataset.phase = 'turn';
          const sign = left ? 1 : -1;
          await run(facing, [
            { transform: `scaleX(${sign}) translateY(0)` },
            { transform: `scaleX(${sign * .88}) translateY(1px)`, offset: .25 },
            { transform: 'scaleX(.12) translateY(1px)', offset: .5 },
            { transform: `scaleX(${-sign}) translateY(0)` },
          ], 340);
          left = !left;
        }
      };
      void loop().catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('WalkingBot animation failed', error);
      });
    };
    const resize = new ResizeObserver(() => {
      if (stage.clientWidth === lastWidth && track.offsetWidth === lastBotWidth) return;
      lastWidth = stage.clientWidth;
      lastBotWidth = track.offsetWidth;
      restart();
    });
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      syncPause();
    }, { threshold: .05 });
    resize.observe(stage);
    resize.observe(track);
    intersection.observe(stage);
    document.addEventListener('visibilitychange', syncPause);
    media.addEventListener('change', restart);
    return () => {
      generation++;
      animations.forEach(animation => animation.cancel());
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', syncPause);
      media.removeEventListener('change', restart);
    };
  }, [travelDuration, pauseDuration, initialDirection, source, frameWidth, frameHeight, strideLength]);

  const style = validSprite ? {
    '--walking-bot-ratio': `${validSprite.frameWidth} / ${validSprite.frameHeight}`,
    '--walking-bot-sheet': `url(${JSON.stringify(validSprite.src)})`,
  } as CSSProperties : undefined;

  return (
    <div ref={stageRef} className={`walking-bot walking-bot--${size} ${className}`.trim()}
      style={style} data-phase="rest" data-paused="true" data-asset={validSprite ? 'sprite' : 'fallback'}
      aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label}>
      <span ref={trackRef} className="walking-bot__track">
        <span className="walking-bot__shadow" />
        <span ref={facingRef} className="walking-bot__facing">
          {validSprite ? <span className="walking-bot__sprite" /> : <WalkingBotFallback />}
        </span>
      </span>
    </div>
  );
}
