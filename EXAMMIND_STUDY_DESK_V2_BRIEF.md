# TASK — ExamMind "Study Desk" v2: restore the paper palette, add a 3D hero, raise the craft ceiling

Repository: `tj4589/alms` · Frontend: React 19 + TypeScript + Vite, hand-written CSS (no Tailwind, no UI kit). `three` and `@react-three/fiber` are already dependencies (used in `components/AuthScene3D.tsx`).

**This supersedes `EXAMMIND_UI_UX_SKILLS_PROMPT.md` and reverses its premise.** That prompt extended the dark "Midnight Studio" system (near-black + electric lime) to more screens. This task undoes Midnight Studio on Landing + Dashboard and rebuilds from ExamMind's original light "paper" palette instead, then raises its craft level using the reference sites below and the design skills already installed in this repo (`emil-design-eng`, `impeccable`, `gpt-taste`, `ui-ux-pro-max` — in `.claude/skills/` and `.codex/skills/`).

---

## 0. Step zero — revert Midnight Studio (do this first, before any new work)

Midnight Studio was never deployed and exists only in these commits: `f7087f8` (Midnight Studio landing), `4ceac74` (Midnight Studio dashboard), `3412d28` (landing alignment pass), `30f7143` (Midnight Studio tokens) — all on top of `13aa963`, which is the last commit of the pre-Midnight-Studio "academic workbench" baseline.

Restore that baseline for the touched files, then build on top of it:

```bash
git checkout 13aa963 -- frontend/src/index.css frontend/src/App.css frontend/src/components/Landing.tsx frontend/src/screens/Dashboard.tsx frontend/src/screens/Dashboard.css
```

Verify with `git diff --stat` that only those files changed, run `npm run build` to confirm it still compiles, then commit this revert on its own (`revert: restore pre-Midnight-Studio academic workbench baseline`) before starting new work. Do not hand-reconstruct the old palette from memory — use the checkout above so the exact original values come back.

---

## 1. The base palette — ExamMind's own, not a new invention

`Landing.tsx` already carried these locally scoped tokens before Midnight Studio (visible again after the step-0 revert, in `App.css` around the `.em-*` rules):

```css
--em-paper:   #f3f4ef;  /* warm cream page background */
--em-paper-2: #e7e9e2;  /* slightly deeper cream, for banded sections */
--em-ink:     #090a0a;  /* near-black text/nav */
--em-accent:  #e9a13a;  /* warm amber/orange — the one accent */
```

Promote these to the **global** tokens in `index.css` (replacing `--studio`/`--lime`/etc. entirely — this app is light now, there is no dark mode), keeping the existing alias names (`--bg`, `--gold`, `--surface`, `--text`, …) pointed at them so nothing downstream breaks:

```
--bg → --em-paper        --gold → --em-accent
--text → --em-ink        --surface → white or --em-paper-2 (pick per-component, see §3)
```

Keep `--source-verified` / teal and `--correction` / coral as semantic colors (verified/error) — they're independent of the light/dark question. Keep the existing type stack (`DM Sans Variable`, `Instrument Serif`, `JetBrains Mono Variable`) and radii/spacing scale as-is; only the color system and the layout craft below are changing.

---

## 2. Direction — follow the reference design language strictly, invent your own assets

**Look at the actual reference images before doing this section — don't work from the text summary alone. Open every file listed below with an image tool before writing any code. If you cannot actually view image contents, say so explicitly before proceeding instead of guessing from the filenames.** They're saved in `design-system/references/`:
- `ref-01-finomac-fintech-3d-hero.png`, `ref-02-thomas-northman-cream-hero.png`, `ref-03-grow-big-serif-wordmark.png`, `ref-04-reel-ai-black-white-saas.png`, `ref-05-woodnest-cinematic-dark.png` — the five site references §2 describes below.
- `ref-06-moodboard-clay-dark-icon-cluster.png`, `ref-07-moodboard-grain-halftone-editorial.png` — the mood board for §3's texture/illustration direction (grain, halftone, editorial restraint, flat color confidence).
- `ref-08-godhand-dotmatrix-folder.jpg`, `ref-09-godhand-pixel-dither-window.jpg`, `ref-10-godhand-creation-of-adam-photoreal.jpg` — reference for the **stippling technique only** (offscreen-mask + jittered grid-sampled dots). The reveal no longer tries to depict literal hands (see §3) — these stay in the repo as the source of the dot-rendering method, not as a shape to match.
- `hero-prototype-reference.html` — **a working, running prototype of the entire hero** (reveal lines, dot-matrix hands, the 3D object, hover-parallax, scroll-exit), built in plain three.js + vanilla JS/CSS to prove the approach out. Open it in a browser first. This is ground truth for the mechanism — port its logic into React Three Fiber and TSX conventions, don't reinvent any of it from scratch, and don't copy it verbatim either (it's plain JS, the real app is R3F/TSX with the token system and `AuthScene3D.tsx`'s conventions).

The text below is a translation of what's in these images, not a replacement for looking at them — composition proportions, exact spacing, and the actual grain/halftone texture quality are easier to get right by looking than by reading a description of them.

You were shown five reference sites. Follow their design language **strictly** — type scale, spacing rhythm, composition, motion quality, restraint. The only thing that must be original is the literal content: the specific 3D object, the copy, the icon set. Cloning someone else's exact layout with their exact assets reads as a ripoff; matching their level of craft and their compositional logic with ExamMind's own material is the actual goal, and that's a much higher bar than "generic SaaS template," not a lower one. Concretely, take:

- **From the fintech reference (dark hero, floating phone + card render):** a bold sans headline, a hero built around one 3D object with 2-3 small floating proof chips physically overlapping its edges (not sitting neatly beside it), and a soft radial glow behind the object. This is the closest structural match for ExamMind's hero — reuse this composition, with ExamMind's own 3D object (§3) instead of a phone/card.
- **From the tax-lawyer reference (cream/white, two-column hero, pill tag row):** the two-column hero balance (headline + copy + CTA on one side, product visual on the other) as a fallback/secondary layout idea if the centered-hero-with-floating-3D-object doesn't fit ExamMind's copy length, plus its row of small outlined pill tags below the CTA — ExamMind can use this pattern for a "Past questions / Lecture notes / Practice / Grounded answers" pill row.
- **From the big-serif-wordmark reference (Grow+):** permission to let the ExamMind wordmark or one headline word be genuinely huge and typographically confident, using the existing Instrument Serif italic for that one accented word, the way the original `.em-hero-copy h1` already intended.
- **From the black/white SaaS reference (Reel.ai):** the crisp black-pill-button + white-pill-button pairing for primary/secondary CTAs, and small colored callout badges (a stat, a rating, a status) floating with slight rotation over the hero visual rather than flush with it.
- **From the cinematic dark-photo reference (WoodNest):** nothing color-wise (ExamMind is light), but the confidence of a single full-bleed hero plane with all the content sitting on top of it, rather than a hero that's visually separated from a content section below.

Explicitly reject: purple-blue gradient meshes, glassmorphism, four equal-weight glowing KPI cards, emoji as iconography, a hero that's just centered text with no visual centerpiece, anything that looks like it was assembled from a component library's defaults without a specific compositional decision behind it.

---

## 3. The 3D hero — cool, motion-forward, not a static render

**A first attempt at this already shipped and it is exactly the failure mode to avoid: a flat gray low-poly notebook, no color, no character — "generic AI 3D."** Read that failure before starting again.

### RULE: DO NOT GIVE GENERIC AI 3D

Banned outright: default Three.js gray/white materials, realistic PBR/metallic shading, a single-color flat-gray object, a low-poly primitive with no illustrated character, anything that looks like an untextured placeholder mesh. If the object could be mistaken for a lighting test scene, it has failed.

Required instead: **flat-shaded, illustration-style 3D** — bold, saturated, intentional color blocking (think flat-design character illustration rendered in three dimensions, not a photoreal render). Reference for the *quality bar and shading approach only* (not the literal scene — do not recreate a person, a laptop, or this specific composition): the flat-illustration style with confident color blocks, warm skin/object tones, graphic shapes with clean edges, a limited but rich palette, and no gradients-for-realism. Translate that sensibility into ExamMind's object using flat/toon shading (`MeshToonMaterial` with a stepped gradient map, or unlit `MeshBasicMaterial` with baked color blocking and a simple outline pass) rather than physically-based materials.

**Palette for the object specifically** (it can be richer than the site chrome): lead with the site's own cream/ink/amber, but it's allowed 1–2 supporting colors used with the same graphic confidence as the reference (e.g. a warm coral/pink and a deep ink-blue) *inside the illustrated object only* — the surrounding page chrome (nav, buttons, body text) stays disciplined to §1's palette. The object is allowed to be the one colorful, illustrated moment on an otherwise restrained page.

**The technique — verified against the actual three.js source, use this directly:**

Toon shading with crisp (not soft) banding:
```js
// The official three.js toon example builds a gradient map but never sets
// NearestFilter on it, which gives soft/interpolated bands, not flat toon steps.
// Set it explicitly — this is the fix that actually makes it look flat-illustration:
const steps = 4; // 3-4 = strong graphic banding; more steps = softer, less "illustrated"
const data = new Uint8Array(steps);
for (let i = 0; i < steps; i++) data[i] = (i / (steps - 1)) * 255;
const gradientMap = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

const material = new THREE.MeshToonMaterial({ color: '#e9a13a', gradientMap });
```

Ink outline (optional, adds the flat-illustration line quality seen in the mood board): three.js ships `OutlineEffect` inside the already-installed `three` package — **no new dependency** — at `three/addons/effects/OutlineEffect.js`. It uses inverted-hull/backface-normal-expansion (industry-standard technique, not a hack) and is a drop-in replacement for `renderer.render()`:
```js
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
// construct once: const effect = new OutlineEffect(gl, { defaultThickness: 0.0025, defaultColor: [0.03, 0.04, 0.04] });
// each frame, call effect.render(scene, camera) instead of gl.render(scene, camera)
```
Adapt these to react-three-fiber's patterns (`useThree()` for `gl`, construct the effect once via `useMemo`, call it inside `useFrame` instead of relying on R3F's automatic render). Don't copy any specific project's whole scene/geometry — this is the shading/outline mechanism only, the object design in §"Object concept" below is ExamMind's own.

**Textural treatment — grain, not gloss:** look at `design-system/references/ref-06-moodboard-clay-dark-icon-cluster.png` and `ref-07-moodboard-grain-halftone-editorial.png` directly for this part — the actual signature of the visual direction we're chasing is a subtle print/halftone/grain texture over the whole hero, not a shiny clean render. Achieve this cheaply and safely: a tiled noise/grain texture as a CSS overlay on top of the canvas (`mix-blend-mode: multiply` or `overlay`, low opacity ~4-8%, generated with an inline SVG `feTurbulence` filter or a small pre-made noise PNG — no new dependency). This one CSS layer does more for "crafted, not generic-AI" than any amount of extra 3D detail. A true WebGL halftone shader pass is a possible later stretch goal, not required now.

**Object concept — decided, prototyped, and validated. Build this one, not a variant:**

**"The Highlighted Page."** One notebook page, extruded from a real 2D shape (not a primitive box) with its binding holes actually punched through the geometry via `THREE.Shape` + a `holes` array on the shape, then `ExtrudeGeometry` with a light bevel — see `hero-prototype-reference.html` for the exact construction. A handful of ruled lines sit flush on the front face; one line has an amber highlight bar behind it. A highlighter rests diagonally across the bottom-right corner, extending slightly past the page's edge, mid-stroke over that highlighted line. A folded corner (dog-ear) at the top right. This is deliberately one object, not a scene — maximum negative space around it, direct and literal about what ExamMind actually does (highlighting your own material), lowest geometry risk of anything considered. Do not substitute a chair, a desk scene, a stack of index cards, or any other object — this direction is settled.

Do not model a phone, wallet, credit card, or a person — none of that belongs to ExamMind's own material.

**The reveal — how the hero enters, choreographed as one sequence, not independent pieces:**

1. **Construction lines draw themselves in.** A handful of thin ink lines (radiating toward the corners, plus two verticals) and a bordered frame rectangle animate from invisible to visible using the SVG `pathLength="1"` + `stroke-dasharray`/`stroke-dashoffset` technique (see the prototype) — no canvas/WebGL needed for this part, it's cheap vector line-drawing. This is the same category of move as an editorial "construction-line" reveal (thin geometric lines resolving into a frame before content settles) — built here from scratch in the site's own ink color, no borrowed imagery.
2. **Two abstract stippled dot-clusters flow in from either side**, converging toward the frame. This is no longer trying to read as a literal hand — drop that requirement entirely, stop waiting on any external artwork file, and don't chase anatomical accuracy. Keep exactly the stippling *technique* already built (offscreen canvas mask, grid sampling, jittered position/radius per dot for organic texture — same halftone sensibility as `ref-06`/`ref-07`) but let the shape stay procedural/abstract rather than a traced hand silhouette — see `hero-prototype-reference.html`'s `renderDotHand()` for the working stippling implementation to port (the shape it draws no longer needs to be hand-like). Color it warm: amber (`--em-accent`) nearest the object, cooling to a muted warm sepia/ink tone at the outer edge — a flat wash of amber the whole way loses legibility (amber-on-cream sits around 1.9:1 contrast, too low for fine stipple to read once it isn't backed by black). Keep it as a flat 2D graphic layer (canvas or SVG), never a modeled 3D hand.
3. **The page settles into the frame** once the lines and hands are most of the way in (staggered, not simultaneous — see the prototype's exact timing/delays as a starting point, tune from there).

**Motion — this is the part to make genuinely cool, not decorative:**
- A slow continuous idle animation (subtle rotation and/or gentle vertical bob) so the object never looks frozen, even before the user touches anything.
- **Continuous hover-based pointer parallax — no click or drag required.** The object leans/rotates toward the cursor position the whole time the pointer is over the hero, lerped (not snapped), exactly the convention already in `AuthScene3D.tsx` (`pointer.x`/`pointer.y` from `useThree()`, lerped each frame) — reuse that pattern directly rather than inventing a drag-to-rotate interaction.
- An entrance animation on load: the reveal sequence above *is* this requirement — lines, then hands, then the object, one choreographed sequence timed with the headline's own entrance, not independent pieces appearing at once.
- Keep floating proof chips (from §2's fintech-reference composition) to 1, at most 2, with their own subtle independent micro-motion, appearing after the main reveal sequence finishes rather than during it.
- Use `--ease`/`--fast`/`--base`/`--slow` from the token system for anything CSS-driven (chip entrance, hover states); the R3F/Three.js motion itself (rotation, parallax lerp) should feel similarly smooth — no linear easing, no jarring snaps.

**Scroll behavior — the hero hands off to the content beneath it:**

On scroll, the entire hero (lines, hands, object, headline) scales down slightly and fades out together as one unit, while the actual page content beneath it scrolls into view normally — see the prototype's `onScroll()` for the exact math (a sticky-pinned hero container released over roughly 2× viewport height of scroll, progress driving opacity/scale/translateY, no animation library, just scroll position read on a scroll listener). This is a plain CSS/JS technique, not a new dependency.

**Requirements (non-negotiable regardless of how cool it looks):**
- Respect `prefers-reduced-motion`: render the scene static (no idle animation, no pointer parallax, no entrance animation) when it's set — show the object in a fixed, well-composed resting pose.
- Must not block first paint — lazy-mount the canvas, show a simple static placeholder (a flat card silhouette) until it's ready.
- Keep it performant: low poly count, no heavy textures, target well under a second to first frame on a mid-range laptop, and make sure the idle animation loop doesn't spike CPU when the tab is backgrounded (pause the render loop on visibility change).
- No new dependency — `three` / `@react-three/fiber` only.

---

## 4. Non-negotiable rules (carried over, with #4 flipped)

1. **No new npm dependency.**
2. **No data-flow changes** — same `apiGet` calls, endpoints, state shape, props, routing, auth, offline logic. Presentation-layer only.
3. **No fake data, ever** — every empty/zero/loading state stays honest.
4. **Light only, now, with one named exception** — this reverses the old "dark only" rule. Do not build or leave behind a dark theme anywhere in the app (Dashboard, other screens). The one exception is the landing page's own hero → content scroll transition (see §7, point 10): the hero is light, and the content sections below it switch to a dark theme once the user scrolls past the hero. That is a deliberate, scoped landing-page effect, not a reopening of dark mode generally.
5. `cd frontend && npm run build && npm run lint` must pass clean.
6. Keep or improve every existing `aria-*`, `role`, and focus behaviour.
7. Update `design-system/exammind/MASTER.md` and `.interface-design/system.md` so they describe the restored-and-elevated paper system, not Midnight Studio. Add a `DEVLOG.md` entry documenting the revert and the new direction.

---

## 5. Scope

- `frontend/src/index.css` — global tokens (§1).
- `frontend/src/components/Landing.tsx` + its `.em-*` styles in `App.css` — hero rebuild with the 3D centerpiece (§3), rest of the page elevated per §2.
- **Nav scroll behavior:** the landing nav starts full-width/flush at the top of the page. On scroll (past some small threshold, e.g. 24-40px), it transitions into a floating pill — narrower than full width, pulled in from the edges, rounded, with a subtle shadow/backdrop — using the existing `--ease`/`--fast` tokens for the transition, not an abrupt snap. Scroll back to top reverses it. This applies to the landing page nav only.
- `frontend/src/screens/Dashboard.tsx` / `Dashboard.css` — re-themed to the paper palette using the same panel/card/empty-state patterns Midnight Studio established (segmented metric strip instead of glowing KPI cards, honest empty states, etc.) — just executed in light colors, not dark.
- Leave every other screen's structure alone for now; they'll inherit the new tokens automatically the same way they inherited Midnight Studio's. A follow-up pass (like the superseded prompt, but pointed at this palette) can bring their layouts in line later.

---

## 6. Acceptance checklist

```
[ ] Step 0 revert done as its own commit, verified against 13aa963
[ ] Every image in design-system/references/ (including ref-08/09/10) actually opened and looked at, not inferred from filenames
[ ] hero-prototype-reference.html opened and run in a browser before writing the real component
[ ] npm run build passes; npm run lint passes; zero TS errors
[ ] No new dependency in package.json
[ ] No API call, endpoint, prop, or type signature changed
[ ] No dark-theme remnants anywhere (no --studio/--lime tokens left in index.css)
[ ] Landing hero centerpiece is "The Highlighted Page" — a real 3D scene (extruded page + highlighter), not an image, not a chair or index-card variant
[ ] Binding holes are real punched-through geometry (Shape + holes array), not painted-on decals
[ ] Reveal sequence plays once on load: construction lines draw in, abstract stippled dot-clusters flow in from either side, then the object settles — staggered, not simultaneous
[ ] Dot-clusters are a flat 2D stippled/dot-matrix graphic (canvas or SVG), abstract/procedural — not a modeled 3D hand and not trying to read as an anatomical hand shape
[ ] Pointer parallax is continuous hover (no click/drag needed), using AuthScene3D.tsx's pointer-lerp convention
[ ] Scrolling past the hero scales/fades it out as one unit and hands off to real page content beneath, via plain scroll-position math (no new dependency)
[ ] 3D scene pauses its render loop when the tab is backgrounded
[ ] 3D scene respects prefers-reduced-motion (reveal + parallax + idle motion all disabled, static resting pose shown) and doesn't block first paint
[ ] Floating proof chips (1, at most 2) overlap the hero object's edges with their own independent micro-motion, appearing after the reveal finishes
[ ] 3D object uses flat/toon shading with a deliberate illustrated color palette — no gray/metallic default materials
[ ] Nav transitions into a floating pill on scroll and reverses on scroll-to-top, eased not snapped
[ ] Every metric/empty/zero state is honest
[ ] Visible focus ring on every interactive element
[ ] Zero horizontal overflow at 390 / 768 / 1024 / 1440
[ ] design-system/exammind/MASTER.md and .interface-design/system.md describe the new system, not Midnight Studio
[ ] DEVLOG.md has an entry for the revert + new direction
```

---

## 7. Post-launch refinement pass — fixes from live review of the running build

The hero from §3 is live on `localhost:5173` and mostly working. This is a punch list from looking at the actual running page, not a new direction — apply on top of everything above.

### UI fixes

1. **Notebook + pen read as rough/unfinished — clean up the geometry and shading.** Tighten edge bevels, make sure the toon banding (§3's 4-step gradient map) is actually crisp and not muddy, check the highlighter's proportions/alignment against the page so it doesn't look sketched-in. This is a polish pass on the existing object, not a redesign.
2. **Fix text contrast on/over the notebook.** Wherever copy sits on or near the object (ruled lines, any overlaid label), check it against the actual rendered background at that point — don't assume the page token contrast is enough once the 3D canvas and grain overlay are behind it.
3. **Nav link hover state:** `Capabilities` / `How it works` / `Integrity` — on hover, draw a circling ring around the link in `--em-accent`, using the same `pathLength="1"` / `stroke-dasharray` self-drawing technique as the hero's construction lines (§3, point 1), looping while hovered rather than a static underline.
4. **Giant background wordmark:** there's a large headline-scale text sitting in front of/beside the notebook. Move it fully behind the 3D object in z-order (so the notebook renders on top of it, not beside it), and change its copy from "ExamMind" to **"Never Leave your workspace again."** Keep "ExamMind" as the small nav-bar wordmark/logo only — this change is to the giant background text specifically, not the brand name everywhere.
5. **Remove the "Your private academic index" line** from the hero entirely.
6. **Add a proper preloader.** While the 3D canvas, fonts, and ambient images (point 8 below) load, show a branded loading state in the site's own ink/paper palette — e.g. a single construction line drawing itself in (reuse the `pathLength` technique again) rather than a generic spinner — then cross-fade into the real hero once ready. Must not block on a slow network indefinitely — cap it and degrade to the static placeholder already required in §3's requirements.
7. **Ambient study imagery around the hero:** add roughly 15 images evoking studying/exam prep (focused, frustrated, relieved, group study, late-night desk, etc.), placed loosely around/behind the hero content, each cycling through a slow blur+fade in/out (never sharp, never fully opaque — always slightly soft, like a memory) so they read as atmosphere, not a gallery. Source real or stock photography (properly licensed — Unsplash/Pexels-type sources, not scraped), then run them through the same duotone/grain treatment as the rest of the hero (§3's grain overlay direction, `ref-06`/`ref-07`) so they don't clash with the flat-illustration 3D object — treated photography, not raw stock-photo look. Illustrations are also acceptable if they fit the palette better once tried; pick whichever actually reads well against the object rather than committing to one sight-unseen.
8. **"Void beige" background that feels alive under the cursor:** the hero background shouldn't be a flat, static color. Add a soft warm-beige field with the grain texture already required in §3, plus a subtle radial highlight/vignette that follows the cursor (CSS `radial-gradient` positioned at pointer coordinates, lerped like the object's parallax, low contrast — a felt presence, not an obvious spotlight). Respect `prefers-reduced-motion` (freeze it in a neutral centered position).

### UX fixes

9. **Speed up the hero's scroll-exit.** The pinned-hero release (§3's scroll behavior) currently takes too much scroll distance to complete — shorten the sticky wrapper's height (e.g. from ~230vh down toward ~140–160vh; tune by feel) so the hero clears out and hands off to content faster.
10. **One-time dark switch below the hero — not a repeating per-section vignette.** Correcting the previous draft of this item: this is a single transition, not a gradient/vignette that brightens and dims over and over as each section scrolls through. The hero itself stays light (paper palette). Once the user scrolls past the hero, everything below it — Capabilities, How it works, Integrity, footer, whatever comes after — switches to a dark theme **once**, and stays dark for the rest of the scroll down the page. Scrolling back up above the hero threshold reverses it back to light. Implement as: a scroll-threshold check (e.g. `IntersectionObserver` on the hero, or a scrollY comparison against the hero's height) that toggles a `.dark` class on the sections wrapper below the hero; that class swaps the section background/text to dark tokens (e.g. a near-black background with light ink text — reuse values in the spirit of the old Midnight Studio dark tokens if convenient, don't reinvent a new dark palette from scratch) with a smooth CSS `transition` on `background-color`/`color` (~400–600ms), not an instant snap and not scroll-scrubbed opacity per section.
    - **This amends rule §4.4** ("light only, now"): the hero stays light, and everything below it on the **landing page** is intentionally dark once scrolled to. This does not extend to the Dashboard or any other app screen — those stay on the light paper palette as already specified in §5; this dark switch is a landing-page scroll effect only.
11. **Live movement behind the book, tied to the cursor.** Add a layer of a few loose flat "paper" shapes behind the main notebook object (same flat-toon material family, lower in the depth stack) that shift/rotate slightly and independently as the cursor moves — like papers being nudged by the same presence the pointer-parallax already implies for the notebook — subtle, not distracting, and disabled under `prefers-reduced-motion` along with the rest of the hero's motion.

---

## Notes for whichever agent runs this

- Use `impeccable` to audit the hero and dashboard once built; use `gpt-taste` to check the result doesn't drift into generic-template territory; use `emil-design-eng` for the 3D scene's motion (rotation speed/easing, pointer response, entrance) and any hover/transition polish elsewhere.
- Figma MCP is wired for Claude Code (`.mcp.json` → `figma-desktop`) but there's no ExamMind reference file in Figma yet, so skip it for this task unless one gets created.
