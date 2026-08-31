# ExamMind Interface System

## Direction

ExamMind is a focused academic workbench for university students working from real course material. It should feel like a quiet study desk: serious, source-aware, compact, and deliberate. The primary action in each view must help the student retrieve, understand, or practise coursework.

## Product World

- Domain: course archives, lecture notes, past questions, grounded retrieval, readiness, practice, and study sessions.
- Signature: a study briefing that turns archive evidence and readiness into one clear next action.
- Depth: border-driven dark surfaces. Use shadows only for true overlays.
- Density: operational and compact, with open space between major groups rather than inside every panel.

## Tokens

The implementation source of truth is `frontend/src/index.css`.

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--desk` | `#0c0d11` |
| Panel | `--desk-panel` | `#12141a` |
| Inset control | `--desk-inset` | `#090a0d` |
| Raised control | `--desk-raised` | `#181b23` |
| Primary text | `--paper-ink` | `#e9eaf0` |
| Supporting text | `--paper-ink-soft` | `#a7adbb` |
| Metadata | `--pencil` | `#7d8498` |
| Brand/action | `--highlighter` | `#e8a23a` |
| Grounded/success | `--source-verified` | `#3ecfb2` |
| Error/destructive | `--correction` | `#f0735a` |

Amber communicates brand and action. Teal is reserved for verified or source-grounded states. Coral is reserved for errors. Purple is not part of the workbench interface.

Spacing uses a 4px base. Standard component gaps are 8px, 12px, 16px, and 24px. Major groups use 32px to 48px. Controls are at least 40px high. Workbench radii are 4px to 6px; avoid pill controls except where the data itself is categorical.

## Typography

- Academic emphasis: Instrument Serif, 400 normal or italic.
- Operational UI: DM Sans variable.
- Course codes, dates, and tabular values: JetBrains Mono variable.
- Fonts are bundled locally through Fontsource so the interface works offline.
- Workbench headings use weight and contrast before size. Compact captions are at least 10px.

## Patterns

- Primary button: 42px minimum height, amber fill, 6px radius, dark text.
- Secondary button: transparent surface, quiet rule, 6px radius.
- Workbench section: unframed, separated by a top rule, 20px top padding.
- Course row: 76px minimum height with course code, title/source count, readiness, and one arrow action.
- Empty state: quiet inset band with a recovery action; never a blank panel.
- Search: native form with a visible label, grounded-state confirmation, and a 44px inset input.
- Mobile navigation: fixed to the bottom; authenticated content reserves bottom breathing room.

## Avoid

- Equal-weight KPI card grids, decorative glows, gradients, glassmorphism, nested cards, and fake metrics.
- Multiple competing accent colors.
- Generic feature copy or placeholder dashboard data.
- Hover effects that move layout, missing focus states, or controls below a 40px hit area.

## Verification

Review authenticated product surfaces at 390px, 768px, 1024px, and 1440px. Require zero horizontal overflow, visible focus states, reduced-motion support, honest loading/empty/error states, and source-grounded language.
