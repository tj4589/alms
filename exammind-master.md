# ExamMind — Final Project Master Document

> Student-focused AI-powered academic knowledge retrieval and collaborative study system  
> Final year project reference for scope, architecture, testing, and defense.

## Project Identity

| Field | Detail |
|---|---|
| Name | ExamMind |
| Type | AI-powered academic knowledge retrieval and collaborative study system |
| Primary users | Authenticated university student users |
| Access model | JWT-based authentication for secure student access |
| Core knowledge base | Student-contributed past questions, lecture notes, and academic materials |
| Core AI features | Semantic search, RAG assistant, practice-question generation, examination analytics |
| Collaboration features | Study groups, discussion threads, reading rooms |
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI + SQLAlchemy + PostgreSQL + pgvector |
| Local embeddings | FastEmbed |
| LLM providers | DeepSeek primary with optional Cohere fallback |

## Final Scope

ExamMind is built for authenticated student users only. The implemented system does not include separate staff users, staff dashboards, separate management dashboards, or permission-separated interfaces. Authentication is used to protect student accounts and student data, not to present separate user-category products.

The final project scope is:

- Student registration and login through JWT-based authentication
- Student dashboard for study activity and academic progress
- Document upload for past questions and lecture notes
- OCR cleanup, metadata extraction, duplicate detection, and indexing
- Semantic search over uploaded academic materials
- RAG assistant grounded in uploaded ExamMind materials
- Practice-question generation from uploaded content
- Progress tracking and examination analytics
- Discussion threads, study groups, and reading rooms
- Privacy controls such as authenticated access and hidden raw OCR/debug text

## Aim

To design and implement a student-focused AI-powered academic knowledge retrieval and collaborative study system that uses student-contributed academic materials as a searchable knowledge base for examination preparation, practice generation, progress tracking, and collaborative learning.

## Objectives

1. Investigate academic resource access challenges faced by university students and identify the need for exam-aware retrieval support.
2. Design a secure student-focused system architecture with JWT-based authentication, document ingestion, semantic search, RAG assistance, and collaborative study tools.
3. Implement an OCR and upload pipeline that extracts metadata, cleans text, detects duplicates, stores raw text for traceability, and indexes cleaned academic content.
4. Implement semantic search, RAG answers, practice generation, progress tracking, study groups, discussion threads, and reading rooms for authenticated student users.
5. Evaluate the system through functional testing, upload/OCR testing, search testing, AI assistant testing, practice testing, collaboration testing, privacy testing, and final-year project defense evidence.

## System Logic

Students upload academic documents such as past questions and lecture notes. The backend extracts text, cleans OCR noise, infers metadata, checks duplicates, links or creates course records, chunks cleaned text, creates embeddings, and stores searchable material records.

When a student searches or asks the RAG assistant a question, ExamMind retrieves relevant chunks from uploaded materials and generates a grounded answer. The assistant cites source names where available and clearly states when relevant uploaded content is missing.

Practice generation uses uploaded past-question content where possible. If there is not enough material, the interface explains the gap instead of pretending a strong practice set exists.

The collaboration layer lets students create discussion threads, form study groups, and start reading rooms around a course, topic, or uploaded material. Reading rooms act as live revision rooms with room context, linked materials, chat, participants, and AI-generated study cards.

## Upload Pipeline

1. Student uploads a PDF.
2. Backend extracts embedded text and/or OCR text.
3. Raw OCR is stored as debug/trace text.
4. Cleaned text is produced for previews, search snippets, chunking, embeddings, and RAG retrieval.
5. Heuristic metadata extraction runs first for reliable document headers.
6. AI metadata extraction may enrich topics and summaries, but must not overwrite reliable heuristic header fields.
7. Duplicate detection checks source file, title, course, year, semester, and document type.
8. The student sees a clean confirmation preview with document type, course, session, semester, topics, confidence, and structured content preview.
9. Raw OCR is available only behind a manual debug view.
10. Confirmed documents are indexed and become searchable.

## Core Data Model

- `users`: authenticated student accounts
- `courses`: course records linked to uploaded material
- `past_questions`: uploaded past-question material
- `lecture_notes`: uploaded note material
- `lecture_note_chunks`: searchable chunks for lecture notes
- `practice_attempts`: generated practice and student scores
- `readiness_scores`: progress tracking
- `discussion_threads`: student topic conversations
- `thread_messages`: discussion and AI replies
- `study_groups`: long-term student study groups
- `study_sessions`: reading rooms/live revision sessions

## API Surface

```text
POST   /auth/register
POST   /auth/login
GET    /auth/me

POST   /ingest/upload
DELETE /ingest/documents
DELETE /ingest/clear-materials

GET    /courses
GET    /past-questions
GET    /lecture-notes
POST   /search
POST   /rag/ask

POST   /practice/generate
POST   /practice/submit

GET    /threads
POST   /threads
POST   /threads/{id}/message

GET    /study-groups
POST   /study-groups
GET    /study-sessions
POST   /study-sessions
```

## Student Interface

- Dashboard: study summary, recent activity, progress signals
- Upload: document upload, OCR preview, metadata confirmation, clear test uploads
- Search: grouped material cards with clean snippets and contextual actions
- AI Assistant: RAG answers using uploaded ExamMind materials
- Practice: generated questions and explanations from indexed materials
- Progress: readiness and activity tracking
- Collaboration: discussion threads for topic conversations
- Study Groups: long-term groups around courses/topics
- Reading Rooms: live revision rooms with linked material context and AI study board

## Evaluation Plan

Chapter Four evidence should include:

- Authentication tests
- Upload/OCR tests
- Metadata extraction tests
- Duplicate detection tests
- Search tests
- AI Assistant/RAG tests
- Practice generation tests
- Study collaboration tests
- Study group tests
- Reading room tests
- Privacy tests
- Analytics/progress tests
- Error handling tests

Each test should record test ID, module, scenario, input, expected result, actual result, status, and screenshot placeholder.

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Student-only access | Keeps the final year project focused, testable, and aligned with student study workflows |
| JWT-based authentication | Protects student accounts and private study activity |
| Student-contributed archive | Matches how academic materials already circulate among students |
| Cleaned OCR for indexing | Prevents noisy scanned text from reducing preview, search, and RAG quality |
| Raw OCR hidden by default | Keeps the main interface confidence-building while preserving traceability |
| RAG over fine-tuning | Uploaded academic content changes often and should be searchable immediately |
| DeepSeek with Cohere fallback | Improves AI availability without changing the knowledge base |
| pgvector/FastEmbed search | Keeps semantic retrieval local and tied to the main database |
| Reading rooms | Makes revision collaborative and contextual to a course/topic |

## Future Work

Future work may include native mobile packaging, offline topic bundles, richer analytics visualizations, multi-university configuration, improved OCR model options, and stronger privacy controls. These are not required for the implemented final scope.

## Defense Positioning

ExamMind should be presented as a secure student-focused academic archive and AI study companion. The strongest demonstration flow is:

1. Student logs in.
2. Student uploads a past question.
3. ExamMind cleans OCR and extracts metadata.
4. Search finds the uploaded material with clean grouped snippets.
5. RAG assistant answers from the uploaded source.
6. Practice generation uses the indexed material.
7. Student opens a study group or reading room from the same course/topic context.
