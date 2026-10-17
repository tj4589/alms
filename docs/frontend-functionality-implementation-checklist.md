# Frontend functionality implementation checklist

Status: active product-direction checklist, created 2026-10-07. Preserve
unrelated changes in the working tree.

2026-10-09 evidence update: see `docs/project-integrity-review.md` for the
314-test provider-isolated suite and independently run browser fixtures. Source
and mocked browser coverage are separate from live provider/deployment proof.
2026-10-16 continuation: local migrations 0006 and 0007 and route guards
provide durable ownership for collaboration records and the course catalogue.
The approved legacy policy quarantines ambiguous rows for global-admin review;
only the eight documented pre-space CU catalogue codes are backfilled by 0007.
The provider-isolated backend suite passes 327 tests. Course and material
cross-space tests pass locally, but 0006/0007 PostgreSQL rehearsal and
dedicated student collaboration browser flows remain unverified. No
production migration or deployment has been performed.

## Non-negotiable completion rule

Every advertised feature must work end to end. A server-dependent control is
not complete until the UI calls the real endpoint, the backend validates and
authorizes it, persistence and processing/delivery complete as applicable,
and the UI displays the actual result. Local navigation/display controls may
remain local when they make no server-side claim. Mocks and optimistic success
messages are not completion evidence.

## Batch 1 — learning-space-specific routing and access

- [x] Restore a single active CU/KSA membership as the authenticated context.
- [x] Preserve multiple memberships without exposing a general school picker;
  reuse only a valid server-selected active context and fail closed when it is
  absent or stale.
- [x] Keep stale or tampered active-space pointers fail-closed; do not remove
  memberships or resources.
- [x] Hide the ordinary single-space “Switch learning space” action and keep
  global-admin controls separately gated.
- [x] Prevent a single-membership account with inconsistent context data from
  entering workspace content; provide retry/sign-out recovery.
- [x] Run backend and frontend validation for this batch and isolated browser
  checks at desktop/mobile sizes. The project venv suite, frontend checks and
  Playwright access fixture passed locally on 2026-10-08.

Expected evidence: focused learning-space tests, frontend lint/typecheck/build,
and an isolated fixture proving single CU, single KSA, multi-space and stale
pointer behavior.

## Batch 2 — audited feature integrations

### KSA preferences

- [x] Add a permission-aware edit path for KSA preferences. Implemented as
  `PUT /learning-spaces/ksa/preferences`, requiring active KSA membership.
- [x] Map explicit KSA goals/help topics/explanation preference into bounded
  Maxe prompt guidance and authorized unscoped quiz topic focus.
- [x] Preserve the distinction between explicit choices and inferred behavior.
- [x] Browser-verify KSA save/reload/failure retention and editable preferences;
  verify explicit supported quiz-format defaults. Bounded Maxe preference
  context has focused tests; real provider wording remains unverified.

### Reminders

- [x] Implement explicit owner consent, email/browser-push subscriptions,
  unsubscribe state and owner-scoped delivery tracking.
- [x] Add atomic period-key duplicate prevention and deterministic mocked
  delivery verification without sending real notifications.
- [x] Add a fail-closed `backend/reminder_worker.py` entry point with explicit
  daily/weekly period keys, bounded batches and database-idempotent delivery.
- [ ] Approve the reminder cadence/trigger policy and configure a scheduled
  worker plus external SMTP and VAPID providers before enabling delivery.
- [x] Complete an isolated browser verification of mocked permission prompts,
  subscription recovery and opt-out UI; no real notification send is allowed
  during local validation. The bounded Playwright fixture passed desktop/mobile
  on 2026-10-17 with a test-only public VAPID key; the real provider and worker
  remain disabled.

### Related questions and early access

Current implementation:

- [x] Authorized related-question retrieval uses `GET /rag/related-questions`
  and renders loading/error/empty/result states in Assistant.
- [x] Authenticated early-access requests use
  `POST /learning-spaces/early-access-requests`, persist idempotently and do
  not grant membership.
- [x] Browser-verify visible related-question retrieval and persisted
  early-access request feedback with deterministic fixtures; immediate duplicate
  request guard now verified.

The unchecked entries immediately below are historical pre-Batch-2 proposals;
the current status is the implementation list above.

- Historical pre-Batch-2 proposals (superseded; see current implementation
  list above): related-question retrieval and persisted early-access request.

## Batch 3 — representative material-processing matrix

For each advertised format, record validation, size/type checks, original-file
preservation, extraction/transcription, Reader/search/Maxe usability,
page/slide/timestamp provenance, retry/failure behavior, authorization and
school isolation.

- [ ] Text PDFs.
- [ ] Scanned PDFs with OCR.
- [ ] Typed notes and supported document/presentation formats.
- [ ] Handwritten notes/images: OCR exists for images/scanned documents, but
  handwriting-specific evidence is still required before claiming support.
  Local verification remains blocked because no genuine handwritten fixture
  has been supplied and the isolated user-scoped Tesseract install was not
  available without elevation. Docker deployment supplies Tesseract and the
  English model; a real handwritten image/scan and its checked transcription
  are still required to measure extraction quality.
- [ ] Audio uploads and voice memos.
- [x] Video uploads: implemented locally as an authorized timed-media path.
  MP4, MOV and video/WebM containers are signature-checked, bounded FFmpeg
  extraction creates a temporary mono WAV, and the original video is retained.
  The existing OpenAI timestamp validation, transcript reader, search chunks,
  Maxe citations and school-scoped access are reused. Focused tests use mocked
  transcription, while real local FFmpeg and isolated browser verification are
  now recorded below.
- [ ] Use representative fixtures and mocked paid-provider boundaries.

### Batch 3 evidence update — 2026-10-08

- Video runtime requirements are documented in `DEPLOY.md` and `render.yaml`.
  The Docker image installs `ffmpeg`; extraction timeout, duration and output
  byte limits are configurable. No migration is required.
- Real media verification used an isolated `imageio-ffmpeg` 7.1 binary and a
  generated six-second MP4 with a known sine-wave track. The application
  produced a 2.000-second mono 16 kHz WAV under the duration cap, rejected the
  configured extracted-audio size limit, removed temporary directories, kept
  original bytes on both success and no-audio failure, and preserved mocked
  0.4–1.2 second transcript timestamps. `scripts/check_video_browser_playwright.mjs`
  verified video
  playback, source filtering, timestamp citation click-through, transcript
  rendering, practice integration, desktop/mobile overflow and zero runtime
  errors. This is controlled synthetic-media evidence, not a representative
  student recording or production-provider result.
- The local OCR health probe reports the Python wrappers are installed but the
  system Tesseract executable is unavailable. A public-domain handwritten
  sample (`Hello handwriting sample.JPG`, Wikimedia Commons, retrieved
  2026-10-17; expected visible word: `Hello`) was inspected and passed to the
  real image-extraction path, but extraction could not run because the engine
  was absent. The application now reports `ocr_not_installed` and gives an
  installation-specific message instead of misclassifying the result as a
  blurry scan. The result is therefore **BLOCKED**, not a quality pass. The
  isolated installer required elevation and could not be used without
  persistent installation; typed scanned PDFs in the repo are not handwriting
  evidence. A verified Tesseract executable (or Docker/CI runtime) is still
  required before measuring accuracy against the checked transcription.
- The multi-membership access fixture passed with an explicit fail-closed
  recovery screen, retry/support/sign-out actions, no school picker and no
  workspace flash. It remains a local fixture result, not production evidence.

## Batch 4 — final verification and launch review

- [ ] Run the complete isolated student browser workflow: authentication,
  CU/KSA access, onboarding, desk, uploads, Reader, transcripts, search,
  Maxe, practice, progress/readiness, groups, sharing, exports, settings and
  admin boundaries.
- [x] Run isolated access, admin, student preferences/search/history, materials,
  Reader, Maxe, practice, sharing/export, reminder and video fixtures; local
  account/space IndexedDB privacy is separately verified. Collaboration
  moderation/upload coverage also passes through isolated Playwright.
  The full workspace fixture still needs repair: the current shell reopens on
  the separate My Materials screen and does not satisfy its legacy My desk
  readiness predicate. Full group/invite/discussion/room controls and the
  destructive account lifecycle remain outstanding, so the complete-workflow
  checkbox above stays unchecked.
- [ ] Verify desktop/mobile layouts, loading/error/empty states, keyboard
  access, no runtime errors and no horizontal overflow.
- [ ] Update the evidence table and classify each feature as
  IMPLEMENTED AND VERIFIED, IMPLEMENTED BUT UNVERIFIED, BLOCKED, or NOT
  IMPLEMENTED.
- [ ] Record external configuration, migrations, provider costs and any
  required live smoke-test steps. No production writes, real notification
  sends, paid calls, push or deployment without explicit authorization.

## Change discipline

Preserve the health-panel, migration-tooling and unrelated work already in the
working tree. Keep each batch reviewable, leave changes uncommitted until
review, and record schema migrations or external configuration requirements.
