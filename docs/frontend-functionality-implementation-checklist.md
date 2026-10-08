# Frontend functionality implementation checklist

Status: active product-direction checklist, created 2026-10-07. Work remains
uncommitted and must preserve unrelated changes in the working tree.

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
- [ ] Browser-verify save, reload and observable Maxe/practice effects.

### Reminders

- [x] Implement explicit owner consent, email/browser-push subscriptions,
  unsubscribe state and owner-scoped delivery tracking.
- [x] Add atomic period-key duplicate prevention and deterministic mocked
  delivery verification without sending real notifications.
- [ ] Approve the reminder cadence/trigger policy and configure a scheduled
  worker plus external SMTP and VAPID providers before enabling delivery.
- [ ] Complete an isolated browser verification of permission prompts,
  subscription recovery and opt-out UI; no real notification send is allowed
  during local validation.

### Related questions and early access

Current implementation:

- [x] Authorized related-question retrieval uses `GET /rag/related-questions`
  and renders loading/error/empty/result states in Assistant.
- [x] Authenticated early-access requests use
  `POST /learning-spaces/early-access-requests`, persist idempotently and do
  not grant membership.
- [ ] Browser-verify these flows with deterministic fixtures.

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
  system Tesseract executable is unavailable. The isolated installer required
  elevation and the user-scoped package had no applicable installer. Typed
  scanned PDFs in the repo are not handwriting evidence and were not used to
  claim handwriting support. A genuine handwritten sample plus checked
  transcription remains outstanding.
- The multi-membership access fixture passed with an explicit fail-closed
  recovery screen, retry/support/sign-out actions, no school picker and no
  workspace flash. It remains a local fixture result, not production evidence.

## Batch 4 — final verification and launch review

- [ ] Run the complete isolated student browser workflow: authentication,
  CU/KSA access, onboarding, desk, uploads, Reader, transcripts, search,
  Maxe, practice, progress/readiness, groups, sharing, exports, settings and
  admin boundaries.
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
