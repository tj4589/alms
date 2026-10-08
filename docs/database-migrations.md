# ExamMind database migrations

ExamMind uses Alembic as the only schema migration system. The API does not
create tables, enable pgvector, alter columns, or run backfills during normal
startup. Reference data seeding is an explicit command after the schema is
ready.

## New isolated database

From `backend/`, with a disposable PostgreSQL database whose role can install
the `vector` extension:

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
.\.venv\Scripts\python.exe init_db.py
```

The initial revision creates the current Phase A-G schema and records
`0001_initial_schema` in `alembic_version`. It creates `vector` intentionally;
the database role must have the required extension privilege or the migration
fails before the schema is created.

## Existing ExamMind database

Never run `upgrade head` against an existing deployment before checking its
schema, and never stamp a database that has not been inspected.

1. Take a verified database backup and use a maintenance window.
2. Run the read-only full-head check:

   ```powershell
   .\.venv\Scripts\python.exe verify_migration.py
   ```

   The checker defaults to `0004_rate_limit_buckets` and reports the current
   `alembic_version` marker, missing objects, unexpected later-revision
   objects, and pgvector status. It is read-only and fails rather than
   silently accepting an incomplete or mismatched schema.

3. If the database may be at an earlier revision, inspect that exact revision
   explicitly. This is required before choosing a stamp target:

   ```powershell
   .\.venv\Scripts\python.exe verify_migration.py --revision 0001_initial_schema
   .\.venv\Scripts\python.exe verify_migration.py --revision 0002_ksa_claim_audit
   .\.venv\Scripts\python.exe verify_migration.py --revision 0003_learning_space_role_audit
   .\.venv\Scripts\python.exe verify_migration.py --revision 0004_rate_limit_buckets
   ```

   A report for an earlier revision intentionally marks later migration
   tables as unexpected. Do not stamp that earlier revision when later tables
   are already present; inspect and select the highest complete revision
   instead. The `ksa_claim_audits` table from `0002` is checked explicitly.

4. Compare the report with the expected schema and resolve every missing or
   unexpected table, column, index, constraint, or pgvector prerequisite with
   a separately reviewed reconciliation revision. Only after the selected
   revision report is clean, establish that exact baseline without recreating
   tables or touching rows:

   ```powershell
   .\.venv\Scripts\python.exe -m alembic -c alembic.ini stamp 0001_initial_schema
   ```

   Replace `0001_initial_schema` with the highest exact revision proven by the
   corresponding report. Stamping records a known state; it does not validate
   or change the schema.

5. Run future revisions normally:

   ```powershell
   .\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
   ```

## Legacy baseline reconciliation

When the exact-revision checker reports that all baseline tables exist but
baseline indexes, foreign keys, or unique constraints are missing, use the
explicit reconciliation utility. It is check-only unless `--apply` is
provided, never writes `alembic_version`, and never modifies application rows.

Run the preflight against a disposable clone with a read-only transaction:

```powershell
$env:PGOPTIONS = "-c default_transaction_read_only=on"
.\.venv\Scripts\python.exe reconcile_baseline_schema.py
```

The preflight stops on duplicate membership keys, duplicate case-insensitive
user emails, orphan foreign-key values, missing required columns/tables,
existing migration history, or incompatible object definitions. Do not delete,
merge, rewrite, or manually choose records to make the report pass.

After a verified backup, maintenance window, clean preflight, and successful
clone rehearsal, clear read-only mode and run the same explicit DDL plan:

```powershell
Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe reconcile_baseline_schema.py --apply --lock-timeout-ms 5000
```

The apply operation is one transaction. It adds only the eight named indexes,
the two named unique constraints, and the four named foreign keys. A lock
timeout or DDL failure rolls the transaction back. Normal `CREATE INDEX` and
constraint validation can briefly block writes and scan affected tables, so
use a maintenance window and monitor lock waits. It does not use concurrent
index creation because the all-or-nothing transaction is the safer recovery
boundary; schedule the operation away from upload, indexing, and migration
activity.

The utility does not stamp or migrate. Only after it commits and the exact
`0001_initial_schema` report is clean may the operator run, separately:

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini stamp 0001_initial_schema
.\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade 0004_rate_limit_buckets
```

If any preflight conflict or data violation is reported, stop, preserve the
database, and prepare a reviewed reconciliation or recovery from backup. The
original database must not be repaired by trial and error.

The baseline revision is not a data migration and is intentionally not run on
an already populated database. Stamping records the known revision only; it
does not validate or change schema, which is why the exact-revision read-only
verifier is a required prior step. No production database was stamped as part
of this work.

## Reconciled schema drift

The old `migrate.py` path and the startup path were not equivalent. The
following five items existed in `migrate.py` but were absent from `main.py` and
are retained in the reviewed baseline because current code still requires them:

| Drift item | Decision | Handling |
| --- | --- | --- |
| `users.username` | Required current schema | Included as a nullable indexed unique column. |
| `ix_users_email_lower` | Required account-identity constraint | Created as a unique lower-case expression index. |
| `past_questions.embedding` | Required retrieval column | Included as `VECTOR(384)`. |
| `study_materials.embedding` | Required retrieval column | Included as `VECTOR(384)`. |
| `lecture_note_chunks.embedding` | Required retrieval column | Included as `VECTOR(384)`. |

The remaining differences were duplicated migration logic or data repair:
startup `ALTER TABLE` statements, independent commits, and tolerant `SKIP`
handlers are retired; model-defined nullable/default/index/foreign-key state
is represented once in the baseline. The old data backfill and reference-data
seeding are not schema changes: backfill is no longer run during API startup,
and `init_db.py` is an explicit seed command. `migrate.py` remains only as a
compatibility wrapper so existing runbooks delegate to Alembic rather than
maintaining a second schema source of truth.

## Inspecting and creating revisions

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini current
.\.venv\Scripts\python.exe -m alembic -c alembic.ini history
.\.venv\Scripts\python.exe -m alembic -c alembic.ini heads
.\.venv\Scripts\python.exe -m alembic -c alembic.ini revision --autogenerate -m "describe the schema change"
```

Autogenerated output is only a draft. Review it against `models.py`, the live
schema report, indexes, foreign keys, pgvector types, and data-preservation
requirements before applying it. The initial baseline has no safe downgrade:
`downgrade` raises `NotImplementedError`; rollback requires restoring a
database backup. Future additive revisions should provide a tested downgrade
when it is genuinely safe.

## Local PostgreSQL smoke test

Use the repository's Docker Compose PostgreSQL/pgvector service if Docker is
available. Point `DATABASE_URL` only at that disposable local database, then
run `upgrade head`, inspect `alembic_version`, required tables/indexes/foreign
keys, the `vector` extension, and the vector column types. SQLite is not a
valid substitute because the application uses PostgreSQL-specific connection
and vector behavior.

## Deployment sequencing (later work)

Production deployment must run the migration command before starting the API,
with the production Neon URL supplied only by the deployment environment. The
Render deployment workflow is intentionally not changed in S1/S2; production
execution belongs to the later stabilization deployment work.
