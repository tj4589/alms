type MaxeMarkProps = {
  eyesClosed?: boolean;
  className?: string;
};

// Standing height H = 597 units, antenna crown y=94 to sole y=691.
// antenna 42 (7%), head 251 (42%), neck + torso 125 (21%), legs 179 (30%).
// Head is 336 wide, torso 236 (70% of the head). Every crop window in
// MaxeTrigger.tsx is derived from these y values -- move one and re-derive
// the peek and reveal offsets there, and the brand mark in MaxeWorkspace.tsx.
const MAXE_MARK_STYLES = `
.maxe-mark{display:block;width:100%;height:100%;overflow:visible}
`;

export default function MaxeMark({ eyesClosed = false, className = '' }: MaxeMarkProps) {
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
        <ellipse cx="320" cy="700" rx="120" ry="16" fill="var(--em-ink, #090a0a)" opacity="0.08" className="maxe-shadow" />

        <g className="maxe-leg maxe-leg-left" style={{ transformOrigin: '266px 500px' }}>
          <rect x="228" y="470" width="76" height="184" rx="23" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
          <rect x="228" y="642" width="76" height="49" rx="24" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
        </g>
        <g className="maxe-leg maxe-leg-right" style={{ transformOrigin: '374px 500px' }}>
          <rect x="336" y="470" width="76" height="184" rx="23" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
          <rect x="336" y="642" width="76" height="49" rx="24" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
        </g>

        <g className="maxe-neck">
          <rect x="272" y="375" width="96" height="42" rx="20" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="10" />
        </g>

        <g className="maxe-torso">
          <rect x="202" y="408" width="236" height="104" rx="38" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="10" />
          <rect x="376" y="428" width="20" height="64" rx="10" fill="#e2dfd2" opacity="0.7" />
        </g>

        <g className="maxe-antenna">
          <rect x="315" y="105" width="10" height="48" rx="5" fill="var(--em-ink, #090a0a)" />
          <circle cx="320" cy="107" r="13" fill="var(--em-accent, #e9a13a)" />
        </g>

        <g className="maxe-head">
          <rect x="152" y="136" width="336" height="251" rx="52" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="10" />
          <rect x="428" y="149" width="23" height="210" rx="11" fill="#e2dfd2" opacity="0.7" />
          <g className="maxe-eye maxe-eye-left">
            {eyesClosed ? (
              <path d="M 251,266 L 284,266" fill="none" stroke="var(--em-ink, #090a0a)" strokeWidth="9" strokeLinecap="round" />
            ) : (
              <>
                <rect x="251" y="240" width="33" height="52" rx="16" fill="var(--em-ink, #090a0a)" />
                <circle cx="259" cy="254" r="5" fill="var(--em-paper, #f3f4ef)" />
              </>
            )}
          </g>
          <g className="maxe-eye maxe-eye-right">
            {eyesClosed ? (
              <path d="M 356,266 L 389,266" fill="none" stroke="var(--em-ink, #090a0a)" strokeWidth="9" strokeLinecap="round" />
            ) : (
              <>
                <rect x="356" y="240" width="33" height="52" rx="16" fill="var(--em-ink, #090a0a)" />
                <circle cx="364" cy="254" r="5" fill="var(--em-paper, #f3f4ef)" />
              </>
            )}
          </g>
          <path className="maxe-mouth" d="M 274,312 Q 320,336 366,312" fill="none" stroke="var(--em-accent, #e9a13a)" strokeWidth="17" strokeLinecap="round" />
        </g>
      </svg>
    </>
  );
}
