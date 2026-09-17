import { forwardRef, useEffect, useRef, useState } from 'react';
import MaxeMark from './MaxeMark';

type MaxeTriggerProps = {
  open: boolean;
  onOpen: () => void;
};

// Maxe stands on the bottom edge of the viewport with no card behind him.
// The crop is a transparent window, so at rest only what sits above the edge
// shows. Geometry comes from MaxeMark: at 80x108 the figure scales 0.125px
// per unit, putting the crown 11.75px and the shadow 89.5px below the figure
// top. Peek is 22px tall at bottom:-77px (antenna and the top of the head);
// standing is 81px at bottom:-18px, which lands the shadow on the edge.
//
// He walks in profile, not facing us: legs swinging towards the camera read
// as marching on the spot, so the stroll turns him side-on. maxe-turn squashes
// him to scaleX(.06) at each turn and the profile pose is swapped in behind
// that squash, which is also how he about-faces -- the same pose mirrored.
// Legs run one maxe-step cycle half a period apart so they scissor past each
// other. The traverse is paced off that stride: each leg sweeps
// 191 * sin(10deg) = 33.2 units either side of the hip, so a 1s cycle carries
// him 2 * 2 * 33.2 * 0.125 = 16.6px, and 164px over the 9.88s walk phase is
// 16.6px/s. Change one and the feet start skating.
const MAXE_TRIGGER_STYLES = `
@keyframes maxe-idle-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes maxe-walk-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes maxe-step{0%{transform:rotate(10deg)}50%{transform:rotate(-10deg)}100%{transform:rotate(10deg)}}
@keyframes maxe-stroll{0%,7%{transform:translateX(0)}45%,52%{transform:translateX(calc(-1 * var(--maxe-stroll-distance,26vw)))}90%,100%{transform:translateX(0)}}
@keyframes maxe-turn{0%,2.6%{transform:scaleX(1)}4.6%,5.4%{transform:scaleX(.06)}7%,45%{transform:scaleX(1)}47.5%,48.5%{transform:scaleX(.06)}52%,90%{transform:scaleX(-1)}92.5%,93.5%{transform:scaleX(.06)}96%,100%{transform:scaleX(1)}}
.maxe-wrapper{--maxe-stroll-distance:min(26vw,164px);position:fixed;right:24px;bottom:0;z-index:340;width:60px;height:81px;pointer-events:none;color:var(--em-ink,#090a0a)}
.maxe-wrapper.is-strolling{animation:maxe-stroll 26s linear both}
.maxe-trigger{position:absolute;left:0;right:0;bottom:0;width:60px;height:22px;padding:0;border:0;background:transparent;color:inherit;pointer-events:auto;cursor:pointer;transition:height 300ms cubic-bezier(.23,1,.32,1),opacity 150ms ease-out}
.maxe-trigger-crop{position:absolute;inset:0;overflow:hidden;background:transparent}
.maxe-figure{position:absolute;left:-10px;bottom:-77px;width:80px;height:108px;transition:bottom 300ms cubic-bezier(.23,1,.32,1);animation:maxe-idle-bob 3.4s var(--ease,cubic-bezier(.16,.84,.44,1)) infinite;will-change:transform,bottom}
.maxe-figure .maxe-mark{transform-origin:50% 86%}
.maxe-wrapper.is-marching .maxe-trigger{height:81px}
.maxe-wrapper.is-marching .maxe-figure{bottom:-18px}
.maxe-wrapper.is-marching .maxe-mark{animation:maxe-turn 26s cubic-bezier(.45,0,.55,1) both}
.maxe-wrapper.is-walking .maxe-figure{animation:maxe-walk-bob .5s ease-in-out infinite}
.maxe-wrapper.is-walking .maxe-leg-right{animation:maxe-step 1s ease-in-out infinite}
.maxe-wrapper.is-walking .maxe-leg-left{animation:maxe-step 1s ease-in-out infinite;animation-delay:-.5s}
.maxe-trigger-label{position:absolute;left:50%;bottom:calc(100% + 8px);display:flex;align-items:center;justify-content:center;padding:5px 9px;border-radius:11px;background:#34452e;color:#fffdf5;font:600 9px/1 'Outfit Variable',sans-serif;white-space:nowrap;box-shadow:0 8px 20px rgba(64,45,19,.18);opacity:0;transform:translate(-50%,6px);transition:opacity 150ms ease,transform 180ms cubic-bezier(.23,1,.32,1);pointer-events:none}
.maxe-trigger:focus-visible{outline:2px solid var(--em-ink,#090a0a);outline-offset:4px;height:81px}
.maxe-trigger:focus-visible .maxe-figure,.maxe-wrapper.is-nudging .maxe-trigger .maxe-figure{bottom:-18px}
.maxe-trigger:focus-visible .maxe-trigger-label,.maxe-wrapper.is-nudging .maxe-trigger-label{opacity:1;transform:translate(-50%,0)}
.maxe-wrapper.is-nudging .maxe-trigger{height:81px}
.maxe-wrapper.is-open{pointer-events:none}
.maxe-wrapper.is-open .maxe-trigger{opacity:0;pointer-events:none}
@media(hover:hover) and (pointer:fine){.maxe-trigger:hover{height:81px}.maxe-trigger:hover .maxe-figure{bottom:-18px}.maxe-trigger:hover .maxe-trigger-label{opacity:1;transform:translate(-50%,0)}}
@media(max-width:768px){.maxe-wrapper{--maxe-stroll-distance:min(52vw,164px);right:10px;bottom:96px}.maxe-trigger{height:28px}.maxe-figure{bottom:-71px}}
@media(prefers-reduced-motion:reduce){.maxe-wrapper,.maxe-wrapper.is-strolling,.maxe-figure,.maxe-wrapper.is-marching .maxe-figure,.maxe-wrapper.is-marching .maxe-mark,.maxe-wrapper.is-walking .maxe-figure,.maxe-wrapper.is-walking .maxe-leg-left,.maxe-wrapper.is-walking .maxe-leg-right{animation:none!important}.maxe-trigger,.maxe-trigger-label,.maxe-figure{transition:opacity 120ms ease!important}.maxe-trigger:focus-visible,.maxe-wrapper.is-nudging .maxe-trigger{height:81px}.maxe-trigger:focus-visible .maxe-figure,.maxe-wrapper.is-nudging .maxe-trigger .maxe-figure{bottom:-18px}}
`;

const STROLL_DURATION = 26_000;
// Both swaps happen while maxe-turn holds him edge-on, so the pose change is
// never visible: 5% and 93% of the stroll.
const FACE_SIDE_AT = 1_300;
const FACE_FRONT_AT = 24_180;

const MaxeTrigger = forwardRef<HTMLButtonElement, MaxeTriggerProps>(function MaxeTrigger(
  { open, onOpen },
  ref,
) {
  const [strolling, setStrolling] = useState(false);
  const [walking, setWalking] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [tabVisible, setTabVisible] = useState(document.visibilityState === 'visible');
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const settleTimer = useRef<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (open || reduceMotion || !tabVisible) {
      const stopTimer = window.setTimeout(() => {
        setStrolling(false);
        setWalking(false);
      }, 0);
      return () => window.clearTimeout(stopTimer);
    }
    let strollTimer: number | null = null;
    let sideTimer: number | null = null;
    let frontTimer: number | null = null;
    let cancelled = false;
    const schedule = () => {
      strollTimer = window.setTimeout(() => {
        if (cancelled) return;
        setStrolling(true);
        sideTimer = window.setTimeout(() => setWalking(true), FACE_SIDE_AT);
        frontTimer = window.setTimeout(() => setWalking(false), FACE_FRONT_AT);
        settleTimer.current = window.setTimeout(() => {
          setStrolling(false);
          if (!cancelled) schedule();
        }, STROLL_DURATION);
      }, 90_000 + Math.random() * 90_000);
    };
    schedule();
    return () => {
      cancelled = true;
      if (strollTimer !== null) window.clearTimeout(strollTimer);
      if (sideTimer !== null) window.clearTimeout(sideTimer);
      if (frontTimer !== null) window.clearTimeout(frontTimer);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    };
  }, [open, reduceMotion, tabVisible]);

  useEffect(() => {
    if (open || reduceMotion || !tabVisible) return;
    let blinkTimer: number | null = null;
    let reopenTimer: number | null = null;
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setEyesClosed(true);
        reopenTimer = window.setTimeout(() => {
          setEyesClosed(false);
          scheduleBlink();
        }, 150);
      }, 4_000 + Math.random() * 4_000);
    };
    scheduleBlink();
    return () => {
      if (blinkTimer !== null) window.clearTimeout(blinkTimer);
      if (reopenTimer !== null) window.clearTimeout(reopenTimer);
    };
  }, [open, reduceMotion, tabVisible]);

  useEffect(() => {
    if (open || localStorage.getItem('exammind-maxe-nudge-v1')) return;
    const riseTimer = window.setTimeout(() => {
      localStorage.setItem('exammind-maxe-nudge-v1', 'seen');
      setNudging(true);
    }, 2400);
    const settleNudgeTimer = window.setTimeout(() => setNudging(false), 6700);
    return () => {
      window.clearTimeout(riseTimer);
      window.clearTimeout(settleNudgeTimer);
    };
  }, [open]);

  return (
    <>
      <style>{MAXE_TRIGGER_STYLES}</style>
      <div className={`maxe-wrapper${strolling ? ' is-strolling is-marching' : ''}${walking ? ' is-walking' : ''}${nudging ? ' is-nudging' : ''}${open ? ' is-open' : ''}`}>
        <button
          ref={ref}
          type="button"
          className="maxe-trigger"
          aria-label="Open Maxe"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={open}
          onClick={onOpen}
        >
          <span className="maxe-trigger-label" aria-hidden="true">Ask Maxe anything</span>
          <span className="maxe-trigger-crop" aria-hidden="true">
            <span className="maxe-figure"><MaxeMark eyesClosed={eyesClosed} profile={walking} /></span>
          </span>
        </button>
      </div>
    </>
  );
});

export default MaxeTrigger;
