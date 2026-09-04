# ExamMind Interface System

## Midnight Studio direction

ExamMind is a dark, source-aware academic workspace. The public landing page uses a near-black studio canvas, oversized editorial typography, one electric-lime action accent, and an honest HTML preview of the product. Authenticated work surfaces stay compact and operational: evidence first, rules before ornament, and real archive data before metrics. Landing and dashboard are the only surfaces in this visual pass; the remaining routes continue to consume the aliases below.

## Tokens

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--studio` | `#0A0B0D` |
| Panel | `--studio-panel` | `#111318` |
| Raised | `--studio-raised` | `#171A21` |
| Inset | `--studio-inset` | `#06070A` |
| Sticky veil | `--studio-veil` | `rgba(10,11,13,.72)` |
| Primary ink | `--ink` | `#F2F4F8` |
| Supporting ink | `--ink-soft` | `#A9B0BF` |
| Metadata | `--ink-mute` | `#6F7787` |
| Brand/action | `--lime` | `#CBFB45` |
| Lime hover | `--lime-hover` | `#D9FF6B` |
| Verified | `--verified` | `#5AE3C0` |
| Attention | `--attention` | `#F5B84A` |
| Error | `--danger` | `#FF7A5E` |
| Rule | `--line` | `rgba(255,255,255,.07)` |
| Strong rule | `--line-strong` | `rgba(255,255,255,.13)` |
| Focus | `--line-focus` | `rgba(203,251,69,.55)` |

Legacy names (`--bg`, `--gold`, `--teal`, `--coral`, `--desk`, and related aliases) point to these values so untouched screens remain functional. Lime is reserved for the primary CTA, active navigation, focus, and a small number of evidence marks. Teal means source-grounded or verified; amber means attention; coral means an error.

## Typography

- Display emphasis: Instrument Serif, normal or italic, for the single accented word in the landing headline and occasional academic emphasis.
- Interface: DM Sans Variable, weights 400 / 500 / 600 / 800.
- Codes, dates, counts and chart labels: JetBrains Mono Variable with tabular numerals.
- Landing H1: `clamp(52px, 8.5vw, 124px)`, 800, `-.05em`, `.92` line height.
- Dashboard page title: 30px, 600, `-.035em`.
- Panel title: 15px, 600. Body: 14px / 1.6. Metadata: 10–12px mono.

## Patterns

- Floating public navigation pill with restrained blur and a keyboard-closeable mobile menu.
- HTML product window in the landing hero, with source rows and a grounded-answer treatment.
- Lime material marquee band and a single lime closing CTA block.
- Asymmetric capability bento: retrieval spans two columns; answer, practice and readiness support it.
- Next-study-action hero panel on the dashboard, driven by real archive/readiness state.
- Segmented metric strip: one panel divided by hairlines, not four equal cards.
- 76px course workspace rows with course code, source/question counts, readiness and one arrow action.
- Inset empty bands with one recovery action and human-facing error banners.
- Inline CSS/SVG readiness bars and weekly activity bars. No chart dependency and no invented values.

## State and accessibility rules

Loading uses restrained shimmer rows matched to their real height. Empty states explain what a student must do next. Errors use plain language and a retry action; provider details never appear in copy. Every interactive element has a visible focus state and a 40px minimum hit area (44px on mobile). Charts expose a title/label, and zero activity is shown as a baseline stub. Reduced-motion users receive no marquee, tilt or reveal transitions.

## Avoid

Generic SaaS KPI grids, fake metrics, fake charts, purple/blue gradient meshes, neon glow, full-page glassmorphism, decorative blobs, nested cards, giant numbers without context, emoji iconography, stock student photography, excessive pill controls, and hover effects that reflow content. Do not change API contracts or replace real data with demo data.

## Verification

Review landing and authenticated dashboard at 390px, 768px, 1024px and 1440px. Require no horizontal overflow, visible focus states, semantic landmarks, honest loading/empty/error states, and a clean `npm run build`.
