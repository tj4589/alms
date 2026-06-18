# ExamMind — Engineering Devlog

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
