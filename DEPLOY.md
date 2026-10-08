# Deploying ExamMind

Two providers:

| Piece | Provider | Why |
| --- | --- | --- |
| Database | **Neon** | Postgres with pgvector, and a free tier that does not expire |
| API | **Render** | Runs a normal persistent process, which this backend needs |
| Frontend | **Render** | Static site hosting for the Vite build output |

Backend and frontend are both Render **web services** of different `runtime`s
(`docker` vs `static`), declared as two services in the same `render.yaml`, so
one Blueprint deploy sets up both. They are joined by environment variables
pointing at each other's URLs. Nothing in the application code is
provider-specific.

---

## Why the API uses a persistent service

This backend needs a normal persistent process for two independent reasons.

**It is too big.** The installed dependency set measures **460MB**, with
`cv2` alone at 112MB, `pymupdf` at 53MB
and `onnxruntime` at 44MB — before the embedding model's weights are fetched at
runtime. Swapping `opencv-python` for `opencv-python-headless` would save
perhaps 50MB. It is not close.

**Cold starts would undo the memory design.** The API deliberately keeps the
embedding model resident across requests — 205MB idle, 359MB once embeddings
are first used. A function that may spin up fresh per request reloads that
model on every wake, which is the exact cost the current design exists to
avoid.

Render runs a persistent process, so neither problem arises. The frontend has
none of these constraints — it's a static build —
so it runs as a second, separate Render service (`runtime: static`) rather
than sharing the API's service. Static sites don't run a process at all, so
this doesn't cost anything extra or share the API's 512MB ceiling.

---

## What it costs to run, measured

| | Free tier | What it means here |
| --- | --- | --- |
| Neon | 0.5GB storage | Uploaded files are stored **in the database**, so this is the real ceiling. Roughly 100–200 PDFs. |
| Render (API) | 512MB RAM, sleeps after 15 min idle | The API fits at 359MB peak. A sleeping service takes ~50s to answer the first request. |
| Render (static site) | Always on, no sleep, generous bandwidth | Static sites don't sleep — only the API service does. Not a constraint at this size. |

Two cold starts can stack. If the API has slept **and** Neon has
autosuspended, the first request of the day can take over a minute before
anything appears. That is the free tier working as designed, not a fault —
but it is worth knowing before you show it to anyone. The frontend itself
loads instantly either way, since it never sleeps; it's the first API call
from it that eats the delay.

If either sleeping API or the $0.35/GB-month Neon overage stops being
acceptable, Render's cheapest always-on paid tier is $7/month for the API
service — the static site stays free regardless.

---

## 1. Neon — the database

1. Sign up at [neon.tech](https://neon.tech). No card.
2. Create a project. Pick the region closest to your users — Frankfurt is
   usually the best of the free options from Nigeria.
3. Copy the **pooled** connection string from Connection Details. It looks
   like:
   ```
   postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
   Use the pooled one. `database.py` detects `-pooler.` in the host and turns
   off psycopg's prepared statements, because Neon's pooler is pgbouncer in
   transaction mode, where a prepared statement created on one backend fails on
   the next. Without that you get `prepared statement already exists` — but
   only once a query has run enough times to be prepared, so it surfaces under
   load rather than in testing.
4. Create the tables, once, from your machine:
   ```bash
   cd backend
   # put the Neon URL in .env as DATABASE_URL first
   .venv/Scripts/python.exe -m alembic -c alembic.ini upgrade head  # Windows
   python -m alembic -c alembic.ini upgrade head                   # macOS/Linux
   .venv/Scripts/python.exe init_db.py                             # seed reference data
   ```
   The migration records the revision in `alembic_version` and intentionally
   fails if the database role cannot create the `vector` extension. The
   complete clean-database and existing-database baseline procedures are in
   [docs/database-migrations.md](docs/database-migrations.md).

For an existing ExamMind database, do not run the clean-database command
blindly. Run `verify_migration.py --revision <verified-revision>` first,
resolve any reported drift, and stamp only the highest exact revision whose
schema has been confirmed. Do not stamp `0001_initial_schema` when later
revision tables are already present. No production database is reset or
recreated by this process.

---

## 2. Render — the API and the frontend

`render.yaml` declares both services, so one Blueprint sets both up.

1. New > Blueprint, pointed at this repository. Render reads `render.yaml`
   and creates two web services: `exammind-api` (Docker) and `exammind-web`
   (static).
2. Fill in the values marked `sync: false`, in the dashboard, on
   **exammind-api**:
   - `DATABASE_URL` — the Neon string from step 1.
   - `DEEPSEEK_API_KEY` — the configured primary provider key.
   - `COHERE_API_KEY` — the optional fallback provider key.
   - `AI_PROVIDER_TIMEOUT_SECONDS` — maximum wait for each DeepSeek/Cohere
     request; keep this within the application safety bound (45 seconds is
     the recommended deployment value). Provider retries are disabled so one
     user action does not create uncontrolled duplicate billable calls.
   - `CORS_ORIGINS` — leave it until step 4, when the frontend has a URL.
   - `GOOGLE_OAUTH_CLIENT_ID` â€” the OAuth 2.0 Web client ID shown in the
     Firebase project's Authentication/Google provider configuration. The API
     uses it as the expected audience for the Google provider ID token.

   `ADMIN_PORTAL_EMAILS` must contain the comma-separated, verified ExamMind
   account emails allowed into the global admin portal. Each account must
   also retain the database `admin` role; the email list is an additional
   server-side gate. Keep this value in Render configuration and never place
   real addresses in this repository.

   Audio transcription uses the OpenAI Audio Transcriptions API when it is
   configured. The current implementation sends `verbose_json` and expects
   timestamped segments, so `whisper-1` remains the intended model:

   ```text
   TRANSCRIPTION_PROVIDER=openai
   OPENAI_TRANSCRIPTION_MODEL=whisper-1
   OPENAI_TRANSCRIPTION_BASE_URL=https://api.openai.com/v1
   TRANSCRIPTION_TIMEOUT_SECONDS=90
   ```

   Set `OPENAI_API_KEY` as a Render secret on the API service. If it is
   missing, the provider is unsupported, the endpoint times out, or the
   response has invalid timestamps, the upload remains safely stored but is
   marked as transcription failed and is not reported as searchable. The API
   returns a configuration-safe message without exposing credentials or
   provider response bodies.

   Video uploads use the same OpenAI transcription contract after the API
   extracts the first audio track with the system `ffmpeg` binary. The
   original video remains in the authorized material record; the extracted
   mono WAV is temporary and is not stored. Configure these bounded limits
   only if the defaults need to be changed:

   ```text
   FFMPEG_BINARY=/usr/bin/ffmpeg
   VIDEO_EXTRACTION_TIMEOUT_SECONDS=120
   VIDEO_MAX_DURATION_SECONDS=3600
   VIDEO_MAX_EXTRACTED_AUDIO_BYTES=52428800
   ```

   The API image installs `ffmpeg`, `tesseract-ocr` and the English Tesseract
   model. A video without an audio track, a timed-out extraction, or a missing
   runtime dependency is saved as an unavailable-transcription source rather
   than reported as searchable. Video transcript chunks use the existing
   timestamped audio citation contract, so Reader, search and Maxe remain
   permission-aware and school-scoped.

   Study reminders have explicit owner consent, email/browser-push
   subscriptions, unsubscribe state and durable delivery tracking. Dispatch
   remains disabled by default and is not run from API startup or request
   handlers. Before enabling it, approve the cadence and trigger policy, then
   configure a separately scheduled worker to call the bounded reminder
   dispatch function. Email uses an SMTP provider; browser push uses VAPID
   credentials and the `pywebpush` dependency. The API must never receive a
   browser push private key in frontend variables.

   ```text
   REMINDER_DISPATCH_ENABLED=false
   REMINDER_CADENCE=
   REMINDER_PROVIDER_TIMEOUT_SECONDS=10
   REMINDER_EMAIL_PROVIDER=none
   REMINDER_EMAIL_SMTP_HOST=<provider host>
   REMINDER_EMAIL_SMTP_PORT=587
   REMINDER_EMAIL_SMTP_USERNAME=<provider username>
   REMINDER_EMAIL_SMTP_PASSWORD=<provider password>
   REMINDER_EMAIL_FROM=<verified sender address>
   REMINDER_PUSH_VAPID_PUBLIC_KEY=<public key>
   REMINDER_PUSH_VAPID_PRIVATE_KEY=<API secret>
   REMINDER_PUSH_VAPID_SUBJECT=mailto:<operator address>
   REMINDER_WORKER_ENABLED=false
   ```

   Set `VITE_VAPID_PUBLIC_KEY` on the frontend only after the matching VAPID
   key pair is configured on the API. It is public browser configuration; the
   private key remains server-side. Do not enable dispatch until the worker
   has a stable period key, bounded retries, monitoring and a tested opt-out
   path. Local and CI verification injects `MockReminderSender` and never
   sends a real message.

   The API also needs these Firebase verification values (the Blueprint fills
   the fixed values automatically):

   ```text
   FIREBASE_PROJECT_ID=exammind-509123
   FIREBASE_CERTS_URL=https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com
   GOOGLE_CERTS_URL=https://www.googleapis.com/oauth2/v1/certs
   FIREBASE_CLOCK_SKEW_SECONDS=60
   FIREBASE_CERT_FETCH_TIMEOUT_SECONDS=10
   ACCOUNT_DELETION_ENABLED=false
   PERMANENT_ACCOUNT_DELETION_ENABLED=false
   FIREBASE_ADMIN_DELETE_ENABLED=false
   ```

   Account deletion is disabled unless the API environment explicitly sets
   `ACCOUNT_DELETION_ENABLED=true`. When it is false or missing, the API
   returns HTTP 503 and the Settings screen keeps the destructive action
   unavailable. Render is intentionally configured with `false` by default.

   The API verifies Firebase ID tokens with Google's published certificates.
   No Firebase service-account JSON file or private key belongs in Render or
   this repository.
3. Deploy `exammind-api` first. This Blueprint uses Render's free web-service
   plan, which does not support `preDeployCommand`; the Docker start command
   runs `python -m alembic -c alembic.ini upgrade head` and only then starts
   Uvicorn. A migration failure therefore prevents this instance from binding
   or becoming healthy. If the service is later moved to a Render plan that
   supports pre-deploy commands, keep the migration gate in exactly one place
   and move it to that supported hook deliberately. First build takes a few
   minutes; `fastembed` and `onnxruntime` are large wheels.
   Check `https://<your-api>.onrender.com/health` returns a process-health
   response. `GET /health` deliberately does not query Neon, so a running API
   is distinguishable from a dependency-ready API. Check
   `https://<your-api>.onrender.com/health/ready` separately; it returns only
   application/database status and HTTP 503 when the database is unavailable.
4. On **exammind-web**, fill in the `sync: false` values:
   - `VITE_API_BASE_URL` — `https://<your-api>.onrender.com` from step 3.
     **Include `https://`.** `api.ts` builds requests as
     `` `${API_BASE_URL}${path}` ``, so a bare hostname resolves as a
     relative path against the frontend and every call quietly 404s against
     the wrong origin.

     **This is inlined at build time**, not read at runtime. Vite substitutes
     it into the bundle during `npm run build`, so changing it later means
     redeploying the frontend, not just editing the variable.
   Set the Firebase Web configuration variables as well. These values are
   public client configuration, but they still belong in the Render build
   environment rather than in application source:

   ```text
   VITE_FIREBASE_API_KEY=<Firebase Web API key>
   VITE_FIREBASE_AUTH_DOMAIN=exammind-509123.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=exammind-509123
   VITE_FIREBASE_STORAGE_BUCKET=exammind-509123.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=290862287209
   VITE_FIREBASE_APP_ID=1:290862287209:web:850bada52a1fc81ed495f8
   ```

   In Firebase Console, enable Email/Password and Google sign-in, add
   `localhost` and `exammind-web.onrender.com` to Authentication > Settings >
   Authorized domains. The backend performs authoritative Firebase identity
   verification and applies any CU eligibility rules at the CU learning-space
   boundary; browser-side checks are never sufficient.
5. Deploy `exammind-web`, then go back to `exammind-api` and set
   `CORS_ORIGINS` to its origin:
   ```
   https://exammind-web.onrender.com
   ```
   (or whatever Render assigned it — check the service's dashboard page).
   Render will restart the API.

Because both services live on Render, there's no second dashboard, no
separate billing relationship, and no cross-provider DNS to get right — just
two env vars pointing at each other's `.onrender.com` URLs.

### Deployment readiness checklist

The API requires these deployment-time values:

| Area | Required values | Notes |
| --- | --- | --- |
| Database | `DATABASE_URL` | Use the pooled Neon PostgreSQL URL; it must have the `vector` extension available. The same database is the shared rate-limit counter store. |
| Application | `SECRET_KEY`, `APP_ENV=production`, `ENV=production` | Keep the secret in Render's secret store. |
| Identity | `FIREBASE_PROJECT_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `FIREBASE_CERTS_URL`, `GOOGLE_CERTS_URL` | Certificate URLs must remain the configured HTTPS Google endpoints. No Firebase private key is required. |
| Providers | `AI_PROVIDER`, `AI_MODEL`, `AI_PROVIDER_TIMEOUT_SECONDS`, `AI_FALLBACK_PROVIDER`, `COHERE_MODEL`, `DEEPSEEK_API_KEY`, `COHERE_API_KEY` | Provider keys are API-service secrets. Requests have bounded timeouts and no uncontrolled retries. |
| Transcription | `TRANSCRIPTION_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_TRANSCRIPTION_BASE_URL`, `TRANSCRIPTION_TIMEOUT_SECONDS` | OpenAI transcription is optional; when unavailable, audio/video originals remain stored and are marked unavailable for transcription. |
| Video processing | `FFMPEG_BINARY`, `VIDEO_EXTRACTION_TIMEOUT_SECONDS`, `VIDEO_MAX_DURATION_SECONDS`, `VIDEO_MAX_EXTRACTED_AUDIO_BYTES` | FFmpeg is installed in the Docker image; extraction is bounded and the derived WAV is temporary. |
| Reminders | `REMINDER_DISPATCH_ENABLED`, `REMINDER_CADENCE`, SMTP values, VAPID values, `REMINDER_WORKER_ENABLED` | Disabled by default. Requires an approved cadence/trigger, external email/push providers and a separately scheduled worker. |
| Safety limits | `MAX_UPLOAD_BYTES`, `UPLOAD_READ_CHUNK_BYTES`, `MAX_INDEX_CHUNKS`, `MAX_RAG_QUESTION_CHARS`, `MAX_OCR_PAGES` | Keep upload, extraction and provider work bounded. |
| Rate limiting | `RATE_LIMIT_ENABLED=true`, `RATE_LIMIT_FAILURE_MODE=closed`, `RATE_LIMIT_*` values | PostgreSQL is the shared backing store. The service does not fall back to process-local counters. |
| Browser/API boundary | `CORS_ORIGINS` | Set to the exact frontend origin(s), with scheme and no wildcard. |

The frontend build requires `VITE_API_BASE_URL`, all six
`VITE_FIREBASE_*` values (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`,
`STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, and `APP_ID`). These are injected at
build time, so changing them requires a new static-site build. Set
`VITE_VAPID_PUBLIC_KEY` only when browser-push delivery is configured; it is
safe public key material, unlike `REMINDER_PUSH_VAPID_PRIVATE_KEY`.

Use this order for a new environment: provision Neon and confirm pgvector;
for an existing database run `verify_migration.py --revision <verified-revision>`
and resolve drift before stamping the reviewed revision;
run/allow the Alembic upgrade through `0005`;
seed reference data; deploy the API; verify `/health` and `/health/ready`; set
the frontend API/Firebase build values and deploy the frontend; then set the
exact frontend origin in API `CORS_ORIGINS` and redeploy/restart the API.

If the Docker-start migration fails, do not reset or recreate the database.
Read the migration error from the failed deployment, verify the database URL
points to the intended Neon branch, confirm pgvector and the current Alembic
revision, and use the existing-database verification/stamp procedure before
retrying. If readiness returns 503 while `/health` is 200, inspect Neon
connectivity and credentials; the process itself is running and no provider
secrets are returned by either health endpoint.

Live Render, Neon and Firebase settings are not verified by this repository
review. Confirm them under the relevant provider access before treating a
deployment as production-ready.

Python is pinned to 3.12.7 on `exammind-api` because the `fastembed` and
`onnxruntime` wheels lag the newest Python. The pin lives in
`backend/Dockerfile`'s base image now, not in a `PYTHON_VERSION` variable —
the service builds from that image rather than from Render's native Python
runtime, so the dashboard has no Python version to set.

### After a redeploy, hard-reload once

`sw.js` registers a service worker in production builds. It can serve the
previous build's assets until it updates. If a deploy looks like it did not
take, that is usually why.

### OCR: why this service runs on Docker

`pytesseract` is a wrapper, not an OCR engine — it shells out to a **system
`tesseract` binary**. Render's native Python runtime has no way to install one,
and without it the code degrades honestly rather than crashing: the upload
comes back flagged `needs_clearer_file` and is not indexed. Every scanned or
photographed past paper lands there, which for Nigerian past questions is most
of the real uploads.

That is why `exammind-api` is `runtime: docker` and not `runtime: python`.
`backend/Dockerfile` apt-installs `tesseract-ocr`, its English model and
`ffmpeg`, and
`render.yaml` points at it with `dockerfilePath` and `dockerContext`, relative
to the API service root (`backend`) because `rootDir` is set. Nothing to
configure in the dashboard; Render builds the image and runs it.

Two consequences worth knowing:

- **The first build is slower** than a pip install on the native runtime,
  because it builds an image. Later builds reuse the dependency layer as long
  as `requirements.txt` has not changed.
- **`opencv-python` became `opencv-python-headless`.** The full package needs
  `libGL`, which a slim image does not carry; the ingest path only ever calls
  OpenCV's image-processing functions, never a GUI or video one. On the native
  runtime this was failing silently — `import cv2` is inside a `try`, so a
  missing `libGL` quietly dropped the OCR pre-processing rather than
  reporting it.

To confirm OCR is live after deploying, the ingest router exposes a
diagnostic that reports `pytesseract_imported`, `tesseract_cmd` and
`tesseract_version`. A real version string there means the binary is found.

Set `DISABLE_LOCAL_EMBEDDINGS=true` if you hit the 512MB ceiling. Search falls
back to keyword ranking, which every caller already handles.

---

## What the code does on first boot

- On startup, enables the `vector` extension, then creates any missing tables.
  Safe to run repeatedly; it never drops anything. If Neon is temporarily
  unavailable, the process still binds `/docs` and logs the database error;
  database-backed requests remain unavailable until the connection is fixed.
- Does **not** load the embedding model. That happens on first use, so the
  service starts at ~205MB and passes its health check before paying the cost.
- Attempts the database connection with a 10s timeout (`DB_CONNECT_TIMEOUT`).
  Without it a missing database could hold the startup hook indefinitely;
  with it, the warning is logged and `/docs` binds after the timeout.

---

## Local development

`backend/.env` is gitignored. Point `DATABASE_URL` at the same Neon database —
there is no local Postgres in this setup, and Docker is not required.

```bash
cd backend
.venv/Scripts/python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Port **8001**, not 8000: `frontend/src/lib/api.ts` defaults to
`http://127.0.0.1:8001` when `VITE_API_BASE_URL` is unset.

```bash
cd frontend
npm run dev
```

Pointing local development at the deployed Neon database means local uploads go
into the same archive the deployed app reads. Create a second Neon branch if
you want them kept apart — Neon branches are cheap and instant.

## Account lifecycle and deletion

Users have an explicit `account_status`: `active`, `deactivated`, or
`pending_deletion`. The additive migration also adds `deactivated_at`,
`deletion_requested_at`, and `deletion_due_at`; existing users remain active.

**Deactivate account** is reversible. It requires recent Firebase
reauthentication, marks the account inactive, signs the student out, and keeps
server-side study data. Protected API requests reject the inactive session.
Signing in again shows the deactivated state and offers verified reactivation.
For privacy, ExamMind clears offline study files from the device during
deactivation; server-side files and progress are not deleted.

**Delete account** is a scheduled action, not an immediate deletion. It
deactivates the account, records server timestamps, and sets
`deletion_due_at` to 30 days later. During that period, verified sign-in shows
the scheduled date and offers cancellation/reactivation. No Neon or Firebase
identity is permanently deleted when the request is made.

This is not a production promise that permanent deletion will occur after 30
days. Render keeps `ACCOUNT_DELETION_ENABLED=false`, so the Delete account
action is unavailable there. Do not enable the scheduled action for production
until secure Firebase identity deletion, a Render Cron schedule, and disposable
account testing have all been completed.

The daily cleanup entry point is:

```bash
cd backend
.venv/Scripts/python.exe run_account_cleanup.py
```

It processes bounded batches only when `deletion_due_at` has passed, and keeps
failed rows pending for retry. Permanent cleanup is disabled unless both
`PERMANENT_ACCOUNT_DELETION_ENABLED=true` and
`FIREBASE_ADMIN_DELETE_ENABLED=true` are explicitly configured. The current
repository does not include a Firebase Admin deletion mechanism or private key,
so the job remains inert until a server-authorized mechanism is securely wired
in. The safe options are to configure Firebase Admin credentials only in the
scheduled worker's secret store, or to use another documented server-authorized
Firebase identity-deletion mechanism. The repository never contains a service-
account key.

After authorized permanent cleanup runs, the existing transaction service
deletes private data, anonymizes preserved public content, transfers group and
reading-room ownership safely, and creates a tombstone containing only the
Firebase UID and deletion timestamp. It does not store an email, name,
username, token, or study content in the tombstone.

Restart onboarding is a separate admin/development-only action. It only resets
onboarding to `pending`; it does not delete Firebase, Neon, uploads, progress,
groups, discussions, or rooms. The backend enforces this authorization even if
the frontend control is hidden.
