# KSA MVP stabilization review handoff

Status: local preparation complete; production execution is **NOT RUN**.

This handoff records the S0-S16 stabilization review. It does not authorize a
production deployment, migration, provider call, or smoke test. The exact
production workflow is in [production-smoke-test-checklist.md](production-smoke-test-checklist.md).

## Review state

- Branch: `fix/ui-broken-parts`
- Local review tip before this documentation commit:
  `a2e2db9d5a133aed416f15f55c0e04cdafe18d4b`
- Proposed deployment branch: `fix/ui-broken-parts`.
- Proposed deployment commit: the final reviewed tip including this handoff;
  the full commit hash is reported with this document's commit. No push or
  deployment was performed.
- The local tracking ref was `1e00b23900aa0183f39f3a3c7542c967ad719531`.
  A read-only `git fetch --dry-run` and `git ls-remote` were attempted, but
  both were blocked by inability to connect to GitHub over port 443. The
  tracking ref is therefore not evidence of current remote state.
- Unrelated untracked files were preserved and are not part of this handoff.

## Stabilization status and evidence

The status below distinguishes implementation/commits from independently
rerun validation. A phase marked as locally evidenced inherits its recorded
phase validation unless this handoff explicitly says it was rerun. No row is
production verified.

| Stage | Current status | Implementation evidence | Validation evidence in this review |
| --- | --- | --- | --- |
| S0 | Complete: audit only | Baseline and implementation plan were recorded; no production code was required. | Repository state and plan were rechecked; the original audit was not recreated in full. |
| S1 | Implemented and committed locally | `ba986f6` versioned Alembic migration system. | Inherited migration checks; no production migration run. |
| S2 | Implemented and committed locally | `9b6d35d`, `48c2cf1` migration safety/baseline checks. | Inherited isolated PostgreSQL evidence; production database not accessed. |
| S3 | Implemented and committed locally | `de836bc` through `a4d97aa` identity, CU/KSA membership and onboarding changes. | Inherited auth/browser fixtures; real Firebase accounts not used in this review. |
| S4 | Implemented and committed locally | `0d51848` through `8894839` KSA claim, audit, release and admin support. | Inherited authorization tests; production KSA setup not verified. |
| S5 | Implemented and committed locally | `e9a0bf9` through `e02ecdb` moderator bootstrap and controlled transitions. | Inherited moderation tests; first production moderator not assigned. |
| S6 | Implemented and committed locally | `0b8ccaf` PostgreSQL-backed distributed rate limiting. | Inherited focused/full backend validation; live multi-instance deployment not verified. |
| S7 | Implemented and committed locally | `0ef0fc5` transcription configuration and failure handling. | Inherited provider-isolated tests; no paid transcription call was made. |
| S8 | Implemented and committed locally | `9ba7987` sharing UI and isolated browser verification. | Inherited Playwright evidence; no production links were created. |
| S9 | Implemented and committed locally | `3f72440` export UI coverage. | Inherited export/browser evidence; no production download was performed. |
| S10 | Implemented and committed locally | `bee5f2f` approved shared-resource retention/deletion behavior. | Inherited PostgreSQL/authorization tests; no production account deletion was run. |
| S11 | Implemented and committed locally | `0e61272` explicit public response contracts. | Inherited response-contract and browser evidence. |
| S12 | Implemented and committed locally | `9c308b1` provider timeout, failure and secret-safe error handling. | Inherited mocked provider tests; no live provider call was made. |
| S13 | Implemented and committed locally | `3d166c1` bounded upload/storage-risk preparation and cleanup safeguards. | Inherited storage and full-suite evidence; no live cleanup was run. |
| S14 | Implemented and committed locally | `8661057` route-level code splitting. | Inherited build/browser evidence and bundle comparison. |
| S15 | Implemented and committed locally | `a2e2db9` health checks and migration-before-start deployment configuration. | Full backend suite, compilation, build, lint, typecheck and mocked health checks were rerun locally; live Render/Neon settings remain unverified. |
| S16 | Prepared in this handoff | The exact 24-step checklist is in `docs/production-smoke-test-checklist.md`. | Local fixture/browser checks were run; production execution is **NOT RUN**. |

### Local validation evidence

The final local evidence available for this handoff includes:

- Backend: 264 tests passed with provider selectors disabled for the ordinary
  suite; provider-specific behavior used mocks/synthetic failures.
- Python source compilation: 72 files passed.
- Frontend lint, TypeScript build/typecheck and production build passed.
- `git diff --check` passed.
- Isolated Playwright verification covered workspace navigation, upload
  navigation, Reader, sharing create/copy/revoke and clipboard failure,
  collaboration, export request, desktop overflow and mobile panel tabs.
  The browser checks used fixtures, not Firebase, Render, Neon or paid
  providers. The fixture-only browser harness supplied the current
  `is_owner` contract; application code was not changed for that adjustment.
- No frontend test script exists in `package.json`; frontend regression tests
  are therefore reported as unavailable rather than invented.
- The existing CDP runner remains blocked at `Page.enable`; isolated
  Playwright was used instead with a fresh temporary profile and no normal
  browser sessions were closed.

## Completed behavior

The local stabilization branch contains the documented work for:

- versioned PostgreSQL/Alembic migrations and isolated baseline checks;
- Firebase identity separation, CU membership authorization, KSA self-claim,
  release/recovery and multi-space isolation;
- global-admin-controlled moderator bootstrap and audited KSA role changes;
- PostgreSQL-backed distributed rate limiting with configurable limits and
  explicit failure behavior;
- safe audio transcription configuration, timestamp validation and retained
  source audio on transcription failure;
- resource sharing, revocation, supported exports and ownership-preserving
  retention of approved shared resources;
- explicit public response DTOs that keep binary, storage, extraction,
  embedding, provider and credential fields out of public JSON;
- bounded provider failures, upload reads, MIME/type checks and processing
  cleanup safeguards;
- route-level frontend code splitting;
- process/readiness health endpoints and migration-before-start deployment
  configuration.

## Known limitations and unavailable checks

- No production Firebase sign-in, KSA claim, Render request, Neon migration,
  real transcription, Maxe request or paid provider call was performed.
- Current Render service settings, auto-deploy trigger, live CORS value,
  Firebase authorized domains, Neon backup/PITR availability and production
  secrets require authorized operator verification.
- The read-only remote check was blocked by GitHub connectivity. Local
  `origin/fix/ui-broken-parts` is only a stale tracking reference until a
  successful read-only remote query confirms it.
- Docker image build was not run because Docker Desktop is unavailable in the
  local environment. The deployment command is documented and the Python
  application checks passed.
- A frontend test script is not declared; lint, typecheck, build and isolated
  browser checks were the available frontend validations.
- Production cold-start duration, real provider latency and actual Render
  plan behavior remain deployment observations, not local guarantees.

## Required live configuration

Before any authorized deployment, configure and verify without committing
secrets:

- Neon PostgreSQL pooled `DATABASE_URL` with `vector` available, and an
  authorized backup/restore or branch snapshot procedure.
- A production `SECRET_KEY`, `APP_ENV=production`, `ENV=production`, exact
  `CORS_ORIGINS`, and the configured upload, indexing, OCR, timeout and
  database-connect limits.
- Firebase project identity and certificate configuration plus the Google
  OAuth client ID expected by the backend. Configure the frontend's
  `VITE_API_BASE_URL` and all six `VITE_FIREBASE_*` build values in Render.
- DeepSeek primary and Cohere fallback keys/models/timeouts, if AI features
  are enabled. Keep provider retries bounded/disabled as documented.
- Optional OpenAI transcription configuration: `OPENAI_API_KEY`,
  `TRANSCRIPTION_PROVIDER`, `OPENAI_TRANSCRIPTION_MODEL`,
  `OPENAI_TRANSCRIPTION_BASE_URL` and `TRANSCRIPTION_TIMEOUT_SECONDS`.
  `whisper-1` remains the current timestamped implementation model.
- PostgreSQL-backed rate-limit settings with the documented failure mode and
  per-route limits. The application must not silently fall back to process
  memory for distributed enforcement.
- The supported KSA self-claim/verification path, a separately identified
  moderator with active KSA membership, and a global admin for audited setup
  or recovery. A preloaded registry is not required by the approved S4 flow.

## Deployment and recovery handoff

The proposed deployment ref is branch `fix/ui-broken-parts` at the final
reviewed documentation commit reported with this handoff. Pushing that branch
may trigger a Render deployment only if the live Render service is connected
to this repository/branch and auto-deploy is enabled. Those live settings
were not accessed, so an automatic deployment trigger is **UNVERIFIED**.

The current free-plan deployment flow runs:

```text
python -m alembic -c alembic.ini upgrade head
exec python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The migration gate runs before Uvicorn binds. A migration failure therefore
prevents that instance from becoming healthy; it must not be bypassed by
starting the application against an unverified schema. If the service moves
to a plan supporting a pre-deploy hook, keep migration execution in exactly
one supported place.

Before production migration or deployment, the operator must:

1. Confirm the exact Neon production branch and pooled URL out of band.
2. Take an authorized Neon backup, branch snapshot or point-in-time recovery
   safeguard supported by the account, and confirm how to restore it.
3. Verify pgvector, current Alembic revision and existing-schema drift using
   the repository procedure; do not reset, recreate or blindly stamp a live
   database.
4. Confirm secrets, CORS, Firebase domains, provider budgets and Render
   service settings.
5. Deploy the API/migration gate, check `/health` and `/health/ready`, then
   build/deploy the frontend with its API and Firebase values.
6. Run the authorized smoke-test checklist below, recording redacted evidence
   and stopping on its isolation, security, migration, health or cost stop
   conditions.

Recovery means inspecting the failed migration/deployment, restoring service
   configuration or using the approved backup/recovery path. It does not mean
   destructive rollback, database reset, recreation or data loss.

## Exact 24-step production smoke test

The checklist is the source of truth for targets, expected results, evidence,
data changes, cost and cleanup. The exact ordered steps are:

1. Real Google sign-in
2. KSA ID claim
3. Returning login
4. PDF upload
5. PPTX upload
6. Audio upload
7. Real transcription
8. Reader opening
9. Page citation
10. Slide citation
11. Timestamp citation
12. Maxe grounded answer
13. Knowledge gap
14. Beyond Materials
15. Quiz generation
16. Quiz submission
17. Readiness
18. KSA contribution
19. Moderator approval
20. Resource share link
21. Revoke share link
22. Authorized download
23. Logout
24. Login persistence

Each step must be marked independently as `LOCAL VERIFIED`, `PRODUCTION
VERIFIED`, `BLOCKED`, or `NOT RUN`. Local fixtures and mocked providers never
count as production evidence.

## Accounts, data changes and provider costs

Use a dedicated Google/Firebase student account with a valid unused KSA ID,
the same account for return/persistence, a separate active KSA moderator,
and a separate global admin only for authorized setup/recovery. Do not use a
CU-only account as evidence of KSA access. Use only non-sensitive PDF, PPTX,
audio and study-topic materials with known page, slide and timestamp anchors.

The run creates or updates a test identity and KSA membership, three test
resources, processing/transcription state, quiz/attempt/readiness evidence,
a contribution/moderation state and a share link that must be revoked. It
also creates a local authorized download. Remove only disposable test records
through supported product cleanup after evidence is captured; preserve audit
and required provenance records. Never edit production tables directly.

Real transcription, Maxe, quiz generation and Beyond Materials can incur
provider charges. Obtain explicit approval and a cost limit before steps 7,
12-15. The local review used fixtures/mocks and intentionally made no paid
provider calls.

## Final handoff status

**KSA MVP STABILIZATION READY FOR AUTHORIZED PRODUCTION SMOKE TEST**

This means local preparation and documentation are complete. It does not mean
the live Render, Neon, Firebase, transcription or AI configuration has been
verified, and it does not authorize production action.
