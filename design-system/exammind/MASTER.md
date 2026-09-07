# ExamMind Interface System

## Paper direction

ExamMind is a light, source-aware academic workspace. The public landing sits on warm cream paper with near-black ink, one warm amber accent, oversized editorial typography, and a flat-shaded 3D centrepiece built from the product's own subject matter. Authenticated work surfaces stay compact and operational: evidence first, rules before ornament, and real archive data before metrics.

This system replaces the Midnight Studio direction, which was reverted before it ever shipped. **The app is light only — there is no dark theme and no dark-mode variant to maintain.**

## Tokens

Defined globally in `frontend/src/index.css`. The four `--em-*` values are the source of truth; every legacy alias points at them so untouched screens inherit the system without edits.

| Role | Token | Value |
| --- | --- | --- |
| Page / canvas | `--em-paper` | `#f3f4ef` |
| Banded section | `--em-paper-2` | `#e7e9e2` |
| Ink | `--em-ink` | `#090a0a` |
| Brand / action | `--em-accent` | `#e9a13a` |
| Raised surface | `--surface`, `--bg3` | `#ffffff` |
| Supporting ink | `--paper-ink-soft` | `rgba(9,10,10,.68)` |
| Metadata ink | `--pencil` | `rgba(9,10,10,.5)` |
| Verified / grounded | `--source-verified` | `#147a6a` |
| Error / correction | `--correction` | `#c8492f` |
| Rule | `--margin-rule` | `rgba(9,10,10,.12)` |
| Strong rule | `--margin-rule-strong` | `rgba(9,10,10,.2)` |

Aliases (`--bg`, `--text`, `--gold`, `--teal`, `--coral`, `--border`, `--desk`, …) resolve to the above. Amber is reserved for brand, the primary CTA and highlight marks; teal means source-grounded or verified; coral means an error. The focus ring is ink, not amber — amber measured ~1.9:1 against cream and was not a reliable indicator.

### Motion tokens

| Token | Value | Use |
| --- | --- | --- |
| `--fast` | `.15s` | Hover and colour transitions |
| `--base` | `.28s` | Chrome state changes (nav pill) |
| `--slow` | `.6s` | Entrance choreography |
| `--ease` | `cubic-bezier(.16,.84,.44,1)` | Everything above; never linear |

## Typography

- Display emphasis: Instrument Serif, normal or italic, for a single accented word.
- Interface: DM Sans Variable, weights 400 / 500 / 600 / 800.
- Codes, dates, counts and chart labels: JetBrains Mono Variable with tabular numerals.
- Landing H1: `clamp(52px, 7vw, 86px)`, 780, `.93` line height — sized to leave the 3D object room beneath it.
- Landing lede: `clamp(19px, 2.2vw, 25px)`, 620.
- Dashboard page title: 29px, 700, `-.025em`.
- Panel title: 15px, 600. Body: 14px / 1.6. Metadata: 10–12px mono.

## Patterns

- **The Highlighted Page** — the landing hero's 3D centrepiece. One notebook page extruded from a `THREE.Shape` with binding holes punched through the geometry, a highlighted ruled line, a dog-eared corner and a highlighter across the bottom edge. Flat `MeshToonMaterial` with a nearest-filtered gradient map plus an inverted-hull `OutlineEffect` pass. Never PBR, never default grey.
- **Construction-line reveal** — thin ink lines and a bordered frame draw themselves in via SVG `pathLength="1"` + `stroke-dashoffset`, then two stippled dot clusters converge from either edge, then the object settles. Staggered, one sequence.
- **Dot-matrix stipple** — a shape painted to an offscreen canvas, sampled on a grid, drawn as jittered dots whose radius and alpha scale with the mask's alpha. The cluster shape is abstract and procedurally generated (a blurred, tapering plume of lobes breaking into satellites), deterministically seeded so it stays stable across re-renders. It is not a figurative silhouette and is not required to depict anything. Flat 2D, never modelled geometry.
- **Stipple colour** — a horizontal gradient, amber at the inner tip where the clusters meet the object, through warm mid-brown, to sepia at the outer edge. Never flat amber: `#e9a13a` on cream is ~1.9:1, and fine dots stop resolving as texture at that contrast.
- **Sticky-pinned hero hand-off** — the hero scales and fades as one unit over ~1.5 viewports of scroll while real content scrolls up beneath it. Plain scroll-position maths, no animation library.
- **Backdrop wordmark** — an oversized phrase at ~11% ink sitting behind the object, which renders over it. Decorative and `aria-hidden`; the hero's real `h1` is the lede. The nav wordmark is the brand name and is separate.
- **Cursor-reactive field** — a warm beige ground with a lerped radial highlight tracking the pointer through CSS custom properties. Low contrast, felt rather than seen; frozen centred under reduced motion.
- **Self-drawing hover ring** — nav links draw an accent ellipse around themselves on hover and focus, looping draw-on/hold/draw-off. Same `pathLength` mechanism as the reveal.
- **Branded preloader** — one construction line drawing itself under the brand mark, cross-faded out. Never a spinner. Always capped in JS so a slow network degrades to the static placeholder rather than hanging.
- **Scroll-linked section vignette** — a `pointer-events:none` overlay per section whose opacity follows the section's distance from viewport centre. **This is an overlay, never a theme change:** section background tokens are never touched, so deleting the overlay leaves the light palette intact. Position-driven, so a section parked at the viewport edge stays dimmed at rest; the centred section is always full light. Frozen at zero under reduced motion.
- **Ambient imagery** — up to 15 licensed photographs placed loosely around the hero edges, duotoned in CSS into the paper range, always soft, never fully opaque, cycling on a slow blur/fade. Sourced by dropping files into `src/assets/ambient/`; the layer renders nothing when empty.
- **Floating nav pill** — landing nav starts flush, collapses past 32px of scroll into a rounded, blurred, shadowed pill, and reverses on the way back up.
- Print grain over the hero: one CSS layer, `feTurbulence`, `multiply`, ~6%.
- HTML product window with source rows and a grounded-answer treatment.
- Amber material marquee band and a single closing CTA block.
- Alternating ink-on-paper capability blocks — every second card inverts to ink with white text.
- Next-study-action panel on the dashboard, driven by real archive/readiness state.
- Segmented metric strip: one panel divided by hairlines, not four equal cards.
- Inline CSS/SVG readiness and activity bars. No chart dependency and no invented values.

## State and accessibility rules

Loading uses restrained shimmer rows matched to their real height. Empty states explain what a student must do next. Errors use plain language and a retry action; provider details never appear in copy. Every interactive element has a visible ink focus ring and a 40px minimum hit area (44px on mobile). Charts expose a title/label, and zero activity is shown as a baseline stub.

Reduced-motion users get no reveal, no idle rotation, no pointer parallax and no nav transition — the 3D object renders in a fixed resting pose. The hero canvas is lazy-mounted behind a flat card silhouette so it never blocks first paint, falls back to that silhouette when WebGL is unavailable, and pauses its render loop entirely when the tab is backgrounded.

## Avoid

Generic SaaS KPI grids, fake metrics, fake charts, purple/blue gradient meshes, neon glow, full-page glassmorphism, decorative blobs, nested cards, giant numbers without context, emoji iconography, stock student photography, excessive pill controls, and hover effects that reflow content.

For 3D specifically: default grey/white materials, realistic PBR or metallic shading, single-colour flat-grey objects, untextured placeholder meshes, and any object that could be mistaken for a lighting test. Do not model a phone, wallet, card or person — none of it is ExamMind's own material.

Do not change API contracts or replace real data with demo data. Do not reintroduce a dark theme — the section vignette is a transient scroll-linked overlay and is not a licence to darken anything at rest.

Do not use image assets that are not properly licensed. Ambient photography comes from Unsplash/Pexels-type sources or is owned outright, recorded in `src/assets/ambient/README.md`; never scraped.

## Verification

Review landing and authenticated dashboard at 390px, 768px, 1024px and 1440px. Require no horizontal overflow, visible focus states, semantic landmarks, honest loading/empty/error states, and clean `npm run build` and `npm run lint`.
