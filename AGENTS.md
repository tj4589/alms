# ExamMind agent operating guide

This file is the repository-level operating guide for coding agents working on
ExamMind. It describes the current implementation and the boundaries for
future work. It is documentation, not authorization to implement every item
described in a roadmap or handoff.

## 1. Product purpose and boundaries

ExamMind is a student-focused academic knowledge and collaborative study
system. The durable product scope is documented in `exammind-master.md` and
the current implementation extends that baseline with learning spaces and
stabilization work.

The product supports:

- authenticated student identities;
- separate learning-space access for Covenant University (CU) and Kora Sales
  Academy (KSA), where KSA is a professional training program/cohort rather
  than a school or university;
- student-uploaded past questions, lecture notes, images and audio;
- extraction, OCR, metadata review, duplicate checks, cleaned previews and
  indexed retrieval;
- source-grounded Maxe answers with page, slide or timestamp citations;
- grounded practice quizzes, immutable attempts, topic evidence and
  explainable readiness;
- study groups, discussions, invitations and reading rooms;
- controlled resource visibility, contribution moderation, sharing and exports;
- account lifecycle, privacy and deletion/retention safeguards.

Maxe is the study assistant, not an independent source of authority. In source
mode it must use only material the requesting user is authorized to retrieve.
When the authorized material does not establish an answer, the product should
state the knowledge gap instead of inventing a citation or fact. Beyond
Materials is a separately labelled mode and must not be represented as
source-grounded.

Readiness is evidence from completed, graded quiz answers. It is not an IQ
score, a prediction of exam performance or proof of mastery from passive
reading or a Maxe conversation. The current threshold and formula are
implemented in `backend/learning_intelligence.py` and exposed through
`backend/routers/learning.py`.

The original final-year-project scope is student-focused. The current code also
contains narrowly scoped global-admin and KSA moderation controls for operating
the learning spaces. Those controls do not turn ExamMind into a general staff
management product.

## 2. Current architecture

### Runtime stack

The current stack is:

- Frontend: React, TypeScript and Vite in `frontend/`.
- API: FastAPI, SQLAlchemy and Pydantic in `backend/`.
- Database: PostgreSQL with pgvector, reached through SQLAlchemy/psycopg.
- Migrations: Alembic in `backend/alembic/`.
- Embeddings: FastEmbed, with keyword/degraded paths where configured.
- Authentication: Firebase client sign-in plus backend Firebase token
  verification and an ExamMind application session.
- AI: DeepSeek primary, Cohere fallback where configured, and OpenAI audio
  transcription where configured. Provider wrappers and failure handling live
  in `backend/ai_clients.py`.
- Hosting: Neon for PostgreSQL and Render for the API Docker service and the
  Vite static site, as documented in `DEPLOY.md` and declared in `render.yaml`.

### Entry points and important directories

| Area | Location | Responsibility |
| --- | --- | --- |
| Frontend shell | `frontend/src/App.tsx` | Session bootstrap, learning-space routing, screen state, navigation and protected-workspace gating |
| Frontend screens | `frontend/src/screens/` | Dashboard, spaces, onboarding, upload, workspace/Reader, search, practice, progress, groups, collaboration, settings, moderation and admin UI |
| Shared frontend components | `frontend/src/components/` | Auth, landing/public pages, Maxe panels, feedback, invites, offline status and notifications |
| API client | `frontend/src/lib/api.ts` | Authenticated requests, public requests, binary downloads and safe HTTP errors |
| Firebase client | `frontend/src/lib/firebase.ts` and `firebaseAuth.ts` | Firebase configuration and sign-in/session handoff |
| API application | `backend/main.py` | FastAPI app, CORS, exception boundary, router registration and `/health` endpoints |
| Authentication | `backend/auth.py`, `backend/firebase_tokens.py`, `backend/routers/auth.py` | Token verification, identity linking, application sessions and account lifecycle |
| Learning spaces | `backend/learning_spaces.py`, `backend/learning_space_roles.py`, `backend/routers/learning_spaces.py` | CU/KSA membership, active-space isolation, claims, onboarding and scoped roles |
| Ingestion | `backend/routers/ingest.py` | Upload limits, extraction/OCR, metadata, duplicates, indexing and confirmed storage |
| Retrieval/AI | `backend/routers/rag.py`, `backend/routers/maxe.py`, `backend/maxe_context.py`, `backend/ai_clients.py` | Authorized context, citations, provider calls and safe failures |
| Learning | `backend/learning_intelligence.py`, `backend/routers/learning.py` | Grounded quizzes, attempts, evidence, profile and readiness |
| Collaboration | `backend/routers/collaboration.py`, `backend/routers/community.py`, `backend/routers/mvp.py` | Materials, groups, discussions, rooms, contributions, share links and exports |
| Schemas | `backend/schemas.py` and router-local DTOs | Explicit public response contracts; do not serialize ORM objects directly |
| Data model | `backend/models.py` | SQLAlchemy models and ownership/foreign-key relationships |
| Migrations | `backend/alembic/versions/` | Versioned schema history; current chain is 0001 through 0005 |
| Validation | `backend/tests/`, `scripts/`, `docs/` | Unit/integration fixtures, browser fixtures, migration checks and evidence |

The frontend has no conventional client-side route table for authenticated
screens. `App.tsx` uses component state (`ScreenType`) and public path handling;
do not move initialization or protected-screen gating into lazy modules without
preserving session hydration and active-space selection.

### Current migration chain

The versioned chain in `backend/alembic/versions/` is:

1. `0001_initial_schema`
2. `0002_ksa_claim_audit`
3. `0003_learning_space_role_audit`
4. `0004_rate_limit_buckets`
5. `0005_reminder_delivery`

The API Docker command in `backend/Dockerfile` runs Alembic before Uvicorn
binds. A migration failure must prevent the instance from serving; never bypass
that gate by suppressing a duplicate-table error or blindly stamping a revision.

## 3. Requirements and documentation hierarchy

Use this order when resolving scope:

1. The current user request and explicit later overrides.
2. Applicable repository instructions, including this file and any more-local
   `AGENTS.md` that may be added later.
3. Verified current code, tests and configuration.
4. Durable specifications and approved stabilization documents.
5. Handoffs, audits and historical project documents as evidence, not automatic
   authorization.
6. Ideas, generic patterns and unapproved future roadmap items only as
   proposals.

Explicit current user instructions take precedence over this file. When a user
changes product direction, update the affected guidance and identify the
superseded requirement; do not leave contradictory rules described as
simultaneously active. Future roadmap items provide context only and never
authorize implementation. If requirements genuinely conflict and the user's
intent does not resolve them, explain the specific conflict briefly and ask
only for the missing decision, while continuing independent authorized work.

Important sources:

- `exammind-master.md`: original product purpose, academic retrieval scope and
  final-year-project baseline.
- `docs/auth-identity-separation.md`: Firebase global identity versus CU/KSA
  learning-space eligibility, KSA claims and role boundaries.
- `docs/database-migrations.md`: Alembic history, existing-schema inspection,
  reconciliation and safe recovery procedure.
- `docs/rate-limiting.md`: distributed PostgreSQL limiter behavior and failure
  policy.
- `docs/production-smoke-test-checklist.md`: the 24-step production workflow;
  it is preparation documentation and does not authorize production execution.
- `docs/stabilization-review-handoff.md`: local S0-S16 status and evidence
  recorded by the prior handoff. Treat its inherited validation as reported
  evidence, not as a substitute for rerunning a required check.
- `docs/frontend-functionality-audit.md`: current frontend/backend evidence
  table and unresolved KSA onboarding findings.
- `DEPLOY.md` and `render.yaml`: deployment commands, environment declarations,
  health/readiness, provider configuration and migration sequencing.
- `design-system/exammind/MASTER.md` and `DESIGN.md`: visual language,
  responsive and accessibility expectations.

If a specification is missing, contradictory or only implied by a phase number,
stop at inspection and report the conflict. Do not infer a feature from a
generic admin pattern. Do not silently reconcile two incompatible policies.
State which source was chosen and why only after the user approves the scope.

## 4. Current implementation, evidence and known gaps

### Current product direction — 2026-10-07

The current product direction authorizes bounded implementation work from the
frontend functionality audit. It supersedes the older sentence in Section 13
that authorized only maintenance of this operating guide. That older rule is
no longer active for the batches listed below; it remains true that unrelated
roadmap work is not authorized.

Every advertised feature must work end to end. Do not replace an incomplete
feature with a mock or remove it merely to claim completion. Any
server-dependent action must have real frontend integration, backend
authorization, validation, persistence, processing or delivery where
applicable, and a displayed result. Local navigation and display controls may
remain local when they do not claim server-side work.

For the learning-space-specific experience:

- Ordinary CU users must enter the university learning space established by
  their authenticated identity and active membership. KSA users must enter
  the Kora Sales Academy program space established by their KSA membership.
  Neither group may see a generic learning-space chooser, a “Switch learning
  space” control, or another space’s enrollment controls inside their active
  experience.
- A single active membership is safe to restore automatically because it is
  unambiguous. For multiple active memberships, reuse only a valid server-
  selected active context. If that context is absent or stale, fail closed and
  require a learning-space-specific entry/support recovery path; never show a
  general learning-space picker, choose arbitrarily, delete a membership or
  grant access based on a client-supplied space ID.
- Backend active-space and membership authorization remain authoritative.
  Global-admin functions are separate and remain global-admin authorized.

All reachable actions must be traced as UI → handler → endpoint or justified
local behavior → validation/authorization → persistence → processing or
delivery → displayed result. The status vocabulary for this work is:
IMPLEMENTED AND VERIFIED, IMPLEMENTED BUT UNVERIFIED, BLOCKED, or NOT
IMPLEMENTED. Tests verify functionality but are not a substitute for the
functionality itself.

The work is organized into bounded batches. Batch 1 is learning-space-specific
entry, return-login routing and cross-space access. Batch 2 is KSA preference
consumers/editing, related-question retrieval and persisted early-access
requests. Batch 3 is the representative material-processing matrix,
including only formats that are actually supported and evidenced. Batch 4 is
full isolated browser/regression verification and launch review. The durable
checklist is `docs/frontend-functionality-implementation-checklist.md`.

Reminder consent, email/browser-push subscriptions, unsubscribe state and
delivery tracking now have a versioned local implementation. A real reminder
service still needs an approved cadence/trigger, delivery providers and a
scheduled worker; dispatch remains disabled and no real notifications may be
sent while those deployment decisions are unresolved. Video must be audited independently from audio and
must not be claimed as supported without an actual extraction/transcription
pipeline and representative evidence.

The stabilization handoff reports S0-S16 local preparation and implementation,
but production deployment, live Firebase workflows, real KSA accounts, live
Neon migration state and paid providers remain separately unverified. The
frontend audit records source and fixture evidence and must be read before
claiming that all user-facing controls work.

Known frontend/product gaps from `docs/frontend-functionality-audit.md`:

- KSA `notifications_enabled` is persisted in `users.onboarding_preferences`
  and bridges to consented email reminders. Owner-scoped browser-push
  subscriptions, unsubscribe routes, delivery tracking and mocked dispatch
  tests exist; cadence, provider activation, worker scheduling and browser
  permission verification remain open.
- KSA goals, help topics and explanation preference are now bounded inputs to
  Maxe context and unscoped quiz topic focus. Their behavior remains
  `IMPLEMENTED BUT UNVERIFIED` until the isolated student flow demonstrates
  observable effects.
- KSA onboarding preferences can be edited later through the permission-aware
  `PUT /learning-spaces/ksa/preferences` path when the user has active KSA
  membership. Browser save/reload evidence remains outstanding.
- Maxe related-question retrieval now uses the authorized
  `GET /rag/related-questions` path; isolated browser verification remains
  outstanding.
- Video upload/transcription is implemented locally for MP4, MOV and
  video/WebM containers: the original is retained, bounded FFmpeg extraction
  feeds the timestamped transcription path, and Reader/search/Maxe reuse the
  authorized media contract. A generated known-timing MP4 was also processed
  with a verified isolated FFmpeg binary, and the isolated browser fixture
  covered playback, timestamps, Reader/search/Maxe/practice integration and
  responsive overflow. Representative student media and live provider delivery
  remain unverified.
- Handwritten-content OCR has not been independently evidenced with a
  representative fixture. Do not claim handwriting support beyond verified
  image/scanned-document OCR behavior.
- The local CDP browser runner can be blocked at `Page.enable` by Chrome GPU
  startup. Isolated Playwright is an approved fallback for local fixture checks;
  browser fixtures are never live production evidence.

The uncommitted health-panel changes are operational UI only. `/health` proves
process health; `/health/ready` reports a redacted database readiness result.
Neither endpoint proves authentication, workspace authorization, uploads,
Maxe, practice, sharing or any other student workflow.

When reporting status, distinguish:

- implemented in source;
- covered by a focused test;
- covered by an isolated browser fixture;
- committed locally;
- present on a verified remote branch;
- deployed and independently checked live.

Never collapse those into “done.”

## 5. Authentication and authorization invariants

### Global identity

Firebase verification is the identity boundary. The backend validates signature,
issuer, audience, timing, subject, verified email and Firebase account-email
consistency through `backend/firebase_tokens.py`. A non-CU verified personal
Google account may create a global ExamMind identity; that does not grant CU or
KSA access.

Do not reintroduce a global CU-domain restriction into Firebase identity
validation. CU eligibility belongs in CU membership/access logic.

### CU and KSA access

- CU domain eligibility is configured by `ALLOWED_SCHOOL_EMAIL_DOMAINS` and
  enforced when CU access/membership is requested.
- KSA MVP access is a separate authenticated claim flow using canonical
  `KSA-##` identifiers. The current MVP uses the unique-claim table and does
  not require CU email.
- KSA claim/release and learning-space membership are server-authoritative.
- A user may belong to multiple spaces. `active_learning_space_id` must point
  only to an active membership; a manually supplied pointer cannot grant access.
- A user with no membership may see the limited access/onboarding state, not
  CU/KSA resources.

### Roles and admin boundaries

- `User.role == "admin"` is the global admin boundary.
- The configured `ADMIN_PORTAL_EMAILS` list is an additional admin-portal gate;
  real addresses belong only in deployment secrets/configuration.
- `LearningSpaceMembership.role` is scoped to that learning space. KSA
  moderator/owner/admin permissions do not become global permissions.
- KSA claim administration and controlled role changes require the shared
  global-admin dependencies in `backend/auth.py` and
  `backend/routers/learning_spaces.py`.
- Existing active KSA membership is required for scoped moderator operations.
- Role changes and claim transitions remain transactional and audit exactly one
  successful transition event. Reasons are required where the route contract
  requires them.

Backend authorization is always authoritative. Do not rely on hidden buttons,
frontend roles, arbitrary `learning_space_id` values or client-supplied owner
flags. Add cross-user, cross-space and denied-access tests for every new route.

## 6. Data and API contracts

### Public versus authorized content

Public metadata responses use explicit allowlists/DTOs. They must not leak:

- `file_bytes` or other binary columns;
- storage paths or internal storage references;
- raw extracted/OCR text unless an endpoint explicitly authorizes it;
- embeddings;
- provider request/response internals;
- credentials, tokens or private metadata.

Authorized Reader, download, export and source-reading endpoints may return the
content their documented contract requires, but their access checks must remain
server-side. Never fix a serialization bug by Base64-encoding private binary
content into a general JSON response.

### Ownership, retention and deletion

Private material follows the private-content deletion policy. Approved/shared
resources that the documented S10 policy retains may survive uploader account
detachment, with provenance anonymized as required and dependencies preserved.
Do not transfer ownership to an arbitrary user. Resource, transcript, note,
quiz, progress, conversation and contribution behavior must be tested against
the actual retention matrix in `backend/tests/test_onboarding_and_deletion.py`.

Account deletion is configuration-gated in the current deployment defaults.
Deletion and cleanup must remain transactional, idempotent and recoverable;
never perform a direct destructive database cleanup from a UI shortcut.

### Sharing and exports

Share-link creation returns a token only when the new link is created. The
listing contract intentionally omits tokens from older links, so the UI cannot
copy an older link unless the server provides a valid URL under its contract.
Do not expose omitted tokens or weaken the listing policy to make copying look
convenient. Revoked and expired links must not retrieve protected content.

Exports must use the existing supported formats and endpoints. Preserve server
filenames safely, distinguish binary/text responses, do not download error
responses as successful files, prevent duplicate submissions and release
temporary object URLs.

### Learning privacy

Learning profiles, quiz attempts, readiness evidence, weaknesses, strengths,
revision history and Maxe personal context are private to their owner.
Passive reading and Maxe conversations do not count as quiz evidence or
mastery. Questions must retain authorized source provenance and no quiz may
use another user’s private material.

## 7. AI, uploads and operational safeguards

- Maxe/RAG context must be assembled from resources the user can access in the
  active space. Do not fabricate citations or use a public identifier as an
  authorization check.
- DeepSeek/Cohere calls have explicit bounded timeouts, bounded/no uncontrolled
  retries and sanitized client/log errors. Never log keys, tokens, request
  bodies or raw provider responses.
- Missing provider configuration, network failure, timeout, rate limit,
  authentication failure, malformed response and provider-server failure must
  produce a safe unavailable/error state, not false success.
- Audio source bytes remain retained when transcription fails. Timestamp
  segments must be validated before storage or click-through.
- Upload limits are server-side. Validate size, supported type and content
  beyond trusting a client extension or MIME string. Read bounded chunks and
  clean temporary files only under explicit rules.
- Cleanup must not remove active processing, approved/shared retained content,
  private content outside the documented deletion action or original audio
  needed after transcription failure.
- Distributed rate limiting uses shared PostgreSQL state and atomic updates.
  It returns 429 with `Retry-After` when enforced. Do not silently substitute
  process-local memory for distributed enforcement. The current failure mode is
  explicitly closed when the shared limiter cannot operate.

## 8. Database and migration discipline

Use PostgreSQL/pgvector for behavior that depends on PostgreSQL constraints,
vector types, indexes, pooling or transaction semantics. SQLite is not a valid
substitute for migration, cascade, vector or schema-drift validation.

For a clean disposable database:

```powershell
cd backend
.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
```

For an existing database, first use the read-only revision-specific inspection
and reconciliation procedures in `docs/database-migrations.md` and
`backend/verify_migration.py`. Confirm database identity out of band, compare
the exact schema/data requirements and check `alembic_version`. Establish a
baseline only when the specific revision is fully verified.

Rules:

- Never run inspection tooling against production by guessing a URL.
- Never print connection strings, credentials or row contents.
- Keep read-only probe connections separate from fixture-creation/write
  connections; do not leave `PGOPTIONS=transaction_read_only=on` applied to
  migration commands.
- Never blindly stamp `head`, drop/reset tables, suppress duplicate-table
  errors or auto-delete/merge conflicting rows.
- Stop on duplicate memberships, orphan references, uniqueness violations,
  schema drift, unexpected fingerprints or unavailable backup/recovery.
- Use disposable Neon branches/databases or local Docker PostgreSQL only when
  explicitly designated. Docker Desktop may be unavailable; report that rather
  than substituting SQLite.
- A production repair requires explicit execution approval after identity,
  backup/recovery and clone rehearsal are verified.

The startup migration gate is a deployment safety boundary, not a repair tool.
Use `DEPLOY.md` for the recovery sequence and post-repair checks:
  migration marker, schema, `/health` and `/health/ready`.

## 9. Frontend and UX conventions

Reuse existing components, design tokens, icons, typography and screen
patterns. The design language and responsive/accessibility expectations are in
`design-system/exammind/MASTER.md` and the related design files.

Every user-facing action should have:

- a real supported backend action or an explicitly labelled local-only action;
- disabled/pending state that prevents duplicate requests;
- useful success, empty, unavailable and error states;
- accessible labels, focus behavior and keyboard operation;
- no horizontal overflow at the relevant desktop/mobile widths;
- honest copy that does not promise an unimplemented scheduler, integration,
  recommendation or delivery channel.

Do not hide an incomplete feature behind a button that reports success. Remove,
disable or clearly label unsupported actions. Preserve the frontend audit's
status evidence, including the reminder scheduling/provider gap and the remaining
browser/material-processing verification. Batch 2 preference editing,
personalization, related questions and early-access persistence are now
implemented locally and must not be described as missing features.

Route-level lazy loading is already part of the current frontend. Preserve
Firebase/session initialization, the `App.tsx` protected-space gate, Maxe state,
CSS ordering and navigation when changing lazy boundaries. Do not pull lazy
screens back into the entry bundle through eager imports.

## 10. Development workflow and change discipline

Before changing anything:

1. Read this file and any more-local repository instructions.
2. Check branch, `HEAD`, `git status` and recent commits.
3. Read the relevant source, tests, durable specification and handoff/audit.
4. Identify what is user-authorized, what is merely proposed and what is
   unrelated existing work.
5. Plan the smallest coherent change and its validation.

During work:

- Preserve unrelated modified and untracked files.
- Do not reset, checkout, stash, delete or overwrite work outside the task.
- Avoid speculative refactors, broad formatting and new dependencies.
- Use `apply_patch` for repository edits.
- Keep secrets, personal data, connection strings and provider response bodies
  out of source, logs, tests, screenshots and documentation.
- Do not access production services, change production configuration, run
  production migrations, make paid calls, push or deploy unless the user
  explicitly authorizes that exact action.
- A request to inspect, diagnose or report does not authorize implementation.
- A request to implement does not automatically authorize commit, push or
  deployment; follow the stated boundary.

Before commit/push:

- review the exact diff and `git diff --check`;
- stage explicit intended paths/hunks only;
- confirm unrelated changes remain unstaged;
- report branch, commit, files, tests, blockers and working-tree status;
- never force-push or rebase shared work without explicit authorization.

## 11. Validation commands and evidence

Use the project virtual environment. From `backend/`, the normal unittest
pattern is:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

For provider-isolated tests with external network blocked, the repository
runner is:

```powershell
cd backend
.venv\Scripts\python.exe ..\scripts\run_isolated_backend_tests.py
```

Run focused patterns when appropriate, for example:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_learning_spaces.py' -v
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_learning_intelligence.py' -v
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_onboarding_and_deletion.py' -v
```

For Python compilation, use the project interpreter and target only source
directories/files relevant to the change; do not report a compile check that
was not run. For frontend changes:

```powershell
cd frontend
npm run lint
npm run build
```

There is currently no frontend test script in `frontend/package.json`. Do not
invent one or call the production build a frontend test suite.

For browser checks:

- `scripts/check_access_flow.mjs` covers access/KSA fixture behavior.
- `scripts/check_workspace.mjs`, `scripts/check_collaboration.mjs`,
  `scripts/check_ksa_admin.mjs` and related scripts use local CDP fixtures.
- Start Vite and the supported browser setup only in an isolated local
  environment. The scripts require bounded command timeouts and useful target
  diagnostics.
- If CDP `Page.enable` hangs/fails, stop repeated retries. Use a fresh isolated
  Chrome profile or temporary Playwright tooling without changing application
  dependencies/lockfiles. Terminate only processes started by the test.
- Record whether a result is source inspection, mock/fixture, local integrated,
  public live GET or authenticated production evidence.

For migrations, run Alembic and revision inspection only against the explicitly
designated disposable/local database. A migration check against an unavailable
Docker daemon is **BLOCKED**, not passed.

## 12. Deployment and production boundaries

Render declares:

- `exammind-api`: Docker web service rooted at `backend/`, with health check
  `/health` and migration-before-Uvicorn startup;
- `exammind-web`: static Vite build rooted at `frontend/`.

Neon supplies PostgreSQL/pgvector. Deployment requires the environment values
documented in `DEPLOY.md` and `render.yaml`, including the database URL,
Firebase verification/client configuration, exact CORS origin, AI provider
settings/keys, optional OpenAI transcription settings, upload/timeouts and
PostgreSQL rate-limit settings. Secrets belong in Render/Neon/Firebase
configuration, never in source or chat.

`GET /health` reports process health only. `GET /health/ready` performs a
bounded dependency readiness check and returns redacted status. Neither proves
the student workflow. A live health response must not be used as evidence that
Firebase, KSA onboarding, uploads, Maxe, practice, sharing or exports work.

Before an authorized production smoke test:

1. Verify the exact Render service, branch/commit and environment settings.
2. Verify Firebase authorized domains and a dedicated test account.
3. Verify Neon identity, pgvector, current marker, schema and backup/restore
   availability without changing the target.
4. Deploy only through the reviewed migration gate; stop on migration failure.
5. Check `/health` and `/health/ready` separately.
6. Run the exact 24-step sequence in
   `docs/production-smoke-test-checklist.md` with dedicated student,
   moderator and global-admin accounts, non-sensitive materials and explicit
   provider-cost approval.
7. Record redacted evidence and clean only disposable test data through
   supported product operations.

Pushing a branch triggers deployment only if the live Render service is
connected to that repository/branch and auto-deploy is enabled; verify this in
the Render dashboard rather than assuming it. No live setting is considered
verified from local YAML alone.

## 13. Current capabilities, next work and roadmap

### Current verified capabilities

The repository contains tested/local implementations for Firebase identity
separation, CU/KSA membership boundaries, KSA claims and recovery, moderation
authorization, migrations/reconciliation tooling, distributed rate limiting,
safe ingestion, provider failure handling, public DTOs, sharing/revocation,
supported exports, retention/deletion policy, route splitting and health
checks. See the focused backend tests and the linked stabilization handoff for
the exact evidence. Treat live deployment status separately.

### Known defects and incomplete promises

The authoritative current list is `docs/frontend-functionality-audit.md`.
KSA preference editing, preference-aware Maxe/practice focus, authorized
related-question retrieval and persisted early-access requests now exist in
source, but remain `IMPLEMENTED BUT UNVERIFIED` until the isolated student
browser flow and integration evidence are completed. Reminder delivery,
  independently evidenced handwriting OCR remains incomplete or blocked.

### Explicitly approved next work

The current product-direction request authorizes the bounded batches in
`docs/frontend-functionality-implementation-checklist.md`, beginning with
learning-space-specific routing and access. Batch 1 and the non-reminder portions of
Batch 2 have been implemented locally; they still require the evidence listed
in the checklist. Each later batch requires its own implementation and
validation report; approval of one batch does not silently authorize unrelated
roadmap work.

### Documented future roadmap

`exammind-master.md` documents future possibilities including native mobile
packaging, offline topic bundles, richer analytics, multi-university
configuration, improved OCR options and stronger privacy controls. These are
not current implementation authorization. Phase H remains deferred unless the
user explicitly approves it.

### Ideas requiring approval

The following bounded proposals come from the frontend audit and require a
separate decision before code changes:

1. Approve the KSA reminder cadence/trigger and configure the external
   provider/worker path. Consent, subscriptions, unsubscribe behavior,
   delivery tracking and mocked delivery verification are implemented locally;
   real notifications remain disabled.
2. Produce representative Batch 3 evidence for text/scanned PDFs, DOCX/PPTX,
   images, audio, video and handwriting claims. Synthetic video processing and
   browser evidence now exist, while representative student media and
   handwriting remain outstanding.
3. Historical proposals superseded: KSA preference editing, related-question
   retrieval and persisted early-access requests are implemented locally;
   browser verification remains.
4. Run the complete isolated student browser workflow before calling the
   frontend launch-ready.

The older items in this list proposing a KSA preference editor, related-
question route and persisted early-access decision are historical proposals
and are superseded by the current Batch 2 implementation. They must not be
treated as missing authorization or active defects. The remaining active
decision is the reminder cadence/trigger and provider/worker activation; the remaining evidence work covers
  browser verification and handwriting OCR.

Do not automatically advance stabilization phases or start broader roadmap work
because a prior phase is committed. If a current user instruction later
supersedes a roadmap or stabilization requirement, record the supersession in
the affected durable document and keep only the current rule active.

## 14. Reporting and maintenance

Every agent handoff should include:

- the branch, `HEAD` and working-tree status;
- the authoritative scope and any conflicting/stale source;
- changed files and user-visible/backend behavior;
- authorization, privacy and data-preservation impact;
- exact commands and results, including NOT RUN/BLOCKED checks;
- fixture versus local integrated versus live evidence;
- remaining blockers, deployment prerequisites and risks;
- commit/push/deploy status only when actually performed.

When durable architecture, security invariants, deployment flow or validation
commands change, update this guide with a path citation. Keep detailed phase
history, screenshots and per-task evidence in `docs/` rather than copying the
entire history here. Never add secrets, personal data or database connection
strings while maintaining this file.

## 15. Conflicting, stale or unresolved sources

- `exammind-master.md` describes the original JWT/student-only product and says
  there are no staff dashboards. Current code uses Firebase-backed sessions,
  CU/KSA learning spaces and narrowly gated admin/moderation controls. Treat
  the master document as the historical product baseline where it conflicts
  with later approved stabilization documents and current code.
- The master document lists legacy `/practice/*` and `POST /search` routes;
  current consumers also use `/learning/*`, `/maxe/chat`, `/search` GET-style
  query handling and collaboration routes. Inspect the actual router and
  frontend call before adding compatibility behavior.
- `docs/stabilization-review-handoff.md` records inherited completion claims,
  not independent proof of current Render/Neon/Firebase deployment state.
- `render.yaml` declares intended values and service behavior; it is not proof
  that the live Render service uses the branch, commit, environment or auto
  deploy settings described there.
- `docs/frontend-functionality-audit.md` records historical findings alongside
  current batch status. Historical gaps are superseded where the current
  implementation and evidence table explicitly record the change; reminder
  scheduling/provider activation and handwriting evidence remain open; video
  processing has verified synthetic FFmpeg/browser evidence, but representative
  student media and live-provider evidence remain separate.
- No complete live student workflow, real reminder delivery, paid AI call,
  production migration or production smoke test is established by this file.

When a later user instruction resolves one of these conflicts, record the
decision and any superseded requirement in the relevant durable document and
update this section rather than silently rewriting history. Do not preserve an
old rule as active merely because it appeared in an earlier plan.
