import { forwardRef, useEffect, useRef, useState } from 'react';
import MaxeMark from './MaxeMark';

type MaxeTriggerProps = {
  open: boolean;
  onOpen: () => void;
};

const MAXE_TRIGGER_STYLES = `
@keyframes maxe-idle-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes maxe-march-left{0%,40%,100%{transform:rotate(0deg) translateY(0)}20%{transform:rotate(-9deg) translateY(-14px)}}
@keyframes maxe-march-right{0%,40%,100%{transform:rotate(0deg) translateY(0)}60%{transform:rotate(9deg) translateY(-14px)}}
@keyframes maxe-drift{0%,100%{transform:translateX(0)}50%{transform:translateX(var(--maxe-drift-distance,-88px))}}
.maxe-wrapper{--maxe-drift-distance:-88px;position:fixed;right:8px;bottom:8px;z-index:340;width:96px;height:180px;pointer-events:none;color:var(--em-ink,#090a0a)}
.maxe-wrapper.is-strolling{animation:maxe-drift 2.3s cubic-bezier(.77,0,.175,1) both}
.maxe-trigger{position:absolute;left:0;right:0;bottom:0;width:96px;height:38px;padding:0;border:0;background:transparent;color:inherit;pointer-events:auto;cursor:pointer;transition:height 260ms cubic-bezier(.23,1,.32,1),opacity 150ms ease-out}
.maxe-trigger:active{height:36px}
.maxe-trigger-surface{position:absolute;inset:0;overflow:hidden;border:1px solid rgba(9,10,10,.14);border-radius:16px 16px 8px 8px;background:var(--em-paper,#f3f4ef);box-shadow:0 12px 30px rgba(64,45,19,.13),0 0 26px rgba(233,161,58,.18)}
.maxe-figure{position:absolute;left:-27px;bottom:-145px;width:150px;height:202px;transition:bottom 260ms cubic-bezier(.23,1,.32,1);animation:maxe-idle-bob 3.4s var(--ease,cubic-bezier(.16,.84,.44,1)) infinite;will-change:transform,bottom}
.maxe-wrapper.is-marching .maxe-trigger{height:180px}
.maxe-wrapper.is-marching .maxe-trigger .maxe-figure{bottom:-10px;animation:maxe-idle-bob 1.15s var(--ease,cubic-bezier(.16,.84,.44,1)) 2}
.maxe-wrapper.is-marching .maxe-leg-left{animation:maxe-march-left 1.15s var(--ease,cubic-bezier(.16,.84,.44,1)) 2}
.maxe-wrapper.is-marching .maxe-leg-right{animation:maxe-march-right 1.15s var(--ease,cubic-bezier(.16,.84,.44,1)) 2}
.maxe-trigger-label{position:absolute;left:10px;right:10px;bottom:10px;display:flex;align-items:center;justify-content:center;min-height:30px;border-radius:15px;background:#34452e;color:#fffdf5;font:600 11px/1 'Outfit Variable',sans-serif;opacity:0;transform:translateY(6px);transition:opacity 150ms ease,transform 180ms cubic-bezier(.23,1,.32,1);pointer-events:none}
.maxe-trigger:focus-visible{outline:2px solid var(--em-ink,#090a0a);outline-offset:4px;height:180px}
.maxe-trigger:focus-visible .maxe-figure,.maxe-wrapper.is-nudging .maxe-trigger .maxe-figure{bottom:-10px}
.maxe-trigger:focus-visible .maxe-trigger-label,.maxe-wrapper.is-nudging .maxe-trigger-label{opacity:1;transform:translateY(0)}
.maxe-wrapper.is-nudging .maxe-trigger{height:180px}
.maxe-wrapper.is-open{pointer-events:none}
.maxe-wrapper.is-open .maxe-trigger{opacity:0;pointer-events:none}
@media(hover:hover) and (pointer:fine){.maxe-trigger:hover{height:180px}.maxe-trigger:hover .maxe-figure{bottom:-10px}.maxe-trigger:hover .maxe-trigger-label{opacity:1;transform:translateY(0)}}
@media(max-width:768px){.maxe-wrapper{--maxe-drift-distance:-44px;right:3px;bottom:96px}}
@media(prefers-reduced-motion:reduce){.maxe-wrapper,.maxe-wrapper.is-strolling,.maxe-figure,.maxe-wrapper.is-marching .maxe-figure,.maxe-wrapper.is-marching .maxe-leg-left,.maxe-wrapper.is-marching .maxe-leg-right{animation:none!important}.maxe-trigger,.maxe-trigger-label,.maxe-figure{transition:opacity 120ms ease!important}.maxe-trigger:focus-visible,.maxe-wrapper.is-nudging .maxe-trigger{height:180px}.maxe-trigger:focus-visible .maxe-figure,.maxe-wrapper.is-nudging .maxe-trigger .maxe-figure{bottom:-10px}}
`;

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
        }, 2300);
      }, 25_000 + Math.random() * 20_000);
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
          <span className="maxe-trigger-surface" aria-hidden="true">
            <span className="maxe-figure"><MaxeMark eyesClosed={eyesClosed} /></span>
            <span className="maxe-trigger-label">Ask Maxe anything</span>
          </span>
        </button>
      </div>
    </>
  );
});

export default MaxeTrigger;
