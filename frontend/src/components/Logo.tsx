type LogoProps = {
  /** Rendered height in px; the width follows the mark's own proportions. */
  size?: number;
  className?: string;
};

// The ExamMind mark: a sheet with a turned corner and a highlighter stroke
// across the middle line. Its colours are the palette's own -- paper, ink and
// accent -- so it is drawn rather than tinted, and it does not take
// currentColor the way the lucide glyph it replaced did.
//
// The source artwork is on a 1000x1000 canvas with the mark sitting in the
// middle of it. The viewBox below is cropped to the artwork's real bounds
// (including the 16-unit stroke and the rotated corner) so the mark fills its
// box instead of floating in empty padding at small sizes.
const VIEW_BOX = '268 177 480 629';

const PAPER = 'var(--logo-paper, #f3f4ef)';
const INK = 'var(--logo-ink, #090a0a)';
const ACCENT = 'var(--logo-accent, #e9a13a)';
const FOLD = 'var(--logo-fold, #e2dfd2)';

export default function Logo({ size = 34, className = '' }: LogoProps) {
  return (
    <svg
      className={`em-logo ${className}`.trim()}
      viewBox={VIEW_BOX}
      height={size}
      width={(size * 480) / 629}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {/* The sheet, with the corner cut away at the top right. */}
      <path
        d="M 330,210 L 620,210 L 720,310 L 720,740 Q 720,790 670,790 L 330,790 Q 280,790 280,740 L 280,260 Q 280,210 330,210 Z"
        fill={PAPER}
        stroke={INK}
        strokeWidth="16"
        strokeLinejoin="round"
      />

      {/* First line of text. */}
      <path
        d="M 373.02,465.2 L 626.98,465.2 Q 649.6,465.2 649.6,487.82 Q 649.6,510.44 626.98,510.44 L 373.02,510.44 Q 350.4,510.44 350.4,487.82 Q 350.4,465.2 373.02,465.2 Z"
        fill={INK}
      />

      {/* The highlighter, struck slightly off square so it reads as a hand
          movement rather than a printed band. It sits under the line it
          marks, the way a highlighter does. */}
      <g transform="translate(482.4,580.62) rotate(-3)">
        <path
          d="M -151.056,-52.026 L 151.056,-52.026 Q 178.2,-52.026 178.2,-24.882 L 178.2,24.882 Q 178.2,52.026 151.056,52.026 L -151.056,52.026 Q -178.2,52.026 -178.2,24.882 L -178.2,-24.882 Q -178.2,-52.026 -151.056,-52.026 Z"
          fill={ACCENT}
        />
      </g>

      {/* Second line, the highlighted one. */}
      <path
        d="M 373.02,558 L 591.78,558 Q 614.4,558 614.4,580.62 Q 614.4,603.24 591.78,603.24 L 373.02,603.24 Q 350.4,603.24 350.4,580.62 Q 350.4,558 373.02,558 Z"
        fill={INK}
      />

      {/* Third line, short, so the block reads as a paragraph ending. */}
      <path
        d="M 373.02,650.8 L 547.78,650.8 Q 570.4,650.8 570.4,673.42 Q 570.4,696.04 547.78,696.04 L 373.02,696.04 Q 350.4,696.04 350.4,673.42 Q 350.4,650.8 373.02,650.8 Z"
        fill={INK}
      />

      {/* The turned corner, lifted off the page. */}
      <g transform="translate(648.06,189.19) rotate(9)">
        <path
          d="M 0,0 L 88,0 L 88,88 Z"
          fill={FOLD}
          stroke={INK}
          strokeWidth="13.6"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
