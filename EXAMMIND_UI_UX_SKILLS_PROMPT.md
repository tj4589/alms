> **SUPERSEDED (2026-09-04):** The Midnight Studio direction this prompt assumes has been dropped in favor of a restored light "paper" palette. Use `EXAMMIND_STUDY_DESK_V2_BRIEF.md` instead. This file is kept only for history.

# TASK — ExamMind "Midnight Studio": extend the design system to every remaining screen

Repository: `tj4589/alms` · Frontend: React 19 + TypeScript + Vite, hand-written CSS (no Tailwind, no UI kit).

The Landing page and Student Dashboard already went through a "Midnight Studio" visual pass (see `DEVLOG.md`, `design-system/exammind/MASTER.md`, `.interface-design/system.md`). Every other screen only inherited the new color tokens by alias (the CSS variables were repointed), so it is **on-brand in color but not in layout, density, or motion**. This task closes that gap.

You have three design skills installed in this project (`.agents/skills/`, mirrored to `.claude/skills/` and `.codex/skills/`) in addition to the existing `ui-ux-pro-max` skill. Use them deliberately, not decoratively:

- **`emil-design-eng`** — for every animation, transition, hover state, and micro-interaction decision. Use it to decide *whether* something should animate before deciding how, and to keep easing/duration consistent with the tokens in `index.css` (`--ease`, `--fast`, `--base`, `--slow`).
- **`impeccable`** — run it as a critique/audit pass on each screen after you build it, before moving to the next one. Treat its findings as a checklist, not just a mention.
- **`gpt-taste`** — use it to police against generic-AI-slop defaults: equal-weight card grids, purple-blue gradients, centered-everything layouts, glow-heavy shadows. If a screen looks like a template, it needs another pass.

If a Figma MCP connection is available in this session (`figma-desktop`, added to `.mcp.json`) and there is a reference file for this product, pull the relevant frame(s) before implementing a screen and diff your output against it. If there is no Figma reference file for these screens, skip this — do not invent one.

---

## 0. Non-negotiable rules (unchanged from the original redesign)

1. **No new npm dependency.** Everything ships with what's already in `frontend/package.json`. Charts stay hand-written inline SVG.
2. **No data-flow changes.** Same `apiGet` calls, endpoints, state shape, props, routing, auth, offline/service-worker logic. This is presentation-layer only.
3. **No fake data, ever.** Every empty/zero/loading state must be honest — no invented metrics or deltas.
4. **Dark only.**
5. `cd frontend && npm run build && npm run lint` must pass clean.
6. Keep or improve every existing `aria-*`, `role`, and focus behaviour — never regress accessibility.
7. Update `design-system/exammind/MASTER.md` and `.interface-design/system.md` so they describe what you actually built, and add a `DEVLOG.md` entry per screen (or per batch) you finish.

---

## 1. Scope — screens not yet touched by the Midnight Studio pass

Bring each of these up to the same standard as `Landing.tsx` / `Dashboard.tsx` (real panel/card patterns, segmented data strips instead of equal glowing KPI cards, inset empty/loading/error states, tabular mono numerals, lime used with the same discipline — one accent object per view region):

- `frontend/src/screens/Practice.tsx`
- `frontend/src/screens/Questions.tsx`
- `frontend/src/screens/Analytics.tsx`
- `frontend/src/screens/Progress.tsx` + `Progress.css`
- `frontend/src/screens/StudyGroups.tsx`
- `frontend/src/screens/Collab.tsx`
- `frontend/src/screens/Assistant.tsx`
- `frontend/src/screens/Upload.tsx`
- `frontend/src/screens/SearchResults.tsx`
- `frontend/src/screens/Settings.tsx`
- `frontend/src/screens/Empty.tsx`, `frontend/src/screens/Offline.tsx`
- `frontend/src/components/Auth.tsx` (leave `AuthScene3D.tsx`'s 3D scene alone — restyle only the surrounding chrome/copy/inputs)

Do **not** re-touch `Landing.tsx`, `Dashboard.tsx`/`Dashboard.css`, `App.tsx` chrome, or `Navigation.css` — they're done. If you find a real inconsistency in them while working (e.g. a token that should propagate but doesn't), fix only that, and say so in the DEVLOG entry.

---

## 2. How to work

1. Read `design-system/exammind/MASTER.md` and `.interface-design/system.md` first — they are the source of truth for tokens, radii, type scale, and the named patterns (segmented metric strip, inset empty band, 76px row, bento card, etc.). Reuse these patterns; do not invent new ones per screen.
2. Pick one screen at a time. For each: identify its real states (loading / empty / error / loaded), rebuild it against the established patterns, then run the `impeccable` audit against it and fix what it flags before moving on.
3. Where a screen has genuinely dense or list-heavy content (Questions, StudyGroups, Collab, Assistant), resist the urge to default to a generic card grid — use `gpt-taste` to push for the layout that actually fits the content's structure.
4. Commit one screen (or a tightly related pair, like `Empty`/`Offline`) per commit, so each diff is reviewable.

---

## 3. Acceptance checklist

```
[ ] npm run build passes; npm run lint passes; zero TS errors
[ ] No new dependency in package.json
[ ] No API call, endpoint, prop, or type signature changed
[ ] Every screen in §1 uses the established Midnight Studio patterns, not just inherited colors
[ ] No equal-weight glowing KPI card row anywhere in the app
[ ] Every metric/empty/zero state is honest — "—" plus a real caption, never invented data
[ ] Every panel has real loading, empty, error and loaded states
[ ] Visible focus ring on every interactive element; Esc closes every overlay
[ ] prefers-reduced-motion disables non-essential motion on every screen touched
[ ] Zero horizontal overflow at 390 / 768 / 1024 / 1440 on every screen touched
[ ] design-system/exammind/MASTER.md and .interface-design/system.md still match the code
[ ] DEVLOG.md has an entry per screen/batch describing what changed
```

---

## Notes for whichever agent runs this

- **Skills** (`emil-design-eng`, `impeccable`, `gpt-taste`, `ui-ux-pro-max`) are installed identically for Claude Code and Codex in this repo (`.claude/skills/`, `.codex/skills/`, canonical copies in `.agents/skills/`) — either agent will pick them up.
- **Figma MCP** is currently wired only for Claude Code, via this project's `.mcp.json` (`figma-desktop`, `http://127.0.0.1:3845/mcp`) — Claude Code will prompt to approve it on first use. It requires the Figma desktop app open with Dev Mode's MCP server enabled. Codex does not have this connection configured yet in this project (Codex's MCP config is a global `~/.codex/config.toml`, not project-scoped).
