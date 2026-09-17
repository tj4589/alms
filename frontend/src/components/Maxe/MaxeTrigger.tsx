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
const MAXE_TRIGGER_STYLES = `
@keyframes maxe-idle-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes maxe-march-left{0%,50%,100%{transform:rotate(0deg) translateY(0)}25%{transform:rotate(-10deg) translateY(-12px)}}
@keyframes maxe-march-right{0%,50%,100%{transform:rotate(0deg) translateY(0)}75%{transform:rotate(10deg) translateY(-12px)}}
@keyframes maxe-stroll{0%,5%{transform:translateX(0)}45%,55%{transform:translateX(calc(-1 * var(--maxe-stroll-distance,44vw)))}95%,100%{transform:translateX(0)}}
@keyframes maxe-face{0%,6%{transform:rotateY(0deg)}14%,45%{transform:rotateY(-20deg)}55%,89%{transform:rotateY(20deg)}97%,100%{transform:rotateY(0deg)}}
.maxe-wrapper{--maxe-stroll-distance:min(26vw,170px);position:fixed;right:24px;bottom:0;z-index:340;width:60px;height:81px;pointer-events:none;color:var(--em-ink,#090a0a)}
.maxe-wrapper.is-strolling{animation:maxe-stroll 26s linear both}
.maxe-trigger{position:absolute;left:0;right:0;bottom:0;width:60px;height:22px;padding:0;border:0;background:transparent;color:inherit;pointer-events:auto;cursor:pointer;transition:height 300ms cubic-bezier(.23,1,.32,1),opacity 150ms ease-out}
.maxe-trigger-crop{position:absolute;inset:0;overflow:hidden;background:transparent}
.maxe-figure{position:absolute;left:-10px;bottom:-77px;width:80px;height:108px;perspective:520px;transition:bottom 300ms cubic-bezier(.23,1,.32,1);animation:maxe-idle-bob 3.4s var(--ease,cubic-bezier(.16,.84,.44,1)) infinite;will-change:transform,bottom}
.maxe-figure .maxe-mark{transform-origin:50% 86%}
.maxe-wrapper.is-marching .maxe-trigger{height:81px}
.maxe-wrapper.is-marching .maxe-figure{bottom:-18px;animation:maxe-idle-bob 1.9s var(--ease,cubic-bezier(.16,.84,.44,1)) infinite}
.maxe-wrapper.is-marching .maxe-mark{animation:maxe-face 26s ease-in-out both}
.maxe-wrapper.is-marching .maxe-leg-left{animation:maxe-march-left .95s linear infinite}
.maxe-wrapper.is-marching .maxe-leg-right{animation:maxe-march-right .95s linear infinite}
.maxe-trigger-label{position:absolute;left:50%;bottom:calc(100% + 8px);display:flex;align-items:center;justify-content:center;padding:5px 9px;border-radius:11px;background:#34452e;color:#fffdf5;font:600 9px/1 'Outfit Variable',sans-serif;white-space:nowrap;box-shadow:0 8px 20px rgba(64,45,19,.18);opacity:0;transform:translate(-50%,6px);transition:opacity 150ms ease,transform 180ms cubic-bezier(.23,1,.32,1);pointer-events:none}
.maxe-trigger:focus-visible{outline:2px solid var(--em-ink,#090a0a);outline-offset:4px;height:81px}
.maxe-trigger:focus-visible .maxe-figure,.maxe-wrapper.is-nudging .maxe-trigger .maxe-figure{bottom:-18px}
.maxe-trigger:focus-visible .maxe-trigger-label,.maxe-wrapper.is-nudging .maxe-trigger-label{opacity:1;transform:translate(-50%,0)}
.maxe-wrapper.is-nudging .maxe-trigger{height:81px}
.maxe-wrapper.is-open{pointer-events:none}
.maxe-wrapper.is-open .maxe-trigger{opacity:0;pointer-events:none}
@media(hover:hover) and (pointer:fine){.maxe-trigger:hover{height:81px}.maxe-trigger:hover .maxe-figure{bottom:-18px}.maxe-trigger:hover .maxe-trigger-label{opacity:1;transform:translate(-50%,0)}}
@media(max-width:768px){.maxe-wrapper{--maxe-stroll-distance:min(52vw,170px);right:10px;bottom:96px}.maxe-trigger{height:28px}.maxe-figure{bottom:-71px}}
@media(prefers-reduced-motion:reduce){.maxe-wrapper,.maxe-wrapper.is-strolling,.maxe-figure,.maxe-wrapper.is-marching .maxe-figure,.maxe-wrapper.is-marching .maxe-mark,.maxe-wrapper.is-marching .maxe-leg-left,.maxe-wrapper.is-marching .maxe-leg-right{animation:none!important}.maxe-trigger,.maxe-trigger-label,.maxe-figure{transition:opacity 120ms ease!important}.maxe-trigger:focus-visible,.maxe-wrapper.is-nudging .maxe-trigger{height:81px}.maxe-trigger:focus-visible .maxe-figure,.maxe-wrapper.is-nudging .maxe-trigger .maxe-figure{bottom:-18px}}
`;

const STROLL_DURATION = 26_000;

const MaxeTrigger = forwardRef<HTMLButtonElement, MaxeTriggerProps>(function MaxeTrigger(
  { open, onOpen },
  ref,
) {
  const [strolling, setStrolling] = useState(false);
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
      const stopTimer = window.setTimeout(() => setStrolling(false), 0);
      return () => window.clearTimeout(stopTimer);
    }
    let strollTimer: number | null = null;
    let cancelled = false;
    const schedule = () => {
      strollTimer = window.setTimeout(() => {
        if (cancelled) return;
        setStrolling(true);
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
      <div className={`maxe-wrapper${strolling ? ' is-strolling is-marching' : ''}${nudging ? ' is-nudging' : ''}${open ? ' is-open' : ''}`}>
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
            <span className="maxe-figure"><MaxeMark eyesClosed={eyesClosed} /></span>
          </span>
        </button>
      </div>
    </>
  );
});

export default MaxeTrigger;
