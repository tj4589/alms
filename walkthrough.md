# ExamMind Walkthrough

## Project Overview

ExamMind is a student-focused AI-powered academic knowledge retrieval and collaborative study system. It helps authenticated university students upload academic materials, search them semantically, ask grounded AI questions, generate practice, track progress, and collaborate through study groups, discussion threads, and reading rooms.

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: FastAPI + SQLAlchemy
- Database: PostgreSQL + pgvector
- Embeddings: FastEmbed
- AI: DeepSeek primary with optional Cohere fallback
- Authentication: JWT-based student login

## Features

- Student registration and login
- Document upload for past questions and lecture notes
- OCR cleanup and structured content preview
- Duplicate detection and course linking
- Semantic search with clean grouped snippets
- RAG assistant grounded in uploaded ExamMind materials
- Practice-question generation from indexed materials
- Progress tracking and examination analytics
- Discussion threads
- Study groups
- Reading rooms for live revision sessions

## How To Run

1. Start the database:

```powershell
cd backend
docker compose up -d
```

2. Start the backend:

```powershell
cd backend
python init_db.py
python migrate.py
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

3. Start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Demo Flow

1. Register or log in as a student.
2. Upload a past-question PDF.
3. Confirm extracted metadata and structured preview.
4. Search for the course or topic.
5. Ask the AI assistant about the uploaded material.
6. Generate practice questions.
7. Open a study group or reading room from the same topic context.
