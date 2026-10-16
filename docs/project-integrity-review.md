# ExamMind project integrity review

Review date: 2026-10-09. Branch: `fix/ui-broken-parts`.
Base HEAD: `4a7fc6e44b4377fa5cc6b83e1a43ef63b99258dc`.
At the time of this review, all fixes were **uncommitted**. No production writes, migrations,
role/configuration changes, notifications, paid calls, push or deployment.

## Verdict and evidence boundary

Admin routing and the confirmed authorization inconsistencies are fixed and
verified locally. **The whole application is not launch-ready:** collaboration
has a reproduced cross-learning-space isolation defect, reminder activation
needs an approved schedule and external configuration, and representative
handwriting OCR remains unverified.

Source inspection, mocked route tests, real browser interaction with API
fixtures, integrated media processing and authenticated live operation are
different evidence levels. The tables below do not conflate them. Passing the
314-test suite does not establish every UI control, PostgreSQL migration or
live provider workflow.

An earlier read-only fetch during this review confirmed local HEAD equalled
`origin/fix/ui-broken-parts`, with `0 0` ahead/behind. That is evidence at the
time of the fetch, not a claim that the remote cannot subsequently change.
No new commit was created here.

Public live GET evidence collected during this review:

| URL | Actual HTTP/result | What it does not establish |
| --- | --- | --- |
| `https://exammind-api.onrender.com/health` | 200; `status=ok`, `application=ok` | Firebase, roles, migrations or student workflows |
| `https://exammind-api.onrender.com/health/ready` | 200; `status=ready`, `database=ok` | Exact schema/revision, backup availability or resource authorization |
| `https://exammind-web.onrender.com/admin` | 200, static HTML | An authenticated admin dashboard or account eligibility |

The live frontend entry observed was `index-Ciiugl4f.js`. The final local build
entry is `index-CHBrVUW5.js`. This distinguishes assets, not exact deployed
commits. Render deployed branch/commit, auto-deploy settings, actual
`ADMIN_PORTAL_EMAILS`, the user's database role and live Firebase account state
remain **UNVERIFIED**. No authenticated production account was accessed.

## Admin access: cause, local correction and operator action

The admin URL is `/admin`. Its bounded child views are
`/admin?view=moderation` and `/admin?view=feedback`.

Identity flow: Firebase client sign-in → `POST /auth/firebase/session` →
verified Firebase identity linked to the existing ExamMind user → application
session → `GET /auth/me` → server-calculated `admin_portal_access` → protected
admin route → authorized moderation/feedback APIs. Global identity accepts
verified personal Google accounts; CU eligibility and KSA claims remain
separate membership boundaries.

`backend/admin_access.py` normalizes configured and account emails by trimming
and lowercasing. Its existing predicate requires **both** `User.role=admin`
and exact membership in `ADMIN_PORTAL_EMAILS`; an empty allowlist fails closed.
An allowlisted email alone, a KSA ID, or a KSA moderator role is insufficient.

Confirmed problems and corrections:

1. Student membership/onboarding routing could intercept `/admin`. The route
   now hydrates identity and presents a standalone denial or protected admin
   shell before student workspace gating. Approved administrators with no
   learning-space membership can open the portal, not student content.
2. Queue/inbox navigation previously left the dedicated admin context. Both
   now remain in the protected shell and support direct reload, overview,
   refresh, return to workspace and sign-out.
3. Several material-management paths trusted raw `role=admin`, even when the
   portal predicate denied that account. Material access/moderation overrides,
   ownership overrides, destructive ingestion operations and production
   onboarding-reset authorization now reuse the same shared predicate.
4. Approved global admins could not use student-only actions with their own
   identity. The shared student dependency now also accepts an approved global
   admin; each route still checks membership, active space and resource rights.
   Tests prove personal-email admin KSA claiming/onboarding works without a
   second identity, implicit membership, or CU access.
5. A transient `/auth/me` failure cleared a valid application session. Network
   and 503 failures now retain the token with retry/sign-out feedback; genuine
   401/403 responses still clear it.

No automatic global-admin bootstrap procedure exists in the repository. No
role was assigned here. If live access remains denied, an authorized operator
must verify the Render allowlist and the **existing identity's** global role
without sharing credentials or creating a duplicate account. Any role or
configuration correction needs separate explicit approval. Sign out/in or
reload afterward to refresh `/auth/me`; do not override its result in browser
storage. See `DEPLOY.md`, “Admin access diagnosis and controlled assignment”.

Local evidence: `test_admin_integrity.py`, learning-space authorization tests,
`check_admin_access_playwright.mjs` and `check_ksa_admin.mjs`. Student,
role-only, empty-allowlist and approved-admin cases are covered. Desktop
1366×768 and mobile 390×844 have no asserted overflow/runtime errors. The
desktop denial and dashboard screenshots were inspected; this is not a live
admin-login verification.

## Confirmed defects: reproduction, cause and disposition

| Severity / impact | Reproduction and code evidence | Correction / validation |
| --- | --- | --- |
| HIGH: inconsistent global-admin authorization | Role-only account attempts another owner's private material or destructive ingestion; raw role checks in `material_access.py`, `routers/ingest.py`, `routers/auth.py` | Shared dual-gate predicate; six new admin integrity tests and full suite pass |
| HIGH: cross-space collaboration | CU-only user lists KSA-created public group/discussion/room and joins group; `StudyGroup`, `DiscussionThread`, `StudySession` have no `learning_space_id`; global predicates in `routers/mvp.py`, `sessions.py`, `community.py` | **NOT FIXED; BLOCKED on legacy ownership policy and isolated PostgreSQL validation**; diagnostic below reproduces it |
| HIGH: untrusted browser-push destination | Submitted HTTPS endpoint could point at an IP/internal destination; provider used unbounded redirect-capable delivery | Reject invalid/internal/IP endpoints, exact deployment host allowlist, bounded timeout, no redirects, explicit failure for missing/non-success response; 13 reminder tests pass |
| MEDIUM: `/admin` shows/intercepts student experience | Direct `/admin` with denied or no-membership account; student gates run first | Standalone route, denied content not mounted, queue/inbox stay protected; browser passes |
| MEDIUM: valid session lost on service outage | `/auth/me` returns 503 instead of 401 | Preserve token/retry, invalid token still cleared; admin fixture verifies both |
| MEDIUM: stale/hidden search result feedback | Search returns 503; old code renders empty results. Enter during dropdown fetch later reopens overlay over Retry | Explicit error/retry; invalidate dropdown and full-result sequence on context change; browser reproduces and verifies repair |
| MEDIUM: inaccessible related-question action | Global Maxe hides `.related-panel` containing the only action | Move action/results into visible message area; bounded pending/stale guards and honest empty/error state; student fixture verifies retrieval/rendering |
| MEDIUM: disabled global Maxe citations | Search → Learn more with AI → citation button; global `MaxeWorkspace` lacked callback | Pass verified target to authorized Reader; preserve page/slide/time context; global page/slide/audio click-through and existing workspace media fixtures pass |
| MEDIUM: saved learning choices unused | Save Progress explanation/format; ask Maxe or open Practice | Owner-only explicit profile merged with bounded KSA defaults; explicit explanation wins, supported quiz format defaults until user overrides; backend and browser tests pass |
| MEDIUM: quiz history outage looks like no attempts | `/learning/attempts` 503 | Visible failure/retry, retain prior history, no false empty/count; student fixture passes |
| MEDIUM: incorrect profile practice count | Complete new quiz/retake; profile still counts only legacy attempts | Sum own immutable legacy and current attempts, not generated quizzes; two new profile tests pass and other users cannot see private count |
| LOW: duplicate early-access requests | Synchronously click request twice before React disables control | Immediate in-flight ref; exactly one POST in browser test; server idempotency retained |
| LOW: KSA preference Back exposes unsaved identity edit | Settings → preferences → Back exposed identity fields not submitted by preference PUT | Editing Back returns to Settings; first-time onboarding still returns to identity step; desktop/mobile regression passes |
| MEDIUM: misleading deployment instructions | Docs claim startup creates schema / suggest production Neon for local tests | Describe Alembic-before-Uvicorn failure gate, explicit disposable DB, current inspection head 0005; no runtime migration policy changed |

### Collaboration isolation blocker: precise scope

Run from repository root:

```powershell
backend\.venv\Scripts\python.exe scripts\inspect_collaboration_isolation.py
```

Actual result: all four flags were true: CU viewer sees KSA-created group,
discussion and room, and can join the group. Durable space columns are absent.
The command uses network-blocked ephemeral SQLite **only to reproduce route
query/access predicates**, not to validate PostgreSQL constraints/migrations.
Exit 0 means diagnostic completed; it is **not** a passing security test.
No production record was inspected or changed.

Required decision: how to assign legacy records that have no reliable space
ownership (creator may be multi-membership, changed context or deleted).
Proposal requested for review: preserve ambiguous records in a restricted
admin-review state, or supply explicit CU/KSA mappings. Neither proposal was
implemented. Do not infer ownership from today's creator active space or
silently delete existing collaboration.

After approval, a bounded fix must version durable ownership, validate/backfill
only reliable mappings, restrict ambiguous rows, enforce the same space on
lists/details/search/join/invites/posts/messages/rooms/AI-board, and verify
cross-user/cross-space denial on isolated PostgreSQL. Resource and group-share
interactions must also be reviewed. Existing membership checks alone do not
establish school isolation.

## Frontend → backend functionality evidence

Legend: **IMPLEMENTED AND VERIFIED** means the stated local evidence passed,
not a live deployment claim. **IMPLEMENTED BUT UNVERIFIED** means source exists
but the full stated behavior was not independently exercised. **BLOCKED** and
**NOT IMPLEMENTED** identify outstanding work, not success hidden by fixtures.

### Every KSA onboarding control

| Control | UI/handler/request | Backend authorization, persistence and downstream use | Status / evidence |
| --- | --- | --- | --- |
| Main goal | `Onboarding.tsx` select → `save` → POST onboarding / PUT preferences | Active KSA membership; bounded goal values; own `onboarding_preferences`; authorized quiz focus and Maxe guidance | IMPLEMENTED AND VERIFIED locally: persistence/unit and edit/reload fixture; real provider effect UNVERIFIED |
| What do you want help with? | Textarea → bounded split topics in same payload | Bounded topics; own preferences; prompt/context and unscoped quiz focus, never additional resource permission | IMPLEMENTED AND VERIFIED locally; no live personalization claim |
| How should explanations start? | Select → validated enum in same payload | Bounded explanation style; Maxe prompt; later explicit Progress choice overrides default | IMPLEMENTED AND VERIFIED: context tests and browser save/reload; AI wording live UNVERIFIED |
| Optional reminders checkbox | Checkbox → `notifications_enabled` in same payload | Verified owner email consent bridges to reminder subscription; unchecked opts out; delivery not performed by onboarding | Consent IMPLEMENTED AND VERIFIED; scheduled real delivery BLOCKED |
| Back | Initial setup: local previous step, retaining state. Editing: cancel to Settings | No fabricated endpoint; does not claim saving identity/preferences | IMPLEMENTED AND VERIFIED: isolated browser cancellation |
| Enter my KSA desk | Pending submit → `POST /learning-spaces/ksa/onboarding`; editor `PUT /learning-spaces/ksa/preferences` | Authenticated active KSA membership; identity/username/preference validation; commit onboarding state, refresh spaces then desk | IMPLEMENTED AND VERIFIED: backend routes and fixture; failed save retains inputs/retry; live account UNVERIFIED |

Reminder-specific findings: consent and owner subscriptions persist; unsubscribe
works via owner DELETE or signed unsubscribe POST; delivery records and atomic
period-key duplicate prevention exist. Email/browser-push sender adapters exist
and are mocked in tests. There is **no approved/configured cadence or active
scheduled worker established here**, no verified real delivery channel and no
real notification sent. The browser fixture mocks PushManager/permission, so
it is not proof of real browser-service registration. Local notification-panel
activity is not a delivered-reminder inbox.

### Remaining reachable action families

| Screen / action | Endpoint / method or justified local action | Authorization → persistence/processing → result | Status and verification limits |
| --- | --- | --- | --- |
| Google/login/account recovery | Firebase client → POST `/auth/firebase/session`; GET `/auth/me`; Firebase recovery operations | Strong verified identity, existing identity linking; session hydration | IMPLEMENTED AND VERIFIED with signed-token/unit + browser identity fixtures; live Google/recovery emails NOT RUN |
| CU/KSA entry and returning login | GET `/learning-spaces`; explicit `/cu` or `/ksa` → POST `/{slug}/activate`; POST `/ksa/verify` | CU email eligibility; KSA unique self-claim; active membership/context checks; no ordinary picker/switch | IMPLEMENTED AND VERIFIED local tests/fixture. Multi-membership recovery only selects explicit authorized entry, not arbitrary membership |
| No membership / early access | POST `/learning-spaces/early-access-requests` | Authenticated idempotent persistence; no enrollment or access granted | IMPLEMENTED AND VERIFIED unit/browser, one request despite duplicate click |
| CU onboarding/profile / catalogue | GET `/community/profile`, `/academic-options`, `/courses`; POST `/community/onboarding` or `/skip`; PUT `/community/profile` | Owner validation/persistence, CU membership requirements separate | IMPLEMENTED BUT UNVERIFIED for all CU editor interactions; backend covered, no live university account |
| Dashboard / workspace entry | GET learning spaces, owner analytics/readiness/materials; local navigation | Restored authorized context; canonical quiz evidence, not four-answer mastery | IMPLEMENTED AND VERIFIED threshold/browser regressions; unrelated dashboard signals not all live-verified |
| Upload / confirmation / retry / visibility | POST `/ingest/upload` staged analysis/confirmation; PATCH `/materials/{type}/{id}/visibility` | Server size/signature limits, owner active space, original storage, extraction/transcription/indexing, explicit sharing consent | IMPLEMENTED AND VERIFIED mocked processing/storage tests, queued PPTX failure/retry fixture; entire real OCR/provider matrix UNVERIFIED |
| Materials / Reader / raw content / download | GET `/lecture-notes`, `/past-questions`, `/materials/lecture-notes/{id}`, `/materials/audio/{id}/transcript`, corresponding `/download` | Authorized resource filters/DTOs; intentionally authorized text/binary content; owner flags from server | IMPLEMENTED AND VERIFIED backend + Reader fixtures; global and scoped admin gate fixed, no production private-resource check |
| Audio/video playback and timestamps | Authorized media download/transcript; local media seek | Stored original and validated segments; same resource access boundary | IMPLEMENTED AND VERIFIED synthetic video browser/mocked transcription, workspace audio citation; representative/live transcript NOT RUN |
| Search / opening matches | GET `/search?q=...`; local Reader target / quiz target / AI question | Authorized material retrieval, relevance processing, visible errors/retry | Material search IMPLEMENTED AND VERIFIED local; collaboration result isolation BLOCKED |
| Maxe source / beyond / context / citations | POST `/maxe/chat` → RAG; related GET `/rag/related-questions` | Authorized chunks, verified provenance, bounded preferences, gaps; separately labelled beyond mode | IMPLEMENTED AND VERIFIED backend/provider mocks and Reader/global page/slide/audio browser; related success/error/empty states; real provider calls NOT RUN |
| Quiz creation / taking / review / history | POST/GET `/learning/quizzes`; POST `/{id}/attempts`; GET `/learning/attempts` | Authorized source provenance, owner quiz/immutable attempts, reliable graded evidence only | IMPLEMENTED AND VERIFIED backend + browser; ambiguous short answers excluded; mixed single-quiz generation NOT IMPLEMENTED |
| Progress / readiness / learning preferences | GET `/learning/readiness`, `/learning/profile`; PATCH profile | Owner evidence, ≥10 graded answers/≥2 attempts/appropriate ≥2-topic coverage; ≥4 per-topic; explicit choices separate from inferred | IMPLEMENTED AND VERIFIED backend/readiness/privacy/failed-save fixtures; no predicted exam score or IQ |
| Groups / invites / membership / posts | GET/POST `/study-groups`; join/leave/members; `/community/groups/...`, invite inspect/accept/revoke | Group permissions and persisted membership/posts exist; durable learning-space boundary absent | BLOCKED: reproduced cross-space access; full interaction browser coverage NOT RUN |
| Discussions / messages / editing | GET/POST/PATCH `/threads...`; message endpoints | Authenticated/group thread permissions, persisted messages/client IDs, local refresh | BLOCKED: public cross-space list demonstrated; full messaging fixture NOT RUN |
| Reading rooms / break / return / heartbeat / AI board | `/study-sessions` GET/POST + join/leave/break/back/heartbeat/messages/ask-ai | Room membership/activity/messages persist; provider board path exists | BLOCKED on durable space isolation; end-to-end room operations NOT RUN |
| Contribution / moderation / withdrawal / reports | POST material contribute/withdraw; GET moderation list/detail; POST decision/reports | Owner consent, scoped moderator or dual-gated global admin; status/audit persistence | IMPLEMENTED AND VERIFIED unit and contribution/admin fixtures; full report UI not independently clicked |
| Resource share create/list/copy/revoke/resolve | POST/GET `/collaboration/share-links`; DELETE `/{id}`; GET `/share/{token}` | Owner/allowed policy, expiry/revocation, token returned only on creation; old listing tokenless | IMPLEMENTED AND VERIFIED backend expiry/revoke + desktop/mobile fixtures; older links intentionally cannot be copied; group-scope interactions need collaboration fix |
| Material / Maxe / quiz result export | GET material `/export`; POST `/collaboration/exports` | Authorized content, supported md/txt and applicable original downloads; private result owned; safe filename, pending/error and URL release | IMPLEMENTED AND VERIFIED existing backend/browser fixture assertions, not production export |
| Saved/offline library / pending upload / dark mode | Scoped IndexedDB and local presentation/navigation | Owner+space storage, write-race guards, legacy quarantine; backend upload only on explicit sync/confirm | IMPLEMENTED AND VERIFIED real browser-storage fixture; not a server sync guarantee |
| Profile counters | GET `/profiles/{username}` | Allowlisted metadata; own practice count only; no learning records returned to other users | IMPLEMENTED AND VERIFIED two new counter/privacy tests; profile UI source reviewed |
| Settings reminders / preferences | GET `/reminders`; POST subscriptions; DELETE channel; GET deliveries; KSA PUT preferences | Owner consent/channel control, subscription/delivery state; safe endpoint handling | Controls IMPLEMENTED AND VERIFIED mocked browser; actual SMTP/VAPID delivery BLOCKED |
| Settings / deactivate / deletion / recovery | GET deletion-status; POST deactivate/reactivate; DELETE `/auth/account` with fresh Firebase token | Owner reauthentication/config gate; transactional retained-approved/private-delete matrix | IMPLEMENTED AND VERIFIED backend; complete browser destructive lifecycle NOT RUN; no production deletion |
| Feedback / early support / admin inbox | POST `/feedback/public` or `/feedback`; GET `/feedback/inbox` | Bounded persisted feedback, rate limits, inbox dual-gated admin | IMPLEMENTED AND VERIFIED backend/admin inbox fixture; email/support delivery not promised/tested |
| Admin health / refresh / queue / KSA management | Public GET `/health`, `/health/ready`; moderation/feedback; KSA admin claim/release/promote/demote | Public redacted health only; management server dual-gated, scoped transitions transactional/audited | IMPLEMENTED AND VERIFIED local denied/success fixtures and tests; authenticated live NOT RUN |

## Material-processing evidence and honest limits

| Format | Current implementation | Evidence / remaining requirement |
| --- | --- | --- |
| Text PDF | Signature/size validation, extraction, cleaned preview, page chunks, original retention | Backend upload contracts and PDF/page browser fixture pass; representative integrated text extraction not rerun here |
| Scanned PDF / image | Existing OCR wrappers and deployment Tesseract model/runtime | Source/runtime review and mocked failure paths; real representative OCR accuracy NOT RUN |
| DOCX / PPTX / typed material | Supported container/content checks and extraction; slide provenance | Backend contracts and queued PPTX failure/retry; slide Reader fixture pass; comprehensive representative DOCX matrix NOT RUN |
| Audio / voice memo | Supported audio validation, original retention, bounded configured transcription, segment validation | Audio/provider/storage tests and timestamp fixture pass; paid provider/live media NOT RUN |
| MP4 / MOV / video WebM | Existing bounded FFmpeg extraction, transcription, retained original, timed Reader/retrieval | Synthetic six-second video browser playback/seek/search/Maxe/practice independently rerun; earlier real FFmpeg extraction evidence retained separately, not rerun in this review |
| Handwriting | General OCR acceptance is not handwriting quality | BLOCKED: genuine handwritten image/scan + checked transcription and verified isolated Tesseract runtime needed; no typed-scan substitution or unverified installer used |

## Exact validation record

Commands below ran in this logical review/continuations. Earlier fixture
results were retained only where subsequent changes did not invalidate their
purpose. API fixture persistence is not real backend/database integration.

| Command / working directory | Actual result |
| --- | --- |
| `.venv\Scripts\python.exe ..\scripts\run_isolated_backend_tests.py` / backend | **PASSED: 314 tests in 23.825s**, external sockets blocked and keys blank; earlier baseline 298/14.491s, intermediate 307/106.451s |
| Same runner with `test_profile_integrity.py` | **PASSED: 2 tests / 0.671s** |
| Same runner with `test_reminders.py` | **PASSED: 13 tests / 1.268s** |
| Same runner with `test_learning_spaces.py` | **PASSED: 25 tests** |
| `.venv\Scripts\python.exe -m compileall -q auth.py material_access.py learning_intelligence.py reminders.py routers tests` / backend | **PASSED**, exit 0 |
| `npm.cmd run lint` / frontend | **PASSED**, exit 0 |
| `.\node_modules\.bin\tsc.cmd -b` / frontend | **PASSED**, exit 0; final build also runs TypeScript |
| `npm.cmd run build` / frontend | **PASSED**, final build 2.23s; entry 411.48 kB minified / 122.57 kB gzip; no assertion of total-size reduction |
| `node scripts/check_admin_access_playwright.mjs` / root | **PASSED**, 1366×768/390×844, denied/student/role-only, approved/no-membership, queue/inbox/reload/logout, 503 retry and 401 expiry |
| `node scripts/check_student_integrity_playwright.mjs` | **PASSED**, 1366/390: KSA edit Back/save/reload/failure, reminder consent, format consumer, history/search retry, related-question success/error/empty, global page/slide/audio citations and one early-access POST |
| `node scripts/run_browser_fixture_playwright.mjs check_workspace.mjs` | **PASSED**, source/beyond/gap/selected/active context, page/slide/audio, quizzes/history/readiness, sharing/export, panels/mobile; widths 1440/1920/390 |
| Same adapter `check_ksa_admin.mjs` | **PASSED**, final rerun: canonical ID/history, required reason, rejected and successful roles, duplicate prevention/release, desktop/mobile |
| Same adapter `check_collaboration.mjs` | **PASSED contribution/sharing/moderation fixture only**; NOT proof of all groups/threads/rooms or space isolation |
| `node scripts/check_access_flow_playwright.mjs` | **PASSED**, returning/onboarding/no-membership/multi-membership, explicit authorized CU/KSA entry and denied CU entry |
| `node scripts/check_audit_fixes.mjs` | **PASSED**, offline account+space/race isolation, readiness, preferences, search opening, queued PPTX retry/confirm, dark contrast; 1366/390/320 |
| `node scripts/check_video_browser_playwright.mjs "$env:TEMP\exammind-media-tools\video-fixture\known-timing.mp4"` | **PASSED**, real local synthetic browser playback/timestamp; API/provider fixtures, not live transcription |
| `node scripts/check_reminder_browser_playwright.mjs` with temporary `EXAMMIND_UI_URL=http://127.0.0.1:4190` | **PASSED**, isolated preview built with dummy public VAPID/local API; consent/permission mock/push opt-out/duplicates/failures; temporary process value restored |
| `backend\.venv\Scripts\python.exe scripts\inspect_collaboration_isolation.py` | **FAILURE REPRODUCED**, four cross-space flags true; diagnostic completed without production/network access |
| `git diff --check` | **PASSED**; normal LF/CRLF warnings are not failures |
| `node --check` on new admin/student/CDP runners; project Python `-m py_compile scripts\inspect_collaboration_isolation.py` | **PASSED**, exit 0 |
| Conventional frontend test suite | **NOT RUN: no test script declared**; build is not a test suite |
| Actual PostgreSQL migration/cascade/reconciliation integration | **BLOCKED**: Docker unavailable; no disposable database designated for this review. Offline migration tests passed within suite |
| Live Google/KSA/admin role/provider/reminder/production smoke test | **NOT RUN**, outside authorized boundaries |

Browser runners block external requests and use fresh owned headless Chrome
contexts. Temporary Playwright was reused outside application dependencies;
no lockfile was changed. Existing CDP fixtures now run through a bounded
Playwright CDP adapter instead of blindly retrying the stalled `Page.enable`
setup. Fixture contract, modal sequencing and injected newline defects were
repaired without weakening application assertions. No normal browser session
was closed. Screenshots and test artifacts contain fixture identities only.

## Configuration, decisions and next bounded work

1. **Historical finding, superseded by the 2026-10-16 continuation below:**
   collaboration ownership was unresolved at this point. The later approved
   restricted-review policy now has a local migration and access changes, but
   still needs a disposable PostgreSQL rehearsal before deployment.
2. Verify live admin account state out of band: existing global role AND
   normalized `ADMIN_PORTAL_EMAILS`; refresh `/auth/me`. Do not grant admin
   merely because the email or KSA ID is known. CU domain restrictions stay.
3. Reminder deployment needs approved cadence/trigger, worker scheduling,
   SMTP settings, VAPID keys, frontend public VAPID key and **exact approved
   `REMINDER_PUSH_ALLOWED_HOSTS`**. Empty host configuration fails closed;
   sender timeout is bounded, redirects refused. `pywebpush` is declared but
   absent in the current local venv; sender behavior was verified using an
   injected mock, not its installed runtime. Verify the deployed package and
   trusted-service egress/DNS before any authorized real delivery. Keep
   dispatch disabled until separately approved. Delivery tracking/idempotency
   is not a guarantee of exactly-once delivery after a process crash.
4. Existing migration `0005_reminder_delivery` must be accounted for in a
   separately authorized deployment. Do not infer live revision from health.
   Read-only target verification, backups and reviewed migration-before-start
   remain prerequisites. No production reconciliation/stamping is authorized.
5. Obtain genuine handwriting fixture and checked transcription; use only a
   verified isolated OCR runtime. Complete representative PDF/DOCX/PPTX/image/
   audio/video evidence with mocked paid boundaries, then cost-approved live
   providers separately.
6. Run remaining dedicated interaction coverage for all group/invite/thread/
   room actions after isolation repair, CU profile editing and full account
   lifecycle. Mixed preference is usable guidance, not implemented mixed
   quiz generation. Global page, slide and audio timestamp routing are now
   separately asserted; representative/live media remain separate.
7. Independently verify exact frontend/backend deployed commits, Firebase
   domains/config, CORS, Render auto-deploy, backup and external provider
   configuration under explicit authorization. Local YAML is not proof.

## Changed files and review grouping

- Admin/security/session: `backend/auth.py`, `material_access.py`,
  `routers/auth.py`, `routers/ingest.py`, admin/deletion/learning-space tests;
  `frontend/src/App.tsx`, `components/AdminAccessGate.tsx/.css`,
  `screens/Moderation.tsx`.
- Learning/search/Maxe: `backend/learning_intelligence.py`, `routers/rag.py`,
  `routers/mvp.py`, Maxe/profile tests; `App.tsx`, `MaxeWorkspace.tsx`,
  `Assistant.tsx`, `Workspace.tsx`, `Practice.tsx`, `SearchResults.tsx`,
  `LearningSpaces.tsx`, `Onboarding.tsx`.
- Reminder security/configuration: `backend/reminders.py`,
  `routers/reminders.py`, reminder tests, `backend/.env.example`, `render.yaml`.
- Validation/documentation: access/workspace/KSA fixtures, new isolated admin/
  student/CDP runners and collaboration diagnostic; `AGENTS.md`, `DEPLOY.md`,
  `docs/database-migrations.md`, audit/checklist update and this report.

Shared files, especially `App.tsx` and deployment docs, need selective review
if commits are later authorized. Existing health-panel, recovery-tooling and
unrelated work were preserved. No staged content, reset, stash or deletion of
unrelated files. Untracked tool/skill/output directories are not application
changes and must not be swept into a future commit.

The scope review and sensitive-pattern scan found no new credentials in the
intended changes. A scan of complete changed files flagged an existing dummy
database URL in deployment documentation, not a real secret. Existing trailing
whitespace elsewhere in `backend/auth.py` was left untouched; changed lines and
the new review files pass whitespace checks. No application dependency or
lockfile change was introduced for browser tooling. The interface-hardening
skill informed honest denial/error/empty states and reuse of existing tokens;
it did not authorize a visual redesign.

Historical disposition before the collaboration continuation: local confirmed
fixes verified; collaboration isolation and external/representative evidence
remained blockers.

## 2026-10-16 collaboration ownership continuation

The user approved restricting ambiguous legacy collaboration records for
global-admin review. Local revision `0006_collaboration_space`
adds nullable ownership to groups, discussions and reading rooms plus an
assignment audit table. The migration contains no content update or backfill;
legacy rows remain present and inaccessible to student routes until reviewed.
New records use a server-verified active learning space. Lists, detail routes,
search, recommendations, invites, room attendance and linked group material
access now apply that scope. An existing creator identity does not bypass the
restriction. The `/admin?view=collaboration` screen uses dual-gated admin
endpoints to list quarantined items and submit a space with a reason. An
assignment commits ownership and one audit event together. Linked child records
remain restricted until individually assigned; conflicting linked resources
block assignment.

Local validation after the final linked-resource guard: the isolated full
backend suite passed **321 tests in 9.952s**. Migration tests passed **15**;
the new collaboration-space tests passed within the full suite. These are
logical SQLite fixtures and offline PostgreSQL SQL generation, not a live
PostgreSQL migration rehearsal or concurrency proof. Python compilation,
frontend lint, TypeScript checking and production build passed. The isolated
admin Playwright fixture passed at **1366x768** and **390x844**: denied and
authorized access, failed/successful assignment, duplicate prevention, direct
reload, no runtime errors or horizontal overflow. `git diff --check` passed.
The admin browser fixture is mocked local evidence, not a live role or
deployment check. Dedicated browser coverage for the full student group,
invite, thread and room flows remains outstanding.

Actual PostgreSQL migration and concurrent assignment verification are
**BLOCKED**: Docker is unavailable and no disposable database has been
designated for this review. Before any deployment, confirm the exact target
revision, rehearse 0006 on a disposable clone, compare row counts and
fingerprints, verify null legacy ownership and audit constraints, and confirm
that the app and migration deploy together. Student access to all ambiguous
legacy groups, discussions and rooms will be restricted until a global admin
reviews and assigns each one; preserve a backup and a queue-processing plan.
Do not deploy the code alone or infer ownership from current memberships.
Existing reminder activation,
handwriting OCR and live workflow evidence remain separate open items.
