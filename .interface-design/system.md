# ExamMind Paper System

The canonical interface decisions live in `design-system/exammind/MASTER.md`.

- Direction: light academic workspace on warm cream paper, near-black ink, oversized editorial type, and one disciplined amber accent. Light only, except the landing page's own below-the-fold dark switch.
- Centrepiece: a flat-shaded 3D "Highlighted Page" in the landing hero, revealed by construction lines and two abstract stippled dot clusters converging from either edge, then handed off to page content on scroll.
- Depth: white raised surfaces on cream, a print-grain layer over the hero; rules and spacing do most of the work.
- Spacing: 4px base, 8/12/16/20px component rhythm, 24px between panels, 48px+ between major regions.
- Motion: `--fast`/`--base`/`--slow` with `--ease`; never linear, never snapped. All of it opts out under `prefers-reduced-motion`.
- Hierarchy: next study action first, archive evidence second, course/readiness detail next.
- Reusable patterns: scroll-collapsing nav pill, self-drawing hover rings, sticky-pinned hero hand-off, branded line preloader, HTML product preview, amber material band, alternating ink capability blocks, segmented metric strip, inline-SVG charts, and explicit recovery states.
- Atmosphere: a cursor-reactive warm-beige field, an oversized decorative backdrop phrase behind the object, and duotoned ambient study imagery cycling on a slow blur/fade.
- Light hero, dark below the fold: the landing hero stays on paper; past it, the content sections switch once to the dark palette and stay there, reversing on the way back up. Landing page only — every other screen is light.
- Typography: Instrument Serif for editorial emphasis, DM Sans Variable for UI, JetBrains Mono Variable for codes and data.
- Accent semantics: amber for brand/action, teal for verified source evidence, coral for errors. Ink for focus rings.
- Scope: this pass covers the public landing, authenticated dashboard and shared shell/tokens; other routes inherit the tokens and keep their existing structure.
