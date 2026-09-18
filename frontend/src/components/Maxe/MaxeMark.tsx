type MaxeMarkProps = {
  eyesClosed?: boolean;
  profile?: boolean;
  className?: string;
};

// Standing height H = 597 units, antenna crown y=94 to sole y=691.
// antenna 42 (7%), head 251 (42%), neck + torso 125 (21%), legs 179 (30%).
// Head is 336 wide, torso 236 (70% of the head). Every crop window in
// MaxeTrigger.tsx is derived from these y values -- move one and re-derive
// the peek and reveal offsets there, and the brand mark in MaxeWorkspace.tsx.
//
// The profile pose shares every one of those y values and only changes x,
// so it drops into the same crops untouched. It faces left; the trigger
// mirrors it with scaleX(-1) to walk the other way. Its legs sit almost on
// top of each other so they scissor past instead of swinging out sideways.
const MAXE_MARK_STYLES = `
.maxe-mark{display:block;width:100%;height:100%;overflow:visible}
:root .maxe-mark{--maxe-body:#f3f4ef;--maxe-line:#090a0a;--maxe-accent:#e9a13a;--maxe-panel:#e2dfd2;--maxe-far:#e4e2d7;--maxe-shadow:rgba(9,10,10,1)}
/* Body stays light, line stays dark: the drawing reads the same on either
   ground. Only the ground shadow flips, because it sits on the page. */
:root[data-theme="dark"] .maxe-mark{--maxe-body:#e9eae4;--maxe-line:#15171a;--maxe-accent:#f0b45c;--maxe-panel:#cfd0c6;--maxe-far:#d6d7cd;--maxe-shadow:rgba(0,0,0,1)}
`;

// Maxe is a drawn object, not a surface, so he does not follow the page the way
// a panel does. If his body used --em-paper it would go dark with the theme and
// a dark robot on a dark ground is an outline and nothing else. His own tokens
// are defined in MaxeMark's stylesheet and re-pointed for dark there: the body
// stays light and the ink line goes dark, so the drawing keeps its contrast
// either way.
const PAPER = 'var(--maxe-body, #f3f4ef)';
const INK = 'var(--maxe-line, #090a0a)';
const ACCENT = 'var(--maxe-accent, #e9a13a)';
const PANEL = 'var(--maxe-panel, #e2dfd2)';
const FAR = 'var(--maxe-far, #e4e2d7)';

export default function MaxeMark({ eyesClosed = false, profile = false, className = '' }: MaxeMarkProps) {
  return (
    <>
      <style>{MAXE_MARK_STYLES}</style>
      <svg
        className={`maxe-mark ${className}`.trim()}
        viewBox="0 0 640 860"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        {profile ? (
          <>
            <ellipse cx="320" cy="700" rx="86" ry="14" fill="var(--maxe-shadow, rgba(9,10,10,1))" opacity="0.08" className="maxe-shadow" />

            <g className="maxe-leg maxe-leg-left" style={{ transformOrigin: '328px 500px' }}>
              <rect x="290" y="470" width="76" height="184" rx="23" fill={FAR} stroke={INK} strokeWidth="9" />
              <rect x="272" y="642" width="94" height="49" rx="24" fill={FAR} stroke={INK} strokeWidth="9" />
            </g>
            <g className="maxe-leg maxe-leg-right" style={{ transformOrigin: '316px 500px' }}>
              <rect x="278" y="470" width="76" height="184" rx="23" fill={PAPER} stroke={INK} strokeWidth="9" />
              <rect x="260" y="642" width="94" height="49" rx="24" fill={PAPER} stroke={INK} strokeWidth="9" />
            </g>

            <g className="maxe-neck">
              <rect x="282" y="375" width="80" height="42" rx="20" fill={PAPER} stroke={INK} strokeWidth="10" />
            </g>

            <g className="maxe-torso">
              <rect x="235" y="408" width="170" height="104" rx="38" fill={PAPER} stroke={INK} strokeWidth="10" />
              <rect x="374" y="430" width="16" height="60" rx="8" fill={PANEL} opacity="0.7" />
            </g>

            <g className="maxe-antenna">
              <rect x="315" y="105" width="10" height="48" rx="5" fill={INK} />
              <circle cx="320" cy="107" r="13" fill={ACCENT} />
            </g>

            <g className="maxe-head">
              <rect x="195" y="136" width="250" height="251" rx="52" fill={PAPER} stroke={INK} strokeWidth="10" />
              <rect x="400" y="149" width="22" height="210" rx="11" fill={PANEL} opacity="0.7" />
              <g className="maxe-eye maxe-eye-right">
                {eyesClosed ? (
                  <path d="M 230,266 L 263,266" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
                ) : (
                  <>
                    <rect x="230" y="240" width="33" height="52" rx="16" fill={INK} />
                    <circle cx="238" cy="254" r="5" fill={PAPER} />
                  </>
                )}
              </g>
              <path className="maxe-mouth" d="M 214,314 Q 236,332 258,314" fill="none" stroke={ACCENT} strokeWidth="15" strokeLinecap="round" />
            </g>
          </>
        ) : (
          <>
            <ellipse cx="320" cy="700" rx="120" ry="16" fill="var(--maxe-shadow, rgba(9,10,10,1))" opacity="0.08" className="maxe-shadow" />

            <g className="maxe-leg maxe-leg-left" style={{ transformOrigin: '266px 500px' }}>
              <rect x="228" y="470" width="76" height="184" rx="23" fill={PAPER} stroke={INK} strokeWidth="9" />
              <rect x="228" y="642" width="76" height="49" rx="24" fill={PAPER} stroke={INK} strokeWidth="9" />
            </g>
            <g className="maxe-leg maxe-leg-right" style={{ transformOrigin: '374px 500px' }}>
              <rect x="336" y="470" width="76" height="184" rx="23" fill={PAPER} stroke={INK} strokeWidth="9" />
              <rect x="336" y="642" width="76" height="49" rx="24" fill={PAPER} stroke={INK} strokeWidth="9" />
            </g>

            <g className="maxe-neck">
              <rect x="272" y="375" width="96" height="42" rx="20" fill={PAPER} stroke={INK} strokeWidth="10" />
            </g>

            <g className="maxe-torso">
              <rect x="202" y="408" width="236" height="104" rx="38" fill={PAPER} stroke={INK} strokeWidth="10" />
              <rect x="376" y="428" width="20" height="64" rx="10" fill={PANEL} opacity="0.7" />
            </g>

            <g className="maxe-antenna">
              <rect x="315" y="105" width="10" height="48" rx="5" fill={INK} />
              <circle cx="320" cy="107" r="13" fill={ACCENT} />
            </g>

            <g className="maxe-head">
              <rect x="152" y="136" width="336" height="251" rx="52" fill={PAPER} stroke={INK} strokeWidth="10" />
              <rect x="428" y="149" width="23" height="210" rx="11" fill={PANEL} opacity="0.7" />
              <g className="maxe-eye maxe-eye-left">
                {eyesClosed ? (
                  <path d="M 251,266 L 284,266" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
                ) : (
                  <>
                    <rect x="251" y="240" width="33" height="52" rx="16" fill={INK} />
                    <circle cx="259" cy="254" r="5" fill={PAPER} />
                  </>
                )}
              </g>
              <g className="maxe-eye maxe-eye-right">
                {eyesClosed ? (
                  <path d="M 356,266 L 389,266" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
                ) : (
                  <>
                    <rect x="356" y="240" width="33" height="52" rx="16" fill={INK} />
                    <circle cx="364" cy="254" r="5" fill={PAPER} />
                  </>
                )}
              </g>
              <path className="maxe-mouth" d="M 274,312 Q 320,336 366,312" fill="none" stroke={ACCENT} strokeWidth="17" strokeLinecap="round" />
            </g>
          </>
        )}
      </svg>
    </>
  );
}
