# ExamMind — Engineering Devlog

# 2026-09-18 - Progress primary buttons stopped flashing amber

Reported from a screenshot of the error state: the "Try again" button looked amber,
not the workspace clay. Measured it -- resting is `rgb(172,64,30)`, correct, but
`Progress.css` sent `:hover` to `#f0b14e`, a light amber. A full hue jump off clay on
hover, and amber is the landing accent, which MASTER.md reserves away from app
surfaces. The screenshot had simply caught the button under the cursor.

Both affected rules -- the "Practice this topic" decision CTA and the state buttons --
now deepen to `var(--text)` on hover, matching the primaries on Practice, Settings and
the shared empty state. Verified: hover is `rgb(37,43,36)`.

Worth recording separately, since the same screenshot raised it: that error state is
not what a first-time user sees. With the API reachable and no attempts recorded,
`/analytics/student/{id}` returns empty arrays and Progress renders the empty state --
"No progress data yet / Complete a practice session to establish your first readiness
score" with a Start practice action. The error state only appears when the request
fails, which in local development means the FastAPI backend is not running.

# 2026-09-18 - Settings on the paper system, and de-duplicated

Settings said everything twice. A "Privacy summary" list of three facts sat above
three `InfoCard`s in an auto-fit `repeat(auto-fit, minmax(260px, 1fr))` grid that
restated the same three facts at greater length, each behind a letter glyph -- "J",
"P", "D" -- in a gold-bordered circle. That is the equal-weight card grid MASTER.md's
Avoid list names, carrying duplicate content.

Merged into one numbered list: the shorter headings from the summary, the fuller
bodies from the cards. Half the screen's content disappeared without losing a single
fact.

Dropped the `.tag` chips. Settings is entirely read-only, and a chip beside a
statement implies a switch you can flip. The facts now carry themselves.

Structure is the app-side pattern: an identity sheet with crop marks over a hairline
definition list with mono uppercase terms, then the data notes as numbered marginalia
at a 78ch measure.

Fixed a small wrong detail: the sheet's initials used `name.slice(0, 2)`, so
"Dev Student" rendered DE while the sidebar avatar rendered DS. Now takes word
initials and both read DS.

Verified at 390/768/1024/1440: zero `.card`, zero `.tag`, zero inline-styled nodes
left on the screen, four account facts, three notes, no horizontal overflow.

# 2026-09-18 - Offline Library and the shared empty state on the paper system

Both screens were still on the generic `.card` + `.two-col` chrome with filled
`.tag` status pills. Rebuilt on the app-side patterns recorded in MASTER.md.

Offline Library is now two collections held by a single rule rather than two cards:
mono uppercase label with a tabular count, a panel title, and a hairline-segmented
list. Status is ink with a dot -- teal `Ready`, pencil `Queued` -- instead of a filled
chip, which keeps the two collections distinguishable without two more colours of
pill. Empty copy states what to do next in both shelves rather than describing the
absence. Both actions are quiet clay text links, not ghost buttons.

The shared empty state becomes a sheet with crop marks, matching Upload and Practice:
mono kicker, serif heading with the existing italic accent, body at a 54ch measure,
and a clay/ghost button pair. Copy drops "your department" for "everyone studying it",
consistent with the shared-archive framing.

No data, props or offline storage logic changed -- `listRecords` calls are untouched.

Verified in the browser at 390/768/1024/1440: two shelves, both empty bands rendering,
zero `.card` and zero `.tag` nodes remaining on the screen, no horizontal overflow.

# 2026-09-18 - Exam Analytics folded into Progress

`Analytics.tsx` and `Progress.tsx` were two implementations of one feature. Both
called `apiGet('/analytics/student/{id}')` and both derived per-topic readiness,
per-attempt scores and questions answered. Progress was the fuller pass -- weakest-topic
recommendation, untruncated readiness list, real history table, and honest
loading/empty/error states -- so it keeps the screen.

Ported across: practice frequency per topic (group attempts by topic label, count,
sort descending). Rebuilt on Progress's own `progress-section` / `progress-topic-list`
markup and `Progress.css` rather than Analytics's inline-styled divs, and placed
between topic readiness and history because it explains the history below it. The
values are counts rather than percentages, so the shared list rule gets a modifier
with a wider value column and a unit ("3 tries").

Fixed while comparing the two: `attempt.score` is the number answered correctly, and
Progress rendered `clampScore(attempt.score)` with a percent sign, so 4 out of 10
displayed as "4%". Analytics had the correct `scorePercent` helper; it came across with
the section. Verified against fixtures -- 4/10, 9/10 and 12/12 now read 40%, 90%, 100%.

Retired: the nav item, the `App.tsx` import and render branch, the now-unused
`ChartLineUpIcon` import, the `'analytics'` key in `ScreenType`, and the screen file.
Re-grepped first -- nothing deep-linked to it, which is why it was the safe one to drop.
`activeScreen` is in-memory `useState('dashboard')`, so no persisted key can go stale.
The remaining Insights item is labelled "Progress", matching the screen's own h1.

No endpoint, response shape or API call changed.

Verified in the browser, not from the CSS: Insights lists one item with a visible focus
ring; Dashboard's "Progress" button and Practice's "View full progress" CTA both land on
`#s-progress` with the breadcrumb reading Progress; loading, empty, error and loaded all
hold at 390/768/1024/1440 with no horizontal overflow.

## 2026-09-07 — Post-launch refinement pass (§7)

Punch list from reviewing the running build. All eleven items applied.

**Object polish.** The muddy toon banding turned out to be a lighting problem, not a gradient-map one: ambient sat at 0.65, which flooded most surfaces into the ramp's top band and collapsed the steps. Ambient drops to 0.34 with the key raised to 1.45. The ramp is also no longer linear — a linear 4-step map bottoms out at 0 and crushes the darkest band to black, so the floor lifts to 72 and all four steps stay distinct. Bevels tighten (0.012 → 0.007, 2 segments → 1) and the outline thins (0.014 → 0.009). The highlighter was the genuinely unfinished part: it sat at `y -0.78` with its nib pointing away from the highlighted line at `y -0.2`, so it was stroking nothing. It now lands its nib on the right end of that line and angles down-right past the page edge.

**Composition.** The giant "ExamMind." headline becomes a backdrop phrase — "Never Leave your workspace again." — moved behind the object in z-order. It is decorative and `aria-hidden`, because at the contrast a backdrop needs (~11% ink) it would fail as a real heading; the lede is promoted to the hero's `h1` instead, so there is still exactly one honest readable heading. The nav wordmark is untouched. The "Your private academic index" eyebrow is gone. Copy gained a feathered paper scrim, since it now sits over the backdrop phrase, the bloom, the canvas and the grain.

**Atmosphere.** The hero field is no longer flat — a lerped radial highlight follows the pointer through CSS custom properties, frozen centred under reduced motion. Five loose sheets drift behind the notebook, each on its own drift multiplier and lerp rate. Nav links draw an accent ring around themselves on hover, looping, reusing the reveal's `pathLength` mechanism. A branded preloader draws one construction line under the brand mark and cross-fades out.

**Scroll.** Pin wrapper drops 230vh → 150vh so the hero clears faster. Sections dim toward black at their edges as they move away from viewport centre.

The vignette is worth being precise about, because it is easy to ship wrong: it is a `pointer-events:none` overlay whose opacity is driven by distance from viewport centre. Section background tokens are never touched — delete the overlay and the light palette is exactly what remains, so rule §4.4 still holds. It is position-driven, as §7.10 specifies, not velocity-driven, which means a section parked at the viewport edge stays dimmed when scrolling stops. The section you are centred on is always full light. No class persists and no token flips.

**Ambient imagery — mechanism shipped, files not.** The layer globs `src/assets/ambient/` at build time and renders nothing while that folder is empty, which is its current state. Fifteen placement slots sit around the hero edges clear of the copy and object, each cycling a slow blur/fade, duotoned in CSS rather than baked into the files. Adding imagery is now a matter of dropping licensed files into the folder — no code change. The sourcing itself is outstanding and needs licensed photography (Unsplash/Pexels-type) or illustration; §7.7 asks for both to be tried and the better one against the flat-toon object kept, which needs a human eye. The folder README carries the licensing requirement and an attribution table.

Still unverified by eye: every constant in this pass was reasoned rather than tuned against the running page.

## 2026-09-07 — Hero reveal: dropped the figurative hands

The reveal's converging shapes are no longer required to read as reaching hands, and the *Creation of Adam* reference is dropped from the brief's scope. The technique is unchanged and was never the problem — offscreen canvas mask, grid-sampled dots, jittered position and radius for organic texture. Only the silhouette changed: instead of a traced hand path, the mask is now painted procedurally as a blurred, tapering plume of overlapping lobes that breaks into satellites toward the tip, deterministically seeded so it stays stable across re-renders while per-dot jitter stays random.

This also removed an external dependency the hero didn't need. The figurative version was blocked on artwork that had to be produced and licensed; two of the three references were another artist's restyling and not ours to ship. The abstract version has no such constraint.

The mask now carries a smooth alpha falloff along its length rather than a hard edge, and dot alpha scales with mask alpha as well as radius, so the stipple thins out toward the object instead of stopping abruptly.

The amber→sepia gradient from the previous pass is unchanged and was explicitly kept: flat amber on cream is ~1.9:1, and at that contrast fine dots stop resolving as texture once they are no longer backed by black. `renderDotHand` → `renderDotCluster`, `.em-hero-hand(s)` → `.em-hero-cluster(s)`, `emHandIn` → `emClusterIn`; no stale hand references remain in `src/`.

## 2026-09-06 — Study Desk v2: paper palette restored, 3D hero added

**Midnight Studio is reverted and superseded.** It never deployed. The landing, dashboard and tokens were restored to the pre-Midnight-Studio academic-workbench baseline, then rebuilt from ExamMind's own light paper palette. The app is light only now — there is no dark theme and no dark-mode variant to maintain.

**Tokens.** `--em-paper` / `--em-paper-2` / `--em-ink` / `--em-accent` moved out of Landing's local scope into `:root`, with every legacy alias (`--bg`, `--text`, `--gold`, `--surface`, `--border`, …) repointed at them so untouched screens inherit the light system for free. Semantic colours kept their roles but were re-weighted for legibility on paper rather than on near-black: verified teal `#3ecfb2` → `#147a6a`, correction coral `#f0735a` → `#c8492f`, purple `#9b87f5` → `#6d5bb5`. The focus ring moved from amber to ink — amber measured roughly 1.9:1 against cream, which is not a usable indicator. Added the `--fast`/`--base`/`--slow`/`--ease` motion tokens, which the design brief referenced but which had never actually been defined.

**The hero.** The dark study-desk photo is gone, replaced by "The Highlighted Page": one notebook page extruded from a `THREE.Shape` whose binding holes are punched through the geometry via a `holes` array, with ruled lines, an amber highlight bar, a dog-eared corner and a highlighter resting across the bottom edge. Flat `MeshToonMaterial` with a nearest-filtered gradient map plus an inverted-hull `OutlineEffect` pass — the nearest-filter detail is what makes the banding read as illustration instead of a soft ramp, and the official three.js toon example omits it. No new dependency; `three` and `@react-three/fiber` were already here.

The reveal is one choreographed sequence, not independent pieces: construction lines draw in via SVG `pathLength="1"` + `stroke-dashoffset`, two dot-matrix hands stipple in from either edge, then the page settles into the frame. The hands are a flat 2D canvas stipple — silhouette filled offscreen, sampled on a grid, drawn as jittered ink dots — deliberately not modelled 3D hands, which is a much faster route back into uncanny-AI territory. On scroll the whole hero scales and fades as one unit over ~2.3 viewports while real content scrolls up beneath it, on plain scroll-position maths.

This was ported from `design-system/references/hero-prototype-reference.html`, a working vanilla three.js prototype. Two bugs in it were deliberately **not** carried over: it set `opacity` inline on the SVG construction lines, which overrode their 0.13–0.3 base opacity and would have rendered them at full-strength ink at rest; and it set `opacity` inline on the hand canvases, which silently did nothing, because a running CSS animation with `forwards` fill outranks inline styles in the cascade. Both fades now sit on un-animated parent wrappers, where they multiply correctly and can't lose the cascade.

**Requirements the prototype did not cover** are implemented: reduced-motion renders a fixed resting pose with no reveal, idle or parallax; the render loop pauses outright on tab blur; a WebGL check falls back to a flat card silhouette; and the canvas is lazy-mounted so three.js stays out of the first-paint chunk (it builds to its own ~9 kB chunk). Pointer parallax is continuous hover using `useThree().pointer`, matching `AuthScene3D.tsx`'s existing lerp convention — `useReducedMotion` was extracted to `lib/` so both scenes share one implementation.

**Nav.** The landing nav starts flush and collapses past 32px of scroll into a floating, rounded, blurred pill, reversing on the way back to the top. Eased with the shared tokens, disabled under reduced motion, landing only.

**Dashboard.** `Dashboard.css` and the shared `.wb-*` shell were already largely token-driven, so the global promotion flipped most of it. Fixed what was hardcoded for a near-black ground: panel/sheet/command-bar fills inverted from translucent near-black to translucent white, shadows retinted from pure black to ink, row hover washes flipped from lighten to darken, the amber CTA's label repointed from `--desk-inset` (now white, on amber) to ink, and the global-search popover's near-black glass background swapped to white — its text comes from tokens, so it would otherwise have rendered ink-on-near-black.

Landing hero visual verification (object framing, stipple legibility, chip placement) is still pending a human pass; those constants were ported from the prototype rather than tuned by eye.

## 2026-09-04 — Midnight Studio visual pass

The landing page and authenticated dashboard now use a dark Midnight Studio system: electric lime is the restrained brand/action accent, Instrument Serif carries editorial emphasis, and the dashboard prioritises a real next-study action, archive evidence, course rows, and honest empty/loading/error states. The old amber brand treatment is retired (amber remains available for attention states). The landing page no longer uses the orange study-desk hero image or light paper sections; its product preview is HTML/CSS and its material band/closing CTA are the only lime blocks.

AI-powered LMS for Nigerian universities. FastAPI + PostgreSQL + pgvector backend, React 19 + TypeScript + Vite frontend, OpenAI RAG pipeline.

---

## Stack at a glance

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Backend | FastAPI, SQLAlchemy, Pydantic v2 |
| Database | PostgreSQL + pgvector |
| AI | OpenAI text-embedding-3-small (embeddings), GPT-4o (metadata + RAG) |
| Auth | JWT HS256, 7-day expiry, Bearer token |
| Offline | IndexedDB (studyPacks, pendingUploads, practiceAttempts stores) |

---

## Completed fixes and features (Phase walkthrough)

### Phase 1 — Auth page CSS
**Problem:** Auth.tsx used CSS variables that don't exist in the design system (`--accent-primary`, `--border-color`, `--surface-color`, `--text-primary`, `--text-secondary`, `glass-panel`, `btn-primary`, `container`, `animate-fade-in`). The page rendered with no styles.

**Fix:** Full rewrite of `frontend/src/components/Auth.tsx` using the actual design tokens defined in `index.css`: `--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text2`, `--text3`, `--gold`, `--teal`, `--coral`, `--r`, `--rlg`, `.cta`, `.upload-alert`.

**React 19 note:** `React.FormEvent` is deprecated. Removed the type annotation entirely — `handleSubmit` is a plain `async () => void` function, and `e.preventDefault()` runs inline in JSX: `onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}`.

---

### Phase 2 — User context + GET /auth/me
**Problem:** After login the app had no concept of who the logged-in user was. Sidebar showed placeholder text. No name or role anywhere in the UI.

**Fix:**
- Added `GET /auth/me` endpoint to `backend/routers/auth.py` — returns the current user from the JWT via `Depends(auth.get_current_user)`.
- Added `User` and `ChatMessage` types to `frontend/src/types.ts`.
- Rewrote `App.tsx` with `user: User | null` state. On mount, if a token is in localStorage, immediately calls `/auth/me` to hydrate user info. On login, calls `/auth/me` after storing the JWT. Clears user on logout.
- Sidebar now shows real name, initials (computed from first+last name), and role.

---

### Phase 3 — AI chat history persists across navigation
**Problem:** Every time the user navigated away from the AI Assistant screen and came back, the chat was wiped. `Assistant.tsx` held `messages` in local state; React unmounted and remounted it on every navigation, resetting the state.

**Fix:** Lifted `chatMessages` state up to `App.tsx`. `Assistant.tsx` now receives `messages` and `onMessagesChange` as props. Because the state lives in the parent, it survives navigation. Added `useRef` + `useEffect` scroll-to-bottom so the chat auto-scrolls to the latest message.

---

### Phase 4 — Backend correctness fixes
**Problem 1:** `datetime.utcnow()` is deprecated in Python 3.12+.
**Fix:** Replaced with `datetime.now(timezone.utc)` throughout `backend/models.py`.

**Problem 2:** `echo=True` was hardcoded in `create_engine(...)`, which dumps every SQL query to stdout in production.
**Fix:** `echo=os.getenv("SQL_ECHO", "false").lower() == "true"` in `backend/database.py`. Added `SQL_ECHO=false` to `backend/.env.example`.

---

### Phase 5 — Practice screen self-loop button
**Problem:** The "Start practicing" button on the Practice result card navigated back to the Practice screen itself — a self-loop. Also, `go` was imported but effectively unused after that, causing a lint warning.

**Fix:** Result card now has two real CTAs:
- "View full progress →" → `go('progress')`
- "Practice again" → resets `result`, `generatedQuestions`, `answers` state inline

---

### Phase 6 — Password validation
**Problem:** No minimum length enforcement on registration. A user could register with a 1-character password.

**Fix:** Added `Field(min_length=8)` to `password` and `Field(min_length=2)` to `name` in `backend/schemas.py` via Pydantic v2. Frontend `<input type="password">` also has `minLength={8}` as a native HTML attribute.

---

### Phase 8 — Dashboard connected to real API
**Problem:** Dashboard showed hardcoded placeholder numbers (142 questions, 71% score, 8 topics mastered, 4 sessions).

**Fix:** Fetches `GET /analytics/student/{user.id}` on mount. Derives:
- `totalPracticed` — sum of `total_questions` across all attempts
- `avgScore` — mean of attempt scores
- `masteredCount` — readiness entries with score ≥ 80
- `inProgressCount` — readiness entries with score 50–79
- `sessionCount` — attempt count
- `topReadiness` — top 4 topics by readiness score (drives the readiness bars)
- `weekBars` — this week's attempts grouped by day (Mon=0…Sun=6), scaled to 64px max bar height

Falls back to static demo values silently on fetch failure (no empty states, no spinners).

---

### Phase 9 — Progress screen connected to real API
**Problem:** Progress screen was entirely hardcoded.

**Fix:** Same `GET /analytics/student/{userId}` fetch. Derives:
- `overallMastery` — mean of all readiness scores
- `streak` — consecutive days with attempts, walking backwards from today using a `Set` of date strings
- `badgeCount` — topics scored ≥ 70%
- `sortedReadiness` — all topics sorted weakest-first so gaps are visible
- `weekBars` — same weekly activity chart as Dashboard
- `busiestDayIdx` — day with the most sessions
- `recentAttempts` — last 5 attempts newest-first

"Upcoming Goals" card replaced with "Recent Practice" showing real attempt history.

---

### Phase 10 — Collab screen connected to real threads API
**Problem:** Collab screen was fully static; the four thread endpoints already existed on the backend but were never called.

**Fix:** Full rewrite of `frontend/src/screens/Collab.tsx`:

**Thread list view:**
- Loads `GET /threads` on mount
- `+ New thread` button reveals an inline form; Enter or button calls `POST /threads`, re-fetches
- While empty, shows faded demo threads so the screen doesn't look broken
- Gradient avatars derived from `thread.id` for visual variety

**Thread messages view (drill-down):**
- Opens on thread click: fetches `GET /threads/{id}/messages`
- Back button returns to thread list
- Each message styled by author — teal "ExamMind AI" label for AI responses, "You" for current user, gradient avatar for others
- Post reply calls `POST /threads/{id}/message`, re-fetches messages to capture the optional `@AI` auto-response
- Hint appears when `@AI` is typed; auto-scrolls to latest message

**Right panel:** Static "Type @AI in any thread" tip card + two study group cards wired to `notifyUnavailable`.

Also: `user` prop added to Collab so message ownership (isMe) can be determined client-side.

---

### Phase 11 — Offline auto-sync loop
**Problem:** When offline, `Upload.tsx` correctly queued uploads to IndexedDB — but when connectivity returned, the queue just sat there forever. No sync-back mechanism existed.

**Root cause:** `PendingUpload` stored only file metadata (name, size) — not the actual file bytes. You can't re-POST a file you don't have.

**Fix:**
- `PendingUpload` type gains `fileData: ArrayBuffer`. `queuePendingUpload` now reads the file bytes with `file.arrayBuffer()` before writing to IndexedDB.
- New `removePendingUpload(id)` deletes a record after successful sync.
- `OfflineStatus.tsx` listens for the browser `online` event. When it fires, `syncUploads()` runs: iterates the IndexedDB queue, reconstructs each `File` from its `ArrayBuffer`, POSTs to `/ingest/upload` with `confirm=true` (analyze + index in one shot), removes successful records, fires `exammind-offline-updated` to refresh counts. Failed uploads stay in the queue and retry on the next `online` event.
- Status pill shows "Syncing..." while in progress, "Online" after.
- No sync button — fully automatic.

---

### Phase 12 — Analytics screen connected to real API
**Problem:** Entire Analytics screen was hardcoded with fictional numbers.

**Fix:**
- `GET /analytics/cohort` backend access changed to authenticated student access — aggregate stats (class avg score, topic frequency, active students) are useful to students reviewing exam readiness.
- `Analytics.tsx` fetches cohort data on mount. Stats cards show real `questions_attempted`, `active_students`, `avg_practice_score`. Topic frequency chart uses `most_challenging_topics` sorted by attempt count (most practiced first). Falls back to static demo silently.
- Removed the legacy alternate-view indicator so analytics remains a student-facing screen.
- `user` prop threaded through from `App.tsx`.

---

### Phase 13 — Collab badge dynamic + Upload recent history
**Problem 1:** Sidebar Collab nav item had a hardcoded `3` badge — meaningless.
**Fix:** Removed the badge entirely. A fake number is worse than no number.

**Problem 2:** Upload screen "Recent uploads" card said "No recent uploads endpoint is available yet."
**Fix:**
- Backend `GET /past-questions` gains optional `uploaded_by: int` query param (2-line change in `mvp.py`).
- `Upload.tsx` accepts `user: User | null` prop, fetches `GET /past-questions?uploaded_by={user.id}` on mount and after each successful upload (by including `state` in the dependency array). Renders the last 3 indexed documents: course code, document type, year.

---

## Design patterns used throughout

**Silent fallback:** Every screen that fetches real data shows static demo values while loading and on error — no empty states, no spinners, no "Loading..." placeholders that look broken.

**State lifting:** `chatMessages` and `user` live in `App.tsx` so they survive navigation. Child components that need them receive them as props.

**`void` prefix on async JSX handlers:** `onClick={() => void sendQuestion()}` — satisfies the no-floating-promises rule without needing a wrapper function for every event.

**Cancelled fetch pattern:** `let cancelled = false` + cleanup `return () => { cancelled = true; }` in every `useEffect` that fetches — prevents state updates on unmounted components.

**`useRef` + `useEffect` for auto-scroll:** `msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })` triggered in an effect that depends on the messages array.

---

## What still needs to be done

### Broken / incomplete today (must-fix)

| Item | Location | Detail |
|---|---|---|
| Search bar does nothing | `App.tsx` topbar | `<input>` exists but has no `onChange`, no search logic, no results. Needs debounced query to `GET /past-questions?topic=...` or a Fuse.js local search. |
| Settings button does nothing | `App.tsx` topbar | Calls `notifyUnavailable('Settings')`. No settings screen exists. |
| Notifications button does nothing | `App.tsx` topbar | Calls `notifyUnavailable('Notifications')`. No notifications screen. |
| Thread messages show "S" for other users | `Collab.tsx` | `msg.user_id` is stored but the username is not. Backend `GET /threads/{id}/messages` returns `user_id` but not `user_name`. Need to either join the user table in the backend response, or fetch a user map separately. |
| Offline practice attempts not queued | `offline.ts` | The `practiceAttempts` IndexedDB store exists and is set up in `onupgradeneeded` but nothing ever writes to it. If a student completes a practice session while offline, the score is lost. |
| Exam countdown is hardcoded | `Dashboard.tsx` | 14 days 06 hrs 32 min — static. There is no exam/calendar model in the backend. |
| Analytics course filter is hardcoded | `Analytics.tsx` | The `<select>` shows CSC 301 / CSC 205 / CSC 312 as fixed options. Changing it fires `notifyUnavailable`. Needs `GET /courses` fetch + per-course cohort endpoint. |
| Auto-synced offline uploads skip metadata review | `OfflineStatus.tsx` | Sync posts with `confirm=true`, which bypasses the metadata review step. If the AI extracts wrong metadata, the user won't know. Consider: after sync, show a toast "1 file synced — check Upload for details" and link to the Upload screen. |

---

### Should be built next (high value, reasonable scope)

**1. Real username in thread messages**
Backend: add `user_name: str | None` to `ThreadMessage` response by joining the `users` table in `list_thread_messages`. Frontend: replace the hardcoded `"S"` avatar label with the actual first name initial.

**2. Password reset flow**
No "Forgot password?" link exists. Backend needs a `POST /auth/forgot-password` (sends email with a time-limited token) and `POST /auth/reset-password`. Frontend needs the forms. Without this, locked-out users have no self-service path.

**3. Email verification on sign-up**
Currently any email can register and immediately use the app. Add a `verified: bool` flag to the User model, send a verification email on registration, and block login for unverified accounts (or soft-block with a banner).

**4. Topbar search**
Wire the existing search input to `GET /past-questions?topic=<query>`. Debounce 300ms. Show results in a dropdown below the search bar — clicking a result opens the Questions screen filtered to that topic, or sends it directly to the AI Assistant.

**5. Offline practice queuing**
When `!navigator.onLine` and the student completes a Practice session, write the attempt to the `practiceAttempts` IndexedDB store. On reconnect (same `online` event handler in `OfflineStatus`), iterate the store, POST each to `POST /practice/submit`, delete on success.

**6. Settings screen**
Add a `settings` screen type. Basic settings: change display name, change password (needs `PATCH /auth/me`), notification preferences (stored in localStorage since there's no backend for this yet).

**7. Per-course cohort analytics**
Backend: add `GET /analytics/cohort?course_id=N` — same logic as the current cohort endpoint but filtered by course. Frontend: wire the Analytics course `<select>` to real courses from `GET /courses`, re-fetch cohort data on change.

**8. Thread: show who started it**
`DiscussionThread.created_by` is a user ID. Backend: join users table and return `created_by_name`. Frontend: show "Started by [name] · [timeAgo]" in the thread list and at the top of the messages view.

---

### Would be cool (bigger scope, future sprints)

**AI exam predictor (real)**
The current "AI prediction" card in Analytics is static copy. A real implementation would:
1. Count topic occurrences per year across all uploaded past questions (query the `metadata_json->topics_covered` JSONB array).
2. Fit a simple frequency model per topic.
3. Return the top 3 "due" topics — ones that appear historically but haven't appeared in the last 2 years.
This is entirely doable within the existing FastAPI + PostgreSQL stack. No new AI calls needed.

**Spaced repetition for practice**
Instead of randomly pulling past questions for Practice, implement a basic SM-2 algorithm: track the last time each past question was answered correctly, schedule the next review based on the interval. Store `next_review_at` and `ease_factor` on the `ReadinessScore` or a new `QuestionReview` table.

**Timed mock exam**
A "Simulate exam" mode that picks N questions from a specific course (like an actual exam paper), locks the UI in fullscreen, runs a countdown timer, and auto-submits at zero. Results page shows a breakdown vs the class average.

**Readiness score decay**
Currently readiness scores only go up. A topic you haven't practiced in 30 days should drift back toward 0. Add a background job (or compute on-the-fly) that multiplies the score by a decay factor based on days since last attempt.

**Leaderboard (opt-in)**
Anonymous by default. Students can opt in to show their display name. Shows top 10 by overall mastery score for a given course. Entirely from existing `ReadinessScore` data — no new backend model needed.

**Study group live sessions**
The StudyGroups screen is currently fully static. A real implementation would need WebSocket support (FastAPI has native WebSocket support via `@app.websocket`). Each session is a room; messages broadcast to all connected clients. This is the largest item — plan for a separate sprint.

**PDF viewer in-app**
Instead of storing only extracted text, show the original PDF alongside questions. Use `pdf.js` (Mozilla's open-source renderer) in an iframe or a React wrapper. Would need `file_url` to be a real accessible URL (currently it stores the filename, not a hosted URL).

**OCR for scanned PDFs**
Currently `PyPDF2` extracts text directly — it fails on image-only scans (which many Nigerian university past question PDFs are). Add a fallback: if extracted text is under a threshold, run the PDF through Tesseract OCR (via `pytesseract`) or send pages to GPT-4o Vision for text extraction.

**Batch upload**
Allow dropping multiple PDFs at once. Queue them as a list, process sequentially, show per-file progress. One backend call per file — the existing `/ingest/upload` endpoint handles it.

**Progress export (PDF report)**
"Download my progress report" button on the Progress screen. Generates a PDF using `jsPDF` or `html2canvas` showing mastery scores, streak, recent attempts, and weakest topics. Good for sharing with tutors or keeping personal records.

**Mobile app**
React Native with Expo. The backend is already API-first so nothing changes server-side. The IndexedDB offline store would need to be replaced with AsyncStorage + SQLite equivalents.

---

## File map (key files only)

```
alms/
├── backend/
│   ├── auth.py              — JWT issue/verify, get_current_user, require_role
│   ├── database.py          — SQLAlchemy engine + session
│   ├── models.py            — User, Course, PastQuestion, LectureNote, DiscussionThread,
│   │                          ThreadMessage, PracticeAttempt, ReadinessScore
│   ├── schemas.py           — Pydantic v2 request/response models
│   ├── routers/
│   │   ├── auth.py          — POST /auth/register, POST /auth/login, GET /auth/me
│   │   ├── ingest.py        — POST /ingest/upload (PDF → AI metadata → index)
│   │   ├── mvp.py           — /courses, /past-questions, /threads, /practice, /analytics
│   │   └── rag.py           — POST /rag/ask (RAG pipeline)
│   └── .env.example
│
└── frontend/src/
    ├── types.ts             — User, ChatMessage, ScreenType
    ├── lib/api.ts           — apiGet, apiPost, apiFormPost (all attach JWT automatically)
    ├── offline.ts           — IndexedDB helpers: saveStudyPack, queuePendingUpload,
    │                          removePendingUpload, listRecords, countRecords
    ├── App.tsx              — Shell, routing, user + chatMessages state
    ├── components/
    │   ├── Auth.tsx         — Login + register form
    │   └── OfflineStatus.tsx — Online/offline pill + auto-sync on reconnect
    └── screens/
        ├── Dashboard.tsx    — Real analytics from /analytics/student/{id}
        ├── Questions.tsx    — Real data from /past-questions + /courses; offline save
        ├── Assistant.tsx    — RAG chat; messages state lifted to App
        ├── Upload.tsx       — PDF upload pipeline; offline queue; recent uploads
        ├── Practice.tsx     — AI-generated practice questions; submit to /practice/submit
        ├── Progress.tsx     — Real analytics; streak calc; topic breakdown
        ├── Collab.tsx       — Real thread CRUD; @AI triggers; drill-down messages view
        ├── Analytics.tsx    — Real cohort data from /analytics/cohort
        ├── Offline.tsx      — Displays IndexedDB studyPacks + pendingUploads
        ├── StudyGroups.tsx  — Two tabs: Study Groups + Reading Rooms (fully live)
        └── Questions.tsx    — Smart Search with study_sessions results
```

---

## Sprint: Reading Rooms + Campus Social Space

### What was built

Evolved Study Groups into a campus-based live study social space with two areas:

**Study Groups** (preserved and extended)
- Real join/leave with optimistic UI and `@username` display
- Group list + "My Groups" panel

**Reading Rooms** (new)
- Live study sessions with heartbeat-based presence (2-min timeout)
- Three participant states: `studying`, `on_break`, `left`
- Actions: Take Break / Back to Study / Leave Room — no focus timer, no productivity tracking

**AI Study Board** (inside rooms)
- Shared AI cards — everyone in the room sees every answer
- Cards show: who asked (`@username`), timestamp, question, full AI answer, source chips per document, flags (Found in lecture notes / No lecture note found / Found in past questions / No past question found)
- Backed by the same RAG pipeline as the AI Assistant — `run_rag_query()` extracted as a shared helper
- Chat gets a brief event: `@vera asked ExamMind AI: Explain Dijkstra…` with "View answer →"

**Discussion Chat** (separate from AI Board)
- Normal room chat with `@username` labels
- AI events styled as compact center chips — don't pollute the conversation

**People panel**
- Active participants only (heartbeat < 2 min old), with studying/on_break badge

**Smart Search updated**
- `/search` endpoint now includes `study_sessions` — active rooms matching the keyword
- Questions.tsx renders a "Reading Rooms" section in results

**@username throughout the app**
- Sidebar shows `@username` instead of role
- Thread starters, group creators, room creators, chat messages — all `@username`
- Auth page: username field with live sanitization (`/[^a-z0-9_]/g`)

**School email validation**
- `ALLOWED_SCHOOL_EMAIL_DOMAINS` env var (comma-separated)
- On register: checks domain, blocks non-matching with a clear message
- Auth page: "School Email" label, Covenant University hint
- School derives from email — not stored as a separate column on users

### New backend files

| File | Purpose |
|------|---------|
| `routers/sessions.py` | 12 endpoints for Reading Rooms |
| `routers/search.py` | Full-text search across all content types |
| `migrate.py` | Idempotent migration script — run once after setting up `.env` |

### New API endpoints

```
GET  /study-sessions                  list rooms (participant counts, my_status)
POST /study-sessions                  create a room
GET  /study-sessions/{id}             room detail with participants
POST /study-sessions/{id}/join        join (idempotent)
POST /study-sessions/{id}/break       set status = on_break
POST /study-sessions/{id}/back        set status = studying
POST /study-sessions/{id}/leave       set status = left
POST /study-sessions/{id}/heartbeat   update last_seen_at
GET  /study-sessions/{id}/messages    get chat messages
POST /study-sessions/{id}/messages    send a message
GET  /study-sessions/{id}/ai-board    get AI study cards
POST /study-sessions/{id}/ask-ai      ask AI → card + ai_event chat message
GET  /search?q=...                    search all content types
```

### New DB tables

```
study_sessions
  id, title, description, course_id, topic, exam_goal, group_id,
  created_by → users.id, school_name (derived from email),
  starts_at, ends_at, status (active|ended), created_at

study_session_participants
  id, session_id, user_id, joined_at, last_seen_at, status, left_at

study_session_messages
  id, session_id, user_id, content, message_type (chat|ai_event), created_at

study_session_ai_questions
  id, session_id, asked_by, question, answer,
  sources, past_question_sources, lecture_note_sources (all JSON),
  no_past_questions_found, no_lecture_notes_found, created_at
```

### Running the migration

```bash
# 1. Create backend/.env from the example
cp backend/.env.example backend/.env
# Fill in DATABASE_URL, SECRET_KEY, OPENAI_API_KEY

# 2. Run the migration
cd backend
python migrate.py
```

The script is idempotent: `ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR UNIQUE` and `Base.metadata.create_all(bind=engine)` for new tables.

### Design decisions recorded

**No focus timer**: presence only — studying vs. on break. This is not a productivity tracker.

**AI Board ≠ Chat**: AI answers stored in `study_session_ai_questions`; chat only gets a short event notice. Long AI answers never flood the chat.

**school_name removed from User**: School is always derivable from the email domain. `StudySession.school_name` is a denormalized field auto-set from the creator's email at creation time — allows filtering rooms by school without a join.

**10s polling instead of WebSocket**: Keeps things simple for now. Heartbeat sent on every poll tick. WebSocket upgrade is a future sprint.

**username nullable on existing users**: PostgreSQL allows multiple NULLs in a unique column — existing rows don't conflict.
# 2026-09-17 — Reusable walking mascot preview

Added `WalkingBot.tsx`, scoped handwritten CSS and an isolated `WalkingBotFallback.tsx`. Mounted once beneath the dashboard priority panel. The component owns only movement/artwork, with typed size, timing, direction, accessibility and optional sprite props. No dependency, API or assistant-state changes.

Inspected package configuration, global/app/dashboard styles, dashboard/landing code and all available image assets. `hero.png` is unrelated decorative artwork. Current Maxe is a React SVG with front/profile poses, not a sprite sheet. The attachment contains text only; no backpack/wire character reference was available. The existing source is retained and the fallback does not invent missing anatomy. The README specifies the final eight gait frames plus neutral/turn cells. Approximate fallback contact compensation is not a claim of finished production articulation.

Container measurements determine travel and gait timing. Each crossing completes whole cycles, pauses for 500ms and turns for 340ms. CSS animates separate legs, subtle bounce, antenna and a separate shadow; native Web Animations handles travel/turn timing. IntersectionObserver, document visibility and reduced-motion preference stop unnecessary work. The lane reserves height and confines overflow locally.

Validation: frontend lint and production build passed (existing Vite chunk-size warning). Browser checks passed at 375/768/1024/1440px for containment, alternating legs, turn and return, offscreen pause and stationary reduced motion. Desktop/mobile screenshots were inspected. Production artwork still requires the original reference and visually approved frames. Changes are deliberately uncommitted pending the user's visual approval.

The earlier Maxe peek/reveal/walk work is now represented by the existing committed `MaxeTrigger`/`MaxeMark` implementation. This addition leaves that source and its conversation behavior intact. Referenced `claude/` design files were absent; current repository tokens and rendered dashboard supplied the visual authority. The Impeccable scanner was unavailable because its Windows engine binary is missing.
