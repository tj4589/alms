# Deploying ExamMind

Three providers, one each for the thing it is actually good at:

| Piece | Provider | Why |
| --- | --- | --- |
| Database | **Neon** | Postgres with pgvector, and a free tier that does not expire |
| API | **Render** | Runs a normal persistent process, which this backend needs |
| Frontend | **Vercel** | A Vite build producing static files |

They are joined by environment variables pointing at each other's URLs. Nothing
in the application code is provider-specific.

---

## Why the API is not on Vercel

Vercel's Python support is serverless functions, and this backend is the wrong
shape for that in two independent ways.

**It is too big.** Vercel caps a function at 250MB unzipped. The installed
dependency set measures **460MB**, with `cv2` alone at 112MB, `pymupdf` at 53MB
and `onnxruntime` at 44MB — before the embedding model's weights are fetched at
runtime. Swapping `opencv-python` for `opencv-python-headless` would save
perhaps 50MB. It is not close.

**Cold starts would undo the memory design.** The API deliberately keeps the
embedding model resident across requests — 205MB idle, 359MB once embeddings
are first used. A function that may spin up fresh per request reloads that
model on every wake, which is the exact cost the current design exists to
avoid.

Render (or Railway, or Fly) runs a persistent process, so neither problem
arises. If you would rather not use Vercel for the frontend either, Render's
static site does the same job — see the note at the end of `render.yaml`.

---

## What it costs to run, measured

| | Free tier | What it means here |
| --- | --- | --- |
| Neon | 0.5GB storage | Uploaded files are stored **in the database**, so this is the real ceiling. Roughly 100–200 PDFs. |
| Render | 512MB RAM, sleeps after 15 min idle | The API fits at 359MB peak. A sleeping service takes ~50s to answer the first request. |
| Vercel | 100GB bandwidth | Not a constraint at this size. |

Two cold starts can stack. If Render has slept **and** Neon has autosuspended,
the first request of the day can take over a minute before anything appears.
That is the free tier working as designed, not a fault — but it is worth
knowing before you show it to anyone.

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
   .venv/Scripts/python.exe migrate.py     # Windows
   python migrate.py                        # macOS/Linux
   ```
   This also runs `CREATE EXTENSION IF NOT EXISTS vector`, which Neon supports.

You do not need to enable pgvector by hand, and you do not need Alembic — the
schema is created from the models.

---

## 2. Render — the API

1. New > Blueprint, pointed at this repository. It reads `render.yaml` and
   creates one web service.
2. Fill in the three values marked `sync: false`, in the dashboard:
   - `DATABASE_URL` — the Neon string from step 1.
   - `DEEPSEEK_API_KEY` — or set `AI_PROVIDER` to something else and supply
     that key instead.
   - `CORS_ORIGINS` — leave it until step 3, when the frontend has a URL.
3. Deploy. First build takes a few minutes; `fastembed` and `onnxruntime` are
   large wheels.
4. Check `https://<your-api>.onrender.com/docs` loads.

`PYTHON_VERSION` is pinned to 3.12.7 because the `fastembed` and `onnxruntime`
wheels lag the newest Python.

### OCR will not work until you deal with this

`pytesseract` calls a **system `tesseract` binary**. Render's native Python
runtime does not include one, and nothing in this repo installs it. The code
degrades honestly rather than crashing — the upload comes back flagged
`needs_clearer_file` and is not indexed — but every scanned or photographed
past paper will land there, which for Nigerian past questions is a large share
of real uploads.

Two ways out:

- **Switch the service to Render's Docker runtime** with a Dockerfile that runs
  `apt-get install -y tesseract-ocr`. There is no Dockerfile in the repo yet;
  ask and I will write one.
- **Accept text-PDF-only for now.** Digitally generated PDFs extract fine
  through PyMuPDF without Tesseract.

Set `DISABLE_LOCAL_EMBEDDINGS=true` if you hit the 512MB ceiling. Search falls
back to keyword ranking, which every caller already handles.

---

## 3. Vercel — the frontend

1. New Project, import this repository.
2. Set **Root Directory** to `frontend`. Vercel detects Vite and fills in
   `npm run build` and `dist` itself.
3. Add one environment variable:
   ```
   VITE_API_BASE_URL = https://<your-api>.onrender.com
   ```
   **Include `https://`.** `api.ts` builds requests as
   `` `${API_BASE_URL}${path}` ``, so a bare hostname resolves as a relative
   path against the frontend and every call quietly 404s against the wrong
   origin.

   **This is inlined at build time**, not read at runtime. Vite substitutes it
   into the bundle during `npm run build`, so changing it later means
   redeploying the frontend, not just editing the variable.
4. Deploy, then go back to Render and set `CORS_ORIGINS` to the Vercel origin:
   ```
   https://<your-project>.vercel.app
   ```
   Render will restart the API.

No `vercel.json` is needed. The app has no client-side router — screens are
component state — so there are no deep links requiring a rewrite to
`index.html`.

### Preview deployments will fail CORS

Every Vercel preview gets its own URL, and `CORS_ORIGINS` lists one origin.
Previews will load and then fail every API call. Either add the preview domain
alongside production, or treat previews as build checks only.

### After a redeploy, hard-reload once

`sw.js` registers a service worker in production builds. It can serve the
previous build's assets until it updates. If a deploy looks like it did not
take, that is usually why.

---

## What the code does on first boot

- Enables the `vector` extension, then creates any missing tables. Safe to run
  repeatedly; it never drops anything.
- Does **not** load the embedding model. That happens on first use, so the
  service starts at ~205MB and passes its health check before paying the cost.
- Connects with a 10s timeout (`DB_CONNECT_TIMEOUT`). Without it a missing
  database makes startup hang on the TCP connect and uvicorn never binds its
  port, so the service looks dead rather than misconfigured.

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
