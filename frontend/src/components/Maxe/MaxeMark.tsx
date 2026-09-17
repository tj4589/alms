type MaxeMarkProps = {
  eyesClosed?: boolean;
  className?: string;
};

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
        <ellipse cx="320" cy="428" rx="150" ry="20" fill="var(--em-ink, #090a0a)" opacity="0.08" className="maxe-shadow" />

        <g className="maxe-leg maxe-leg-left" style={{ transformOrigin: '258px 282px' }}>
          <path d="M 235,282 L 281,282 Q 304,282 304,305 L 304,377 Q 304,400 281,400 L 235,400 Q 212,400 212,377 L 212,305 Q 212,282 235,282 Z" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
          <path d="M 227,386 L 289,386 Q 304,386 304,401 Q 304,416 289,416 L 227,416 Q 212,416 212,401 Q 212,386 227,386 Z" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
        </g>
        <g className="maxe-leg maxe-leg-right" style={{ transformOrigin: '382px 282px' }}>
          <path d="M 359,282 L 405,282 Q 428,282 428,305 L 428,377 Q 428,400 405,400 L 359,400 Q 336,400 336,377 L 336,305 Q 336,282 359,282 Z" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
          <path d="M 351,386 L 413,386 Q 428,386 428,401 Q 428,416 413,416 L 351,416 Q 336,416 336,401 Q 336,386 351,386 Z" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="9" />
        </g>

        <g className="maxe-antenna">
          <rect x="314" y="118" width="12" height="58" rx="6" fill="var(--em-ink, #090a0a)" />
          <circle cx="320" cy="118" r="20" fill="var(--em-accent, #e9a13a)" />
        </g>

        <g className="maxe-head">
          <path d="M 170,166 L 470,166 Q 534,166 534,230 L 534,368 Q 534,432 470,432 L 170,432 Q 106,432 106,368 L 106,230 Q 106,166 170,166 Z" fill="var(--em-paper, #f3f4ef)" stroke="var(--em-ink, #090a0a)" strokeWidth="10" />
          <path d="M 458,180 L 488,180 Q 488,180 488,194 L 488,404 Q 488,404 458,404 Z" fill="#e2dfd2" opacity="0.7" />
          <g className="maxe-eye maxe-eye-left">
            {eyesClosed ? (
              <path d="M 232,275 L 274,275" fill="none" stroke="var(--em-ink, #090a0a)" strokeWidth="11" strokeLinecap="round" />
            ) : (
              <>
                <path d="M 253,254 Q 274,254 274,275 L 274,297 Q 274,318 253,318 Q 232,318 232,297 L 232,275 Q 232,254 253,254 Z" fill="var(--em-ink, #090a0a)" />
                <circle cx="245" cy="274" r="6" fill="var(--em-paper, #f3f4ef)" />
              </>
            )}
          </g>
          <g className="maxe-eye maxe-eye-right">
            {eyesClosed ? (
              <path d="M 366,275 L 408,275" fill="none" stroke="var(--em-ink, #090a0a)" strokeWidth="11" strokeLinecap="round" />
            ) : (
              <>
                <path d="M 387,254 Q 408,254 408,275 L 408,297 Q 408,318 387,318 Q 366,318 366,297 L 366,275 Q 366,254 387,254 Z" fill="var(--em-ink, #090a0a)" />
                <circle cx="379" cy="274" r="6" fill="var(--em-paper, #f3f4ef)" />
              </>
            )}
          </g>
          <path className="maxe-mouth" d="M 261,354 Q 320,384 379,354" fill="none" stroke="var(--em-accent, #e9a13a)" strokeWidth="22" strokeLinecap="round" />
        </g>
      </svg>
    </>
  );
}
