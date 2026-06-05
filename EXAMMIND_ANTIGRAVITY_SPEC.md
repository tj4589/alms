# ExamMind — Antigravity Build Specification

## Project Overview

ExamMind is an AI-powered learning intelligence platform designed for Nigerian universities.

The system uses:
- past examination questions,
- lecture notes,
- semantic vector search,
- and Retrieval-Augmented Generation (RAG)

to help students prepare for examinations using historically examinable content.

This is NOT a generic LMS.
This is an exam-intelligent academic platform.

---

# Core MVP Features (Priority)

## 1. Authentication
- Student login/register
- JWT authentication
- Role-based access:
  - Student
  - Lecturer (read-only analytics)
  - Admin

---

# 2. Upload Pipeline (Highest Priority)

Students upload:
- past question PDFs
- lecture note PDFs

## Upload Flow

### Step 1 — Drag & Drop Upload
Student uploads PDF.

### Step 2 — AI Pre-Screen
System checks:
- readability
- corruption
- likely document type
- scan quality

### Step 3 — Metadata Extraction
LLM extracts:
- course code
- course title
- year
- semester
- department
- faculty
- topics covered
- document type

Return structured JSON.

### Step 4 — Duplicate Detection
Duplicate condition:
same:
- course_code
- year
- semester
- document_type

If duplicate exists:
- stop indexing
- return existing document

### Step 5 — Student Confirmation
Student confirms or edits extracted metadata.

### Step 6 — Chunk + Embed
- semantic chunking
- embeddings using text-embedding-3-small
- store in PostgreSQL pgvector

### Step 7 — Instant Availability
Document becomes searchable immediately.

---

# 3. AI Assistant (RAG)

## AI Behaviour
The AI:
- searches uploaded content,
- retrieves relevant chunks,
- generates grounded responses,
- cites past questions,
- and never fabricates information.

## Dual Search
Search:
1. Past questions
2. Lecture notes

simultaneously.

## Missing Content Behaviour

If lecture notes are missing:
Return:
`no_lecture_notes_found: true`

Frontend displays:
“Be the first to upload lecture notes for this topic.”

---

# 4. Past Question Browser

Students can:
- search questions
- filter by:
  - course
  - year
  - topic
  - difficulty

## Heatmap
Topic frequency visualization:
- highest recurring topics
- most examinable concepts

---

# 5. Practice Test Generator

AI generates:
- exam-style questions
- based on:
  - topic frequency
  - historical patterns
  - difficulty balancing

After submission:
- generate score
- generate AI debrief
- update readiness score

---

# 6. Analytics

## Student Analytics
- readiness score
- weak topics
- study activity
- topic mastery

## Lecturer Analytics
Read-only:
- weakest cohort topics
- average scores
- difficult concepts
- engagement trends

No upload permissions for lecturers.

---

# Database Design

## Core Tables

### users
### courses
### departments
### faculties
### past_questions
### lecture_notes
### past_question_chunks
### lecture_note_chunks
### practice_attempts
### readiness_scores
### discussion_threads
### thread_messages

---

# Recommended Tech Stack

## Frontend
- React
- TypeScript
- Vite

## Backend
- FastAPI
- SQLAlchemy

## Database
- PostgreSQL
- pgvector

## AI
- OpenAI GPT-4o
- text-embedding-3-small

## RAG
- LangChain

---

# UI/UX Direction

Design reference:
exammind-v2.html

## Design Rules
- Flat dark surfaces
- Gold accent system
- No glassmorphism
- No heavy gradients
- Mobile responsive
- Fast loading

---

# MVP Build Order

## Phase 1
- authentication
- upload pipeline
- chunking
- embeddings
- duplicate detection

## Phase 2
- RAG assistant
- dual search
- lecture notes support

## Phase 3
- past question browser
- practice generator
- analytics

## Phase 4
- collaboration
- contribution system
- advanced AI features

---

# Important Architectural Rules

## Students upload content
Lecturers do NOT upload.

## AI never fabricates
Missing information must be reported honestly.

## Course registry is seeded
Students select courses.
They do not create courses.

## pgvector inside PostgreSQL
No Pinecone required.

---

# Academic Positioning

Project title:

“An AI-Powered Exam Intelligence and Adaptive Learning Platform for Nigerian Universities.”

Core contribution:
Using historical examination questions as the grounding knowledge base for an educational RAG pipeline.

---

# Final Notes

This is a FINAL YEAR PROJECT MVP.

Focus on:
- strong architecture,
- solid upload pipeline,
- working RAG,
- intelligent retrieval,
- and meaningful analytics.

Avoid overbuilding unnecessary startup-scale features.
