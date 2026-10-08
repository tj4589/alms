# ExamMind frontend-to-backend functionality audit

Status: source audit plus bounded Batch 1/2 implementation update completed
locally; no production writes, configuration changes, commit, push or
deployment were performed. Current implementation status is recorded below;
focused tests are not a substitute for isolated browser or live evidence.

Current direction update (2026-10-07): the product now requires every
advertised feature to work end to end. The earlier audit findings below remain
the evidence baseline until each bounded batch is implemented and verified;
they are not permission to claim completion or to replace gaps with mocks.
School-specific routing/access is the first implementation batch. See
`docs/frontend-functionality-implementation-checklist.md` for the durable
execution order and status vocabulary.

This document records evidence from source inspection, existing tests/fixtures
and the previously completed isolated browser checks. It does not treat the
admin health fixture or the public health endpoints as proof that the student
workspace is fully functional.

## Scope and evidence rules

- Branch reviewed: `fix/ui-broken-parts`.
- The existing uncommitted health-panel work was preserved.
- No production Firebase, Render, Neon, transcription or AI workflow was run.
- The existing KSA access fixture (`scripts/check_access_flow.mjs`) covers the
  claim/onboarding/returning-user route logic, but its CDP runner was not
  independently rerun in this audit because the local Chrome session fails at
  `Page.enable` after a GPU-process startup failure.
- Isolated Playwright evidence from the earlier health-panel work covered the
  admin dashboard only. It is not evidence for KSA student flows.
- “Confirmed” below means established by implementation and/or focused tests.
  “Fixture evidence” means the behavior is asserted by an isolated browser
  harness rather than a live provider or production account.

## Checks run for this audit

The following checks were run after the source review; none performs a
production write or a paid provider call:

- Frontend `npm run lint`: **PASSED**.
- Frontend `npm run build` (`tsc -b && vite build`): **PASSED**. The current
  local build emitted a 404.70 kB minified / 120.97 kB gzip entry chunk and
  lazy route chunks, including the 23.70 kB KSA onboarding chunk.
- Backend `test_learning_spaces.py`: **20 passed**.
- Backend `test_learning_intelligence.py`: **14 passed**.
- Backend `test_onboarding_and_deletion.py`: **41 passed**.
- Backend `test_firebase_auth.py`: **18 passed**.
- `git diff --check`: **PASSED** for tracked changes (only normal LF/CRLF
  conversion warnings were emitted). A separate trailing-whitespace scan of
  this new untracked document also passed.
- Static source inventory: **COMPLETED** for `App.tsx`, every screen under
  `frontend/src/screens`, relevant shared components, corresponding backend
  routers and the KSA access fixture.
- Browser interaction audit: **PARTIALLY AVAILABLE**. The existing CDP
  runner remains blocked at `Page.enable` by the local Chrome GPU startup
  failure. Earlier isolated Playwright evidence covers the admin health panel,
  workspace/Reader/sharing/export surfaces, and the existing KSA fixture
  contains access-flow assertions; no live authenticated production flow was
  run here.

## KSA onboarding findings

### What is persisted

`frontend/src/screens/Onboarding.tsx` loads `/community/profile` and submits
the KSA form to `POST /learning-spaces/ksa/onboarding` with:

- `preferred_name` and `username`;
- `learning_goals`;
- `help_topics`;
- `explanation_preference`;
- `notifications_enabled`.

`backend/routers/learning_spaces.py` validates this payload and
`backend/learning_spaces.py:421-445` persists it in
`users.onboarding_preferences`. The same transaction marks the active KSA
membership and user onboarding state as completed. The endpoint requires an
active KSA membership, so completing the form does not create an unverified
membership.

### Completion and return to the KSA desk

The frontend route resolver keeps a KSA member with
`membership.onboarding_required` in KSA onboarding. After a successful POST,
`App.tsx:710-729` refreshes `/learning-spaces`, clears the onboarding state and
returns to the current onboarding return screen, which is the dashboard for
the normal first-access path. The workspace is not rendered until membership
and active-space state are available.

The existing access fixture asserts that:

1. a valid KSA ID opens KSA onboarding;
2. refresh stays in KSA onboarding instead of returning to the claim screen;
3. completing the form enters `.workspace-shell`;
4. a returning completed KSA member enters the workspace without repeating the
   claim; and
5. a pending KSA member resumes onboarding.

This is implementation plus isolated-fixture evidence, not a production
account verification. The live Firebase/KSA path remains unverified.

### Reminders: consented subscriptions, worker activation pending

The checkbox labelled “Send optional reminders about study activity” is stored
as `notifications_enabled` in `users.onboarding_preferences`. The current
implementation now bridges explicit consent to a verified-email subscription,
supports owner-scoped browser-push subscriptions, records delivery attempts,
and exposes unsubscribe and delivery-status endpoints. The scheduled trigger,
cadence and external provider activation remain deployment decisions.

`frontend/src/components/NotificationPanel.tsx` still reads local IndexedDB
queues for the activity inbox; reminder subscription and delivery controls are
in the Settings screen and do not expose push endpoint credentials.

Finding: **the reminder contract is implemented locally but not activated for
real delivery**. Keep dispatch disabled until the cadence/trigger, external
provider configuration and scheduled worker are approved and verified.

### Learning preferences: stored and now consumed in bounded paths

KSA onboarding stores `explanation_preference` values
`concise`, `step_by_step`, `examples_first` or `not_sure`, plus goals and help
topics. The quiz generator in `backend/learning_intelligence.py` still selects
authorized sources, question count, question type and difficulty, but when no
explicit topic is supplied it now uses a matching KSA `help_topics` value to
focus source selection. This is bounded personalization, not a mastery claim
or permission expansion.

The Maxe/RAG path now includes bounded KSA learning preferences in the private
provider prompt context. The values guide response style only and are not
exposed as public data or used to bypass source authorization. The separate
learning-profile contract remains distinct; no implicit inference is created
from onboarding choices.

There is a separate evidence-based learning profile at:

- `GET /learning/profile`;
- `PATCH /learning/profile`;
- `frontend/src/screens/Progress.tsx`.

That profile stores explicit choices for `explanation_preference` and
`preferred_learning_format`, and separately records quiz-derived observations.
The UI provides success/error/retry feedback for saving these choices. This is
a separate profile contract, with different values (`examples` and
`exam_style`), and is not populated from KSA onboarding or demonstrably
consumed by Maxe or quiz generation.

Finding: **KSA preference effects are implemented in source but not yet
browser-verified**. The observable contract is bounded Maxe prompt guidance
and authorized unscoped quiz topic focus; it does not claim that preferences
change correctness, readiness or resource access.

### Can KSA preferences be edited later?

The KSA onboarding copy says “You can change them later,” but the supported
later-edit path is now present, but still needs browser verification:

- Settings routes a KSA member to the KSA preference editor.
- `KsaOnboarding` loads the existing preference JSON and submits
  `PUT /learning-spaces/ksa/preferences` when editing.
- The backend requires an active KSA membership, merges only validated
  preference fields and preserves unrelated profile/membership state.

Finding: **KSA learning-preference editing is implemented but unverified**.
The focused backend test covers persistence and membership preservation; the
isolated student browser path still needs to save, reload and demonstrate the
updated values.

## Frontend-to-backend evidence table

| User-facing area | Frontend entry/action | Backend contract or storage | Evidence/status | Launch implication |
| --- | --- | --- | --- | --- |
| Identity bootstrap | `App.tsx` restores the Firebase-backed session and loads `/auth/me` | Firebase token verification and authenticated-user response | Implemented; live sign-in not run | Verify Firebase project, domains and API URL in the approved smoke test |
| Learning-space bootstrap | App loads `/learning-spaces` and blocks workspace until membership/active-space state is known | Membership-aware `list_spaces` and active-space validation | Implemented in source; access fixture asserts no protected workspace flash | Keep as a launch gate; do not use health success as workspace evidence |
| KSA verification | Access gate submits `POST /learning-spaces/ksa/verify` | KSA claim and active membership creation with authorization/rate limit | Implemented; existing fixture covers valid/invalid ID and claim transition | Requires a real disposable KSA account/ID for production verification |
| KSA onboarding completion | `KsaOnboarding` submits `POST /learning-spaces/ksa/onboarding` | Active KSA membership required; user and membership state plus preference JSON committed | Confirmed by source and existing fixture; not live verified | Verify persistence and post-login desk entry in production smoke test |
| KSA reminder preference | Checkbox submits `notifications_enabled` with onboarding payload | Consent bridge creates/updates the verified-email subscription; reminder settings add browser-push consent and unsubscribe | IMPLEMENTED BUT UNVERIFIED: focused consent/delivery tests pass; provider/worker and browser permission flow remain unverified | Approve cadence/trigger and external provider/worker before enabling delivery |
| KSA explanations/practice preferences | Goal, help-topic and explanation controls in KSA onboarding | Saved in `users.onboarding_preferences`; bounded Maxe prompt context and unscoped quiz topic focus consume the values | IMPLEMENTED BUT UNVERIFIED: focused backend tests pass; browser effect still pending | Keep the contract bounded and source-authorized |
| Later KSA preference editing | Settings routes to the KSA preference editor | `PUT /learning-spaces/ksa/preferences` validates active KSA membership, merges preferences and preserves profile state | IMPLEMENTED BUT UNVERIFIED: focused persistence test; browser save/reload pending | Do not use the generic CU academic profile endpoint |
| General learning preferences | Progress screen selects explanation/quiz format | `GET/PATCH /learning/profile`, explicit vs inferred profile data | Confirmed UI/API path; failure feedback exists | Does not resolve the KSA onboarding contract mismatch |
| Grounded practice | Practice creates and submits quizzes/attempts | Learning routes and evidence tables enforce authorized sources and completed quiz evidence | Existing implementation/tests; no live provider call | Verify one resource quiz and attempt in approved smoke test |
| Readiness | Progress loads `/learning/readiness`, attempts and profile | Evidence thresholds and transparent formula from stored graded answers | Existing implementation/tests; no live account run | Verify insufficient evidence and supported readiness separately |
| Maxe source mode | Workspace/Maxe sends authorized context and displays citations | Permission-aware retrieval, source citations and knowledge-gap handling | Existing source/tests; no live AI call in this audit | Requires bounded-cost provider approval and live smoke test |
| Beyond Materials | Maxe mode switch uses the existing provider path | Separate mode behavior and safe response handling | Existing implementation; live provider not tested | Verify mode labeling and cost before launch |
| Materials/workspace | Upload and resource screens call ingest, list, reader and source endpoints | Upload bounds, metadata review, authorized resource access and content DTOs | Existing backend/frontend work; no full student browser run in this audit | PDF/PPTX/audio/video flow remains a required production smoke test |
| Audio/transcription | Upload/Reader surface audio and transcript timestamps | OpenAI transcription configuration, retained source audio and timestamp validation | Existing isolated tests; no paid call | Configure provider or show unavailable state; do not claim success on failure |
| Sharing | Resource UI creates/lists/revokes links and copies newly returned tokens | Permission-aware share endpoints; listings intentionally omit older tokens | Existing isolated Playwright evidence; no production link | Verify owner/non-owner and revoked/expired retrieval |
| Export | Material/quiz/Maxe actions invoke supported export endpoints | Existing authorization and server-provided content/filename contracts | Existing isolated evidence; no production download | Verify binary/text response handling and denial cases |
| Notifications | Header panel opens local activity view; Settings manages reminders | IndexedDB activity plus owner-scoped `/reminders` subscriptions and delivery-status endpoints | IMPLEMENTED BUT UNVERIFIED: backend mock delivery tests pass; no real provider send | Keep dispatch disabled until cadence, provider and worker are configured |
| Admin dashboard | Admin-only route and service-health panel | `/health` and `/health/ready` remain JSON monitoring endpoints | Admin fixture and public health checks passed previously | Admin fixture proves only admin/health behavior, not student functionality |
| Error states | API helpers preserve HTTP errors; screens show local feedback in covered flows | FastAPI error responses and provider-safe failure handling | Partially evidenced; full user journey not rerun | Run the complete isolated student browser flow before launch |
| Responsive behavior | Workspace, panels and onboarding have mobile layouts | No separate backend contract | Admin/mobile and existing access-fixture assertions; not a full student audit | Verify KSA onboarding and workspace at desktop/mobile |

## Control-level KSA onboarding trace

Current-status correction: the older later-editing row in the table above is
historical audit evidence and is superseded by the permission-aware
`PUT /learning-spaces/ksa/preferences` path. The current status is
`IMPLEMENTED BUT UNVERIFIED`; it must not be treated as an active missing
endpoint.

| Screen/control | Expected behavior | Endpoint or local behavior | Persistence/downstream use | Authorization | Validation evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Main goal | Let a KSA student choose a goal or defer it | React state; included in `POST /learning-spaces/ksa/onboarding` as `learning_goals` | Stored in `users.onboarding_preferences.learning_goals`; bounded KSA preference context is available to Maxe | Endpoint requires authenticated student with active KSA membership | Pydantic list bound; focused Maxe preference test; browser effect pending | IMPLEMENTED BUT UNVERIFIED |
| What do you want help with? | Capture comma-separated topics for later study guidance | React state; normalized into `help_topics` in the same POST | Stored in `users.onboarding_preferences.help_topics`; matching values focus authorized unscoped quiz source selection | Same KSA membership boundary | Client/server list bounds; focused grounded-quiz test; browser effect pending | IMPLEMENTED BUT UNVERIFIED |
| How should explanations start? | Save a preferred explanation style | React state; `explanation_preference` in the same POST or `PUT /learning-spaces/ksa/preferences` | Stored and included as bounded private Maxe prompt guidance; separate learning profile remains distinct | Same KSA membership boundary | Literal server validation and focused context test; browser effect pending | IMPLEMENTED BUT UNVERIFIED |
| Send optional reminders about study activity | Opt in to actual reminders, with channel-specific disable paths | React checkbox bridges to email consent; Settings calls `POST /reminders/subscriptions`, `DELETE /reminders/subscriptions/{channel}` and `POST /reminders/unsubscribe`; `GET /reminders/deliveries` exposes status without endpoints/keys | Subscription rows, idempotent delivery rows and mocked sender are tested; scheduled trigger and real provider remain pending | Authenticated owner only; push endpoint credentials never return in JSON | Focused reminder tests cover consent, idempotency, opt-out, failure tracking and owner isolation; browser permission flow pending | IMPLEMENTED BUT UNVERIFIED |
| Back | Return from step 2 to step 1 without saving a partial onboarding request | Local `setStep(1)`; no request | No persistence until final submit | Local-only | Button is disabled on step 1; source inspection confirms behavior | WORKING |
| Enter my KSA desk | Validate and persist onboarding, then open the authorized KSA desk | `POST /learning-spaces/ksa/onboarding`; `App.handleOnboardingComplete()` refreshes `/learning-spaces` | Membership and user onboarding state become completed; preferences are stored; normal callback returns to dashboard/workspace | Active KSA membership required; username conflict returns 409 | Existing access fixture asserts completion, refresh persistence and workspace entry; live Firebase/KSA not run | WORKING (fixture evidence) |

## Reachable frontend screen and action inventory

This inventory covers the screens reachable from `App.tsx` and the public
paths/components. Status is intentionally conservative: a source-backed
route is not called live-working when its real provider or authenticated
deployment was not exercised.

| Screen/control | Expected behavior | Endpoint and HTTP method, or justified local-only behavior | Persistence/downstream implementation | Authorization | Validation evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Landing, privacy and public feedback | Explain the product, open auth/privacy/feedback and accept public feedback | Local navigation; `POST /feedback/public` for submitted feedback | Feedback row is persisted server-side with public rate limit | Public feedback is rate-limited; no workspace access | Static trace and existing feedback tests; no public submission in this audit | WORKING |
| Auth: Google/email sign-in and registration | Establish Firebase identity and ExamMind session; show actionable failures/timeouts | Firebase SDK, then `POST /auth/firebase/session`; legacy email routes remain deprecated | Backend verifies token and creates/loads identity; frontend stores session token | Firebase verification and backend identity rules; learning-space access is separate | Auth-focused backend tests and source inspection; real Google sign-in unverified | WORKING (isolated) |
| Account recovery after deletion/deactivation | Reauthenticate/reactivate or explain recovery state without exposing workspace | `POST /auth/account/reactivate`, `POST /auth/account/deactivate`, `DELETE /auth/account`, `GET /auth/account/deletion-status` | Backend lifecycle state and frontend sign-out/recovery screens preserve the documented transaction | Authenticated owner; deletion feature gate can return unavailable | Existing deletion/onboarding tests; no real account mutation | WORKING (isolated) |
| First-access KSA/CU decision | Keep an authenticated user out of workspace until a learning-space path is chosen | Local stage; KSA `POST /learning-spaces/ksa/verify`; CU activation through `/learning-spaces/{slug}/activate` | KSA membership/active-space state is server-backed; early access is only a support route | Membership is authoritative; no workspace before active membership | Isolated Playwright fixture asserts no workspace flash, KSA/CU return routing, pending onboarding and multi-membership/no-context recovery without a picker | WORKING (isolated fixture) |
| KSA early-access/contact support | Give non-KSA users a way to request help | Authenticated `POST /learning-spaces/early-access-requests` creates or returns an idempotent access-request feedback record | Persisted request with duplicate protection; moderator/admin review remains the downstream process | Does not grant a learning space | Backend route/source and frontend integration; browser pending | IMPLEMENTED BUT UNVERIFIED |
| Learning-space entry | Enter the school context already authorized for the account without a general chooser | `/learning-spaces` returns the server-selected active membership; stale/missing context shows retry/support recovery; no ordinary-user activation UI | `active_learning_space_id` is restored only for a sole membership; multiple memberships remain intact and require a school-specific recovery path when no active context exists | Backend rejects manual unauthorized activation and cross-space access | Venv backend test plus isolated Playwright desktop/mobile fixture passed | WORKING (isolated fixture) |
| Dashboard / desk | Show personal analytics, courses, uploaded material and next actions | `GET /analytics/student/{id}`, `/courses`, `/past-questions`, `/lecture-notes`, `/study-sessions` | Reads owner-scoped material/progress and routes to workspace/search/practice/groups | Backend ownership/space filters | Source inspection; no complete authenticated dashboard browser run in this audit | UNVERIFIED |
| Upload and metadata review | Analyze PDF/PPTX/audio/video, expose safe metadata/OCR state, then confirm or retry | `POST /ingest/upload`; `PATCH /materials/{type}/{id}/visibility`; supporting reads for courses/groups/material ledger | Resource, extraction metadata, binary retention and visibility are persisted through backend flow; video uses bounded temporary FFmpeg audio extraction | Authenticated active-space user; server upload/type/size/visibility checks | Existing upload/serialization/audio/storage/video tests; no paid provider call; synthetic FFmpeg/browser evidence, representative student media pending | IMPLEMENTED BUT UNVERIFIED |
| Upload sharing choice | Make archive/group/private visibility explicit and preserve owner choice | `PATCH /materials/{type}/{id}/visibility` | Visibility and group selection are stored; no automatic publication | Owner and active learning-space policy | Existing sharing/upload tests; not live tested | WORKING (isolated) |
| Workspace source list | List authorized lecture notes and past questions and allow opening/refresh/search | `GET /lecture-notes`, `GET /past-questions` | Server public DTOs omit binary/internal fields; reader loads selected resource | Authorized accessible-material filter | Existing response-contract tests and prior isolated browser evidence | WORKING (isolated) |
| Reader / PDF and slide content | Open authorized content with page/slide-aware citations, download and export | `GET /materials/lecture-notes/{id}`, download route, `GET /collaboration/materials/{type}/{id}/export` | Reader content and citations come from stored sections/source metadata | Resource access and export authorization enforced server-side | Prior isolated Reader/export evidence; production resource unverified | WORKING (isolated) |
| Audio transcript | Show processing/unavailable state, timestamped segments and seek behavior | `GET /materials/audio/{id}/transcript`, audio download route | Original audio is retained when transcription fails; validated segment bounds | Authorized resource access | Audio tests cover failures/timestamps; no real transcription call | WORKING (isolated) |
| Search | Search authorized material/community results and open a resource, ask Maxe, practise or enter community context | `GET /search` from `App.openSearchResults`; local result actions route to workspace/practice/groups/collab | Search uses backend results and source metadata; open actions now exist in `SearchResults.tsx` | Search and resource responses are authorization-aware | Source inspection and prior search/browser evidence; no live search | WORKING (isolated) |
| Past-question library | Browse questions, ask about one, start practice, save an offline pack | Past questions from dashboard/search; Maxe and practice routes; local IndexedDB for offline pack | Offline pack is device-local; server questions remain server-authorized | Backend list/access rules; local pack has device privacy limits | Source inspection; no full student browser run | WORKING (isolated) |
| Maxe source mode | Answer from authorized sources with citations and knowledge-gap responses | `POST /maxe/chat` in the workspace assistant | Server assembles authorized context; citations are returned and click through to Reader | Backend retrieval/space isolation is authoritative | Maxe/provider tests and prior isolated citation evidence; live AI unverified | WORKING (isolated) |
| Maxe Beyond Materials mode | Clearly separate general answers from source-grounded answers | Same `/maxe/chat` contract with mode in payload | Provider failure handling and mode label are implemented; no fabricated source citation | Authenticated user; source mode permissions still apply | Source/tests; paid provider call intentionally not made | WORKING (isolated) |
| Maxe “View related questions” | Open related questions from a response | Authenticated `GET /rag/related-questions?q=...` with current-user authorization and rate limiting | Returns only authorized past-question DTOs with safe previews/citations; Assistant renders loading/error/results | Source and backend focused implementation; browser pending | IMPLEMENTED BUT UNVERIFIED |
| Practice / quiz creation | Generate a grounded quiz by resource/topic/scope and take it | `POST /learning/quizzes`; source reads through learning routes | Questions retain citations; authorized source scope is enforced | Student owns quiz and can access sources | Learning tests and prior browser checks; no live provider | WORKING (isolated) |
| Practice attempt/review/export | Submit answers, preserve retakes, review explanations and export supported result | `POST /learning/quizzes/{id}/attempts`; `GET /learning/attempts`; existing export endpoint | Immutable attempts and graded evidence; ambiguous short answers excluded | Owner-only learning data | Learning/export tests; result browser check previously stabilized | WORKING (isolated) |
| Progress/readiness | Show evidence thresholds, topic status, history and actionable weak-topic suggestions | `GET /learning/readiness`, `/learning/attempts`, `/learning/profile`; `PATCH /learning/profile` | Stored graded quiz evidence and explicit/inferred profile data | Owner-only | Readiness/privacy tests; save failure UI has error/retry feedback | WORKING (isolated) |
| Progress preference personalization | Let a student edit the separate learning profile | `PATCH /learning/profile` | Explicit preferences are stored with source label; inferred behavior is separate | Authenticated student owner | Source and focused learning tests; does not update KSA onboarding JSON | PARTIAL |
| Study groups | Browse/create/join/leave groups, members, posts, invites and rooms | `/study-groups`, `/study-groups/{id}/join|leave|members`, `/community/groups/...`, `/study-sessions...` | Group memberships, posts, rooms and invites are persisted | Group/space membership authorization | Backend collaboration tests and source inspection; no full live group run | WORKING (isolated) |
| Collaboration discussions | List/create/update threads, messages, context, reports and copy/share thread links | `/threads`, `/threads/{id}`, `/threads/{id}/messages`, `/community/reports` | Threads/messages/context/report records persist | Authenticated and group/course access checks | Existing collaboration tests and prior browser evidence | WORKING (isolated) |
| Resource sharing | Create/list/copy newly created links, show expiry/status and revoke | `POST/GET/DELETE /collaboration/share-links`; `GET /collaboration/share/{token}` for resolution | Tokens are returned only on creation; listed older links intentionally omit tokens | Owner/authorized resource policy; resolved content remains protected | Prior isolated Playwright sharing evidence and backend tests | WORKING (isolated) |
| Exports | Download authorized reading, quiz or Maxe output with safe filename and response type | Existing collaboration material/export endpoints and quiz export endpoint | Temporary object URLs are released by shared export helper | Server authorization remains authoritative | Prior isolated export evidence; no production download | WORKING (isolated) |
| Offline library | Save study packs, saved items, queued uploads and conversations for this browser | IndexedDB/local-only operations; no server call for saved pack | Data is device-local and account switching requires cleanup/isolation review | Browser storage, not server authorization | Source inspection; prior privacy regression was identified and fixed separately | PARTIAL |
| Settings / academic profile | View session/privacy information and edit CU academic or KSA learning profile | `GET/PUT /community/profile` for academic fields; `PUT /learning-spaces/ksa/preferences` for active KSA preferences | Profile and KSA preference state persist separately; KSA path preserves membership state | Authenticated student owner; active KSA membership for KSA preferences | Source and focused backend tests; browser save/reload pending | IMPLEMENTED BUT UNVERIFIED |
| Settings / deactivate and delete | Deactivate now or schedule deletion, with recovery states | Account lifecycle endpoints above | Backend transactional deletion/retention policy; frontend clears session/device state | Authenticated owner; deletion gate | Focused deletion tests; no live deletion | WORKING (isolated) |
| Public profile | Open a permitted public profile by handle | `GET /profiles/{username}` | Public DTO only | Public metadata policy | Source/DTO review; no live profile | WORKING (isolated) |
| Moderation | Review contributions and manage KSA claims/roles | Collaboration moderation routes and KSA admin claim/role routes | Decisions, releases and role audit records persist transactionally | KSA moderator/global-admin boundaries enforced server-side | Focused moderation/authorization tests; no production moderator | WORKING (isolated) |
| Admin dashboard | Show contribution/feedback signals and process/database health to global admins | Moderation/feedback APIs plus public `/health` and `/health/ready` | Health is monitoring JSON; no secrets/version exposed | Global-admin gate in app and backend | Isolated Playwright health-panel fixture passed; this is not student-flow evidence | WORKING (fixture evidence) |
| Group invite public route | Inspect/accept/revoke supported invites | `GET/POST /community/group-invites/{token}`, revoke route | Invite membership is persisted on acceptance | Token plus group authorization | Source and backend route tests; no live invite | WORKING (isolated) |

### Dead controls, mocks and unsupported promises

The first three bullets below are historical findings from before the Batch 2
implementation. They are retained for audit traceability, not as the current
status: related questions now use `/rag/related-questions`, early access now
creates a persisted authenticated request, and KSA preference consumers/editing
are implemented but browser-unverified. The active unsupported promises are
reminder delivery and independently evidenced handwriting OCR. Video
processing has verified synthetic real-container/browser evidence; a
representative student recording remains outstanding.

- Maxe’s related-question action now calls the authorized retrieval endpoint;
  isolated browser verification remains outstanding.
- KSA “request early access” opens the feedback form; it does not create a
  separately trackable access request. This is acceptable only if “contact
  support” is the intended product contract.
- KSA onboarding’s reminder and personalization copy promises more than the
  current backend consumers provide. The onboarding copy now records explicit
  email consent and points students to Settings for browser subscriptions and
  opt-out; actual delivery remains disabled until cadence, providers and a
  worker are configured.
- The notification panel is a local IndexedDB activity surface, not a server
  notification inbox. It must not be described as delivered reminders.
- Course catalogue failure has a manual-entry fallback. This is a graceful
  optional-data fallback, not proof that course recommendations are active.
- Account deletion can be explicitly unavailable under configuration; the UI
  reports that state rather than claiming deletion succeeded.
- No frontend test script is declared in `frontend/package.json`; lint,
  TypeScript/build and fixture/browser checks are available instead.

## Launch blockers

Current-status note: Blockers 2 and 3 below are historical audit findings and
are superseded by the Batch 2 implementation. They remain
`IMPLEMENTED BUT UNVERIFIED`, not missing features. Reminder delivery is now
implemented through consented subscriptions and a worker-facing dispatch
primitive, but the cadence/trigger and external provider deployment remain
open. The complete browser flow and material-processing evidence remain
validation work rather than claims of completion.

### Blocker 1 — reminder scheduling and provider activation remain open

Consent, email/browser-push subscriptions, opt-out, delivery tracking and
duplicate prevention now exist. A product decision is still required for the
cadence/trigger (for example, daily after an inactivity window versus a weekly
digest), followed by an external SMTP provider, VAPID key pair and separately
scheduled worker. Dispatch remains disabled by default and local tests inject a
mock sender; no real notification has been sent.

### Blocker 2 — KSA learning preferences do not change learning behavior

The onboarding stores bounded preferences, and the inspected Maxe and quiz
paths consume them without changing source authorization. Focused backend tests
cover the contract, but the isolated student browser flow still needs to show
an observable explanation/practice effect before this can be called verified
personalization.

### Blocker 3 — later editing of KSA preferences is missing

Settings now uses the permission-aware KSA preference path rather than the
generic academic profile endpoint. Focused persistence coverage exists, but a
browser save/reload check is still required before the promise is fully
verified.

### Blocker 4 — full authenticated student browser evidence is unavailable

The supported CDP runner is blocked at `Page.enable` in this environment by a
Chrome GPU-process startup failure. The isolated Playwright fallback was used
for the admin health panel, but a complete KSA/workspace browser run was not
performed in this audit. Fixture assertions and source inspection must not be
reported as live Firebase/Render evidence.

### Blocker 5 — production configuration and deployment state remain unverified

Live health endpoints were publicly checked previously, but the following were
not authenticated or changed here: deployed commit, Firebase authorized
domains, KSA account/claim data, CORS configuration, Neon readiness/migration
state, AI/transcription keys, delivery services and Render environment
variables.

## Already established or lower-risk findings

- KSA claim authorization, unique-claim protections and multi-space entry
  boundaries are represented in the existing backend and access fixture.
- Completing a verified KSA onboarding request persists user/membership state
  and the normal frontend callback refreshes spaces before showing the desk.
- The separate Progress learning-profile editor records explicit choices and
  presents save failures with useful feedback/retry behavior.
- Health-panel process/readiness UI changes remain uncommitted and were not
  replaced by this audit. Health endpoints remain JSON monitoring contracts.
- The repository contains existing source-aware practice, readiness, sharing,
  export and provider-failure implementations, but each still needs the
  appropriate isolated or production smoke-test evidence before being called
  launch-complete.

### Product-direction batch status

| Batch | Scope | Status | Evidence state |
|---|---|---|---|
| 1 | School-specific entry, return-login routing and cross-space access | IMPLEMENTED BUT UNVERIFIED | Backend context restoration and frontend guards are changed locally; focused/browser validation is still required |
| 2 | KSA preferences, reminders, related questions and early-access tracking | IMPLEMENTED BUT UNVERIFIED | Preference editing/consumers, authorized related questions and persisted early-access requests are implemented; reminder consent/subscriptions/delivery tracking are implemented, while cadence/provider/worker activation and browser verification remain open |
| 3 | Representative PDF/document/image/audio/video processing matrix | IMPLEMENTED BUT UNVERIFIED | Video now has bounded FFmpeg extraction, original retention, timestamped transcript/index integration and authorized Reader/search/Maxe reuse; synthetic real-container/browser evidence exists, while representative student media and handwriting evidence remain outstanding |
| 4 | Full isolated browser/regression verification and launch review | NOT IMPLEMENTED | The prior complete student browser run remains unavailable |

## Recommended order before launch

1. Decide the approved reminder cadence/trigger and configure the external
   SMTP/VAPID providers plus a separately scheduled worker; keep dispatch
   disabled until the worker is tested with the existing mock-delivery suite.
2. Run representative material-processing checks for text/scanned PDFs,
   DOCX/PPTX, images, audio, video and handwriting claims. Synthetic video
   extraction/browser evidence exists; verify representative student media and
   handwriting before calling the processing matrix independently verified.

Historical superseded proposal below: the KSA preference-edit path has since
been implemented at `PUT /learning-spaces/ksa/preferences` and is tracked as
`IMPLEMENTED BUT UNVERIFIED`, not as a missing feature.
3. Run the complete isolated Playwright student workflow using deterministic
   Firebase/API fixtures, including KSA onboarding, workspace, Reader, Maxe,
   Practice, Progress, sharing and export at desktop/mobile sizes.
4. Under explicit operator authorization, repeat the required smoke-test steps
   against the configured live services, recording redacted evidence and
   stopping on privacy, authorization, migration, health or cost failures.

## Audit conclusion

The platform has a substantial implemented frontend/backend surface, but it is
not accurate to report “all buttons and endpoints are perfect.” The KSA
onboarding flow persists and routes correctly in the inspected implementation
and existing fixture. Reminder consent/subscriptions/tracking and synthetic
video processing are implemented locally, while reminder activation, KSA
preference effects, later KSA preference editing, representative handwriting
OCR and the complete student browser workflow remain unverified. The
service-health panel is useful operational tooling, not evidence that those
user-facing blockers are fixed.
