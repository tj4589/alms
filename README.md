# ExamMind

## Windows Local Dev

Run the app from three terminals.

Terminal 1 - database:

```powershell
cd backend
docker compose up -d
```

Terminal 2 - backend:

```powershell
cd backend
python init_db.py
python migrate.py
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Terminal 3 - frontend:

```powershell
cd frontend
npm run dev
```

Open:

- Frontend: http://localhost:5173
- Backend docs: http://127.0.0.1:8001/docs

## Environment

Backend local defaults live in `backend/.env.example`. For Windows local dev, prefer:

```env
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8001
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Frontend local defaults live in `frontend/.env.example`. The frontend should point at the running backend:

```env
VITE_API_BASE_URL=http://127.0.0.1:8001
```

## Troubleshooting

- If FastAPI fails with `WinError 10013` on port `8000`, use port `8001`.
- If the frontend says it cannot connect, check `frontend/.env` and confirm `VITE_API_BASE_URL` matches the backend URL.
- If the database connection fails, run `docker compose up -d` inside `backend`.
- If AI is not configured, auth, groups, rooms, uploads, and keyword search can still run, but AI answers may fail.
- If `fastembed` is missing, semantic search is disabled and keyword search fallback remains available. Install backend requirements to enable local embeddings.
