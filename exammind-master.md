# ExamMind — Full Project Master Document

> AI-Based Learning Management System with Past Question Intelligence  
> Final Year Project Reference · All decisions, logic, architecture, and action items in one place

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [The Core Idea](#2-the-core-idea)
3. [What Makes This Different](#3-what-makes-this-different)
4. [Refined Aim and Objectives](#4-refined-aim-and-objectives)
5. [How the System Works — Full Logic](#5-how-the-system-works--full-logic)
6. [Upload Pipeline — Detailed Flow](#6-upload-pipeline--detailed-flow)
7. [The AI Query Flow — Dual Search](#7-the-ai-query-flow--dual-search)
8. [Database Architecture](#8-database-architecture)
9. [Tech Stack](#9-tech-stack)
10. [Screen-by-Screen UI Guide](#10-screen-by-screen-ui-guide)
11. [Current Build State](#11-current-build-state)
12. [What Still Needs to Be Built](#12-what-still-needs-to-be-built)
13. [Dissertation Chapter Guide](#13-dissertation-chapter-guide)
14. [Evaluation Plan](#14-evaluation-plan)
15. [Data Collection Plan](#15-data-collection-plan)
16. [Full Action Plan by Week](#16-full-action-plan-by-week)
17. [The Antigravity Spec Message](#17-the-antigravity-spec-message)
18. [Key Decisions Made and Why](#18-key-decisions-made-and-why)

---

## 1. Project Identity

| Field | Detail |
|---|---|
| **Name** | ExamMind |
| **Type** | AI-powered Learning Management System |
| **Context** | Nigerian university environment |
| **Primary users** | Students — uploaders, learners, collaborators |
| **Secondary users** | Lecturers — read-only analytics only |
| **Core differentiator** | Past examination questions as the AI's primary knowledge base |
| **Frontend** | React + TypeScript + Vite |
| **Backend** | Python + FastAPI + PostgreSQL + pgvector + LangChain |
| **AI** | OpenAI GPT-4o + text-embedding-3-small |
| **UI reference file** | exammind-v2.html |

---

## 2. The Core Idea

Students in Nigerian universities already share past questions informally through WhatsApp groups, Telegram channels, and course rep folders. This behaviour exists because students know that past questions are the most direct signal of what gets examined.

ExamMind formalises this behaviour with AI on top. It takes the informal, unstructured sharing that already happens and turns it into a structured, searchable, AI-powered knowledge base. The system does not replace how students study — it improves the infrastructure around what they already do.

**In one sentence:** A student doesn't just learn a topic — they learn it the way it has historically been examined in their specific department.

---

## 3. What Makes This Different

Every existing LMS (Moodle, Canvas, Blackboard, Google Classroom) is passive — it stores content and lets students access it. None have any awareness of examination history.

| Feature | Existing LMS | ExamMind |
|---|---|---|
| Content storage | Passive upload by lecturers | Community-driven by students, AI-indexed |
| Search | Keyword only | Semantic vector search |
| AI awareness | None | Grounded in past questions + lecture notes |
| Exam intelligence | None | Pattern analytics, frequency heatmap, prediction |
| Student feedback | Generic grades | Per-topic readiness score |
| Collaboration | Generic forum | Threads anchored to specific past questions |
| Missing content | Silent gap | Explicit honest prompt to upload |
| Lecturer role | Admin and uploader | Read-only analytics only |
| Content quality | Lecturer-controlled | AI pre-screening + passive community verification |

**The academic novelty claim:** No existing educational AI system uses past examination questions as the grounding knowledge base for a RAG pipeline while simultaneously tracking community-verified upload quality and cohort-level learning analytics in a developing-country university context.

---

## 4. Refined Aim and Objectives

### Aim

To design and implement an AI-powered learning management system that leverages past examination questions and lecture notes — uploaded and community-verified by students — as a structured knowledge base, enabling exam-intelligent academic resource access, adaptive study support, and meaningful student collaboration.

---

### Objective 1 — Literature Review and Requirements

Investigate existing learning management systems and AI-assisted educational platforms, conduct a comparative gap analysis identifying the absence of exam-intelligence features, and produce a formal Software Requirements Specification (SRS) covering functional and non-functional system requirements.

---

### Objective 2 — Data Preparation and Ingestion Pipeline

Collect, clean, and process past examination questions and academic materials through an AI-powered upload pipeline that automatically extracts document metadata (course code, title, year, semester, department, faculty), detects duplicate submissions, classifies document type, chunks content, and indexes vector embeddings into a PostgreSQL pgvector database using a Retrieval-Augmented Generation (RAG) architecture.

---

### Objective 3 — System Design

Design the system architecture, role-based user interfaces for students, lecturers, and administrators, and the complete database schema including the course registry, past questions table, lecture notes table, question chunks table with vector embeddings, user profile and contribution tables, and the passive community verification model.

---

### Objective 4 — Implementation

Implement the AI engine — semantic dual search across past questions and lecture notes, RAG-grounded contextual explanations with cited references, exam pattern analytics, AI-generated practice questions in real exam style, and post-test debrief with readiness score — as well as the collaboration layer including discussion threads anchored to past questions, @AI participation in threads, and study groups.

---

### Objective 5 — Evaluation

Evaluate the system's performance, usability, and academic effectiveness through AI response quality benchmarks, structured usability testing sessions with student participants using the System Usability Scale (SUS), task-based observation, and a pre/post knowledge assessment measuring readiness score improvement over time.

---

## 5. How the System Works — Full Logic

### Users and Roles

**Students** — primary users. Upload documents, search past questions, use the AI assistant, take practice tests, and collaborate in threads.

**Lecturers** — read-only. See a dashboard showing cohort performance, weakest topics, most-queried questions, and AI-generated teaching recommendations. They do not upload anything. The system works perfectly without any lecturer interaction — the dashboard is a bonus for engaged lecturers, not a dependency.

**Administrators** — manage the course registry, review flagged uploads, and monitor system health.

---

### The Knowledge Base

Two document types form the AI's knowledge base:

1. **Past examination questions** — PDFs of actual exam papers from any year
2. **Lecture notes** — PDFs of course notes, slide decks, handouts

Both are uploaded exclusively by students. Both go through the same intelligent ingestion pipeline. Both are stored with course metadata attached. Both are searchable by the AI simultaneously when a student asks any question.

---

### The Content Quality Model

Content enters the system immediately — students do not wait for approval. Quality improves passively over time through three layers:

1. **AI pre-screening (instant)** — structural and semantic check before indexing. Fails clearly with a reason.
2. **Duplicate detection (instant)** — same course + year + semester + type = blocked. Student is pointed to the existing document.
3. **Passive community verification (background)** — students tap confirm or flag while browsing. Enough confirms upgrades status to verified. Enough flags sends it to admin review queue.

This is the Wikipedia model — fast entry, passive quality improvement, no gatekeeping that blocks the student experience.

---

### The Course Registry

Every course in the university is seeded once into the course registry database. Students never create courses — they only match to existing ones. The AI reads the course code from the uploaded document and matches it automatically. This prevents typos, duplicate phantom courses, and naming inconsistencies like "CSC301" vs "CSC 301" vs "csc301".

---

## 6. Upload Pipeline — Detailed Flow

This is the most important technical feature in the system. Every other AI feature depends on this working correctly.

### Step 1 — Student drops a PDF

No form. No dropdowns. Just a file. The student drags and drops any PDF onto the upload screen.

### Step 2 — AI pre-screen (under 3 seconds)

The backend runs an immediate check before anything is stored:
- Does the document look like an exam paper or lecture notes? (structural heuristics — question numbering, marks allocation, time limit, course header)
- Is the file readable and parseable?

If it fails, the student is told immediately with a plain-English reason. Nothing enters the database.

### Step 3 — AI metadata extraction

An LLM call (separate from the RAG pipeline — fast and cheap, runs once per upload) reads the document and returns structured JSON:

```json
{
  "document_type": "past_question",
  "course_code": "CSC 301",
  "course_title": "Data Structures & Algorithms",
  "year": 2023,
  "semester": "First",
  "department": "Computer Science",
  "faculty": "Faculty of Computing & Information Sciences",
  "topics_covered": ["sorting", "graph theory", "trees", "hashing"]
}
```

### Step 4 — Duplicate check

Before indexing, the system checks the database:
- Does a document with the same `document_type + course_code + year + semester` already exist?
- **If YES** → return the existing document ID and URL. Tell the student it already exists. Point them to it. Do not index. No duplicate enters the system.
- **If NO** → proceed.

### Step 5 — Student confirms metadata

The AI-extracted metadata is shown to the student in a clean confirmation screen. They review it and confirm. If anything looks wrong, they edit just the incorrect field. The system does not ask them to fill in a full form — only correct what the AI got wrong.

### Step 6 — Chunk, embed, index

Once confirmed:
- Document is chunked into semantically meaningful pieces
- Each chunk is embedded using OpenAI text-embedding-3-small
- Chunks stored in pgvector with all metadata as tags: `course_id`, `document_type`, `year`, `semester`, `topic_tags`
- Document record stored in relational database with `verified_status: unverified`

### Step 7 — Available immediately

The document is live the moment indexing completes. Other students can find it in search results. The AI can retrieve it in responses. The `unverified` tag is visible but does not block access.

---

## 7. The AI Query Flow — Dual Search

When a student asks anything — "What is SDLC?" — the system runs two simultaneous searches.

### Search 1 — Past Questions

Vector similarity search over `past_question_chunks` table filtered by `course_id` if a course context is active. Returns the top semantically similar chunks with their source question's year, course, and difficulty.

### Search 2 — Lecture Notes

Vector similarity search over `lecture_note_chunks` table with the same query. Returns relevant sections from uploaded lecture notes.

### Response Construction

The LLM receives both sets of retrieved chunks and constructs a response that:
- Explains the topic clearly in its own words
- Cites specific past questions by year and course as inline reference cards
- References lecture note sections where available
- Flags honestly when either source is missing

### Honest Missing Content Behaviour

| Situation | What the AI says |
|---|---|
| Both found | Full explanation with cited past questions and note sections |
| Past questions found, no notes | Explanation from exam context + "No lecture notes on this topic yet. Be the first to upload." |
| Notes found, no past questions | Explanation from notes + "This topic hasn't appeared in any uploaded past questions yet." |
| Neither found | "I couldn't find past questions or lecture notes on this topic. Upload them and they'll be available to everyone instantly." |

**The AI never fabricates. Every gap is reported as an explicit invitation to contribute.**

This honest behaviour is a feature, not a limitation. It turns every knowledge gap into a community contribution moment.

---

## 8. Database Architecture

### Core Tables

**faculties**
```
id, name, short_code, university
```

**departments**
```
id, faculty_id (FK), name, code
```

**courses** ← the course registry, seeded once
```
id, department_id (FK), code, title, level, units
```

**users**
```
id, name, email, password_hash, role, department_id (FK),
year, contribution_score, created_at
```

**past_questions**
```
id, course_id (FK), uploaded_by (FK), year, semester,
file_url, verified_status, confidence_score, created_at
```

**lecture_notes**
```
id, course_id (FK), uploaded_by (FK), topic, file_url,
verified_status, created_at
```

**past_question_chunks** ← vector store
```
id, past_question_id (FK), course_id (FK), chunk_text,
embedding (vector), topic_tag, chunk_index
```

**lecture_note_chunks** ← vector store
```
id, lecture_note_id (FK), course_id (FK), chunk_text,
embedding (vector), topic_tag, chunk_index
```

**verifications**
```
id, document_id, document_type, user_id (FK),
action (confirm/flag), created_at
```

**practice_attempts**
```
id, user_id (FK), course_id (FK), topic, score,
total_questions, completed_at, debrief_generated
```

**discussion_threads**
```
id, title, created_by (FK), past_question_id (FK nullable),
course_id (FK), created_at
```

**thread_messages**
```
id, thread_id (FK), user_id (FK nullable — null if AI),
content, is_ai_response, created_at
```

---

### Key Architectural Decisions

- `course_id` lives on both the document table AND each chunk table — enables fast filtered vector search by course without scanning the full index
- `verified_status` is updated passively by the verifications table — no manual moderation for normal content flow
- `contribution_score` on users increments when their uploads are confirmed — powers the reputation/gamification layer
- Two separate chunk tables (past questions / lecture notes) keep RAG retrieval clean and allow independent expansion of each document type
- The course registry is pre-seeded — students select, never create, preventing naming inconsistencies permanently

---

## 9. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Component-based, fast dev, type safety |
| Styling | Vanilla CSS with design tokens | Full control, no dependency overhead |
| Backend | Python + FastAPI | Fast async, excellent ML library ecosystem |
| ORM | SQLAlchemy | Mature, works seamlessly with pgvector |
| Database | PostgreSQL + pgvector | Vector store inside the main DB — no separate Pinecone needed |
| RAG pipeline | LangChain | Handles chunking, embedding, retrieval orchestration |
| LLM | OpenAI GPT-4o | Best quality for metadata extraction and explanations |
| Embeddings | OpenAI text-embedding-3-small | Fast, cheap, high quality |
| File storage | AWS S3 or Cloudinary | PDF storage with CDN delivery |
| Auth | JWT with role-based guards | Student / Lecturer / Admin separation |
| Deployment | Docker Compose | Consistent environment, easy to reproduce |

---

### Core API Endpoints

```
POST   /auth/register
POST   /auth/login

POST   /ingest/upload              AI metadata extraction + duplicate check + index
GET    /ingest/check-duplicate     Pre-check before full upload

POST   /rag/ask                    Dual search — past questions + lecture notes

GET    /courses                    Course registry lookup
GET    /past-questions             List with filters (course, year, topic, difficulty)
GET    /lecture-notes              List with filters
POST   /verify/:document_id        Confirm or flag a document

GET    /analytics/cohort           Lecturer dashboard data
GET    /analytics/student/:id      Individual readiness score and history

POST   /practice/generate          AI generates practice test from past questions
POST   /practice/submit            Submit answers + trigger debrief generation

GET    /threads                    Collaboration threads
POST   /threads/:id/message        Post message + detect @AI + trigger AI response
```

---

## 10. Screen-by-Screen UI Guide

The UI reference file is `exammind-v2.html`. All screens are fully interactive. Navigate using the sidebar.

---

### Dashboard

The home screen. What it shows:

- **Greeting** — personalised and contextual. References topics needing attention before the next exam, not a generic "welcome back"
- **Exam countdown hero** — the dominant element on the page. Gold border, radial glow. Shows next exam name, course code, faculty, and a live countdown in monospace — days, hours, minutes. Has a "Start practice" CTA that takes the student directly to the practice screen. This is the first thing a student sees and the thing that creates urgency
- **4 stat cards in a row** — Questions Reviewed (gold), Practice Avg Score (teal), Topics Mastered (coral), AI Sessions Today (purple). Each shows a momentum delta below the number so the student sees direction, not just a static figure
- **High-frequency questions list** — the four past questions most statistically likely to appear in the next exam. Each shows year badge, difficulty tag, course code, appearance count, and a frequency bar. Clicking "Ask AI →" loads that question as context in the assistant
- **Topic readiness progress bars** — per-topic completion colour coded: teal (strong), gold (in progress), coral (danger zone). Shows the student their weakest areas at a glance
- **Weekly activity bar chart** — study sessions across 7 days. Today's bar highlighted gold

---

### Past Questions

The full past question browser. What it shows:

- **Topic frequency heatmap as a full-width hero** — 8 topic tiles in a 4x2 grid. Colour intensity encodes exam weight — darkest gold for most frequent, faintest for least. Clicking any tile filters the question list below instantly and shows a filter label. This is the visual-first navigation — browse by topic, not by scrolling a list
- **Course filter pills** — filter by course code. Active pill is solid gold background
- **Question cards** — each card has a 3px gold left border (the visual signal that this is exam-sourced content), the question text at readable size, difficulty tag, year badge in monospace, course code and appearance count, and an "Ask AI →" button flush right. Hovering lifts the border colour

---

### Upload

The document upload screen. Five interactive states that you can click through in the UI file:

**State 1 — Idle**
- Large drag-and-drop zone with instructions
- "What the AI reads automatically" card showing all 6 extracted fields with icons
- Recent uploads list showing document name, type, date, and verified/unverified badge
- Upload guidelines card (what's allowed, what's not)

**State 2 — Processing**
- 4-step animated progress tracker: Document received → AI reading document → Duplicate check → Chunking and embedding
- File name and size shown at top
- "This usually takes under 10 seconds"

**State 3 — Confirm Metadata**
- Clean grid showing all AI-extracted fields: document type, course code, title, year, semester, department, faculty, topics detected as chips
- Note telling student to edit any wrong field before confirming
- "Confirm and index" button + "Cancel" ghost button

**State 4 — Duplicate Detected**
- Coral icon and heading: "This already exists"
- Shows the existing document — course, year, who uploaded it, how many confirmations, how many chunks indexed
- Two actions: "View existing document" / "Upload different file"
- No duplicate enters the system

**State 5 — Success**
- Teal success animation
- Summary: course, type, year, chunks indexed
- Two actions: "View in Past Questions" / "Upload another"

---

### AI Assistant

Split layout — chat panel takes two-thirds, context panel takes one-third.

**Chat panel:**
- Header with pulsing teal live dot and subtitle: "Searching 847 past questions + uploaded notes"
- AI responses include inline past question reference cards — not just text mentions. Each card shows year, course, truncated question text, and difficulty tag. Tappable to view full question
- Source citations appear as teal pills inline in the text
- When lecture notes are missing the AI states this explicitly in the response text

**Context panel (right side):**
- When lecture notes are missing for the queried topic: coral "No lecture notes found" card with an upload button pre-labelled with the course name
- Related past questions card showing the 3 most relevant questions to what's being discussed
- "View all N related questions" ghost button

**Input area:**
- Text field that glows gold on focus
- Gold send button

---

### Practice Tests

Left column — test generator:
- Course dropdown (from course registry)
- Topic dropdown (topics from that course based on indexed content)
- Question count slider with live number display
- "Generate test" full-width gold button

Right column:
- Recent attempts with scores in colour (teal = good, gold = okay, coral = danger)
- AI smart suggestion card recommending next topic based on score history and exam frequency

---

### Exam Analytics

- 3 headline stat cards: total questions indexed, courses covered, highest-yield topic cluster percentage
- Topic frequency horizontal bar chart — colour coded by priority tier (gold top two, teal next, purple middle, coral lowest)
- Difficulty split chart with an actionable plain-English note below it
- AI prediction card with serif heading naming the most likely exam topic, plain-English justification, and CTA to practice

---

### Collaboration

- Active discussion threads each anchored to a specific past question shown as a gold labelled link below each message
- Poster avatar, name, time, and message text
- @AI explainer card showing how to invoke the AI in any thread
- Study groups with member count, status, and join button

---

### Lecturer Analytics (read-only)

- 4 stat cards: Active Students, Avg Practice Score, Questions Attempted, Notes Uploaded
- Students at Risk list — students with low engagement scores, last active dates, current accuracy
- Most Challenging Topics — horizontal accuracy bars per topic with an AI recommendation at the bottom linking exam frequency to poor student accuracy
- **No upload buttons anywhere on this screen. Lecturers cannot add content.**

---

### Empty State

Shown when a course has no uploaded content yet. Contains:
- Gold icon
- Serif heading: "Be the first to contribute" — "first" in italic gold
- Clear explanation that uploading makes the document instantly available to every student in the department
- Two CTAs side by side: "Upload past question" (gold) / "Upload lecture notes" (ghost)

---

## 11. Current Build State

As of the last Antigravity project update:

### Built and working

- Full frontend UI across all main screens (React + TypeScript + Vite)
- FastAPI backend with SQLAlchemy + PostgreSQL + pgvector
- **Working RAG pipeline** — genuine semantic search over past questions, not a generic chatbot
- AI retrieves top 5 semantically similar past questions and cites them in its response
- Lecturer analytics screen — read-only, correctly scoped
- Docker Compose environment
- JWT authentication

### Partially built

- Basic ingest endpoint (`/ingest/past-questions`) — chunks and embeds PDF but does NOT extract metadata automatically and does NOT detect duplicates
- No frontend upload screen exists yet

### Not yet built

- AI metadata extraction from uploaded documents
- Duplicate detection logic
- Student-facing upload screen (all 5 states)
- Lecture notes database table and embedding pipeline
- Dual search (past questions + lecture notes simultaneously)
- "No lecture notes found" response flag and frontend upload prompt
- Analytics screen
- Collaboration threads
- Practice test debrief and readiness score
- Passive community verification (confirm/flag)
- Empty state screen

---

## 12. What Still Needs to Be Built

Ordered strictly by priority for MVP submission.

### Priority 1 — Upload pipeline (unblock everything else)

- Backend: LLM metadata extraction returning structured JSON
- Backend: Duplicate detection before indexing
- Backend: Strip upload permissions from lecturer role entirely
- Frontend: Upload screen — all 5 states (idle, processing, confirm, duplicate, success)

### Priority 2 — Lecture notes and dual search

- Database: `lecture_notes` table and `lecture_note_chunks` table
- Backend: Same ingestion pipeline applied to lecture notes
- Backend: Expand `/rag/ask` to search both tables simultaneously
- Backend: Return `no_lecture_notes_found: true` flag when notes search is empty
- Frontend: AI assistant right panel shows upload prompt when flag is true

### Priority 3 — Design alignment

- Remove all gradient card backgrounds and glassmorphism effects
- Align all screens to flat dark surface design from `exammind-v2.html`
- Confirm mobile responsive layout with bottom tab nav working

### Priority 4 — Missing screens

- Analytics screen (frontend connected to backend)
- Collaboration threads (frontend + backend)
- Empty state screen (triggered when course has no uploads)

### Priority 5 — Evaluation features (needed for dissertation Obj 5)

- Practice test debrief (AI explains each wrong answer after test completion)
- Readiness score tracker — percentage per student per course, updated after each practice
- Passive verification buttons (confirm/flag) on document cards in Past Questions screen

---

## 13. Dissertation Chapter Guide

Write chapters in parallel with the build. Do not wait for the system to be finished before writing.

---

### Chapter 1 — Introduction (write today)

Cover these four things in order:

1. **The problem** — students in Nigerian universities lack structured, exam-aware study support. Past questions circulate informally through WhatsApp and Telegram because students know exam history is the most useful signal for preparation. This informal system is unstructured, unsearchable, and has no AI layer.

2. **What exists** — LMS platforms like Moodle, Canvas, and Blackboard store content passively. They have no exam intelligence. None of them use past questions as an AI knowledge base. None of them surface what actually gets examined.

3. **The gap** — no existing system formalises the informal past question sharing behaviour of students with AI-powered retrieval, exam pattern analytics, and community verification. This is the gap ExamMind fills.

4. **Your proposal** — ExamMind: a community-driven AI-powered LMS where students upload past questions and lecture notes, the AI screens and indexes them automatically, and every AI response is grounded in real examination history from that specific department.

Then briefly outline the five objectives and the dissertation structure.

---

### Chapter 2 — Literature Review

Cover these areas. Find at least 2 cited papers per area.

**Learning Management Systems**
- History and current landscape: Moodle, Canvas, Blackboard
- Limitations of existing platforms in developing-country contexts
- Lecturer-to-student ratio challenges in Nigerian universities (often 1:200 or higher)

**Retrieval-Augmented Generation (RAG)**
- How RAG works — retrieval + generation pipeline
- RAG vs fine-tuning — why RAG is correct for this use case (past questions change every year; fine-tuning would freeze the knowledge base)
- Educational applications of RAG in recent literature

**Adaptive Learning Systems**
- Personalised learning paths
- Readiness scoring and formative assessment
- Feedback loops in educational AI

**Community Knowledge Platforms**
- Stack Overflow's reputation and verification model — cite as precedent for contribution scoring
- Wikipedia's open contribution model — cite as precedent for fast-entry passive quality improvement
- How community quality control scales without central moderation

**Learning Analytics**
- Cohort-level analytics for educators
- At-risk student identification through engagement signals
- Vygotsky's Zone of Proximal Development — cite for the @AI collaboration feature (AI as "more knowledgeable other")

**EdTech in Africa and Developing Contexts**
- Infrastructure challenges: connectivity, device constraints, data costs
- Mobile-first design requirements for African university students
- Offline capability as a research gap — almost no existing tool addresses this

---

### Chapter 3 — Methodology and System Design

Cover:

- System architecture overview with a layered diagram
- The upload pipeline — full flow with every decision point
- Why RAG over fine-tuning (knowledge updates without retraining)
- The dual search architecture — why two simultaneous searches, how results are merged
- Database schema and key design decisions (course registry, two chunk tables, course_id on chunks)
- The passive verification model and why it was chosen over gated peer approval
- Role-based access design — why lecturers are read-only
- The course registry design and why students don't create courses
- UI/UX design decisions: flat dark aesthetic, gold accent system, mobile bottom tab nav, empty state as contribution prompt

**Key argument to make:** The phased MVP approach — RAG foundation first, intelligent ingestion second — was a deliberate architectural decision, not incomplete work. Proving the RAG pipeline before building the ingestion layer is the correct engineering sequence.

---

### Chapter 4 — Implementation

Cover:

- Tech stack decisions with justification for each choice
- FastAPI + pgvector combination — why no separate vector database was needed
- LangChain RAG pipeline implementation details
- The metadata extraction LLM call — prompt design, JSON output format, error handling, confidence scoring
- Duplicate detection logic — how the query works, what fields are compared
- Frontend component architecture — how screens map to React components
- Challenges encountered and how they were resolved

Include code snippets for:
- The metadata extraction LLM prompt
- The duplicate check database query
- The dual search RAG endpoint
- The chunk embedding and storage pipeline

---

### Chapter 5 — Evaluation

Cover:

- Evaluation methodology overview — why these three instruments were chosen
- System performance benchmarks: AI response latency, embedding accuracy, duplicate detection accuracy
- Usability testing: SUS scores from N participants, what they mean, how ExamMind compares to the 68-point average
- Task-based observation findings: which tasks caused confusion, what was easy, time-on-task measurements
- Pre/post knowledge assessment results: did readiness scores improve after using ExamMind? By how much?
- AI response quality assessment: citation accuracy, missing-content flag accuracy, response relevance
- Limitations: scan quality affecting extraction, cold-start problem for new courses, lecturer non-engagement

---

### Chapter 6 — Conclusion

Cover:

- Summary of what was achieved against each objective
- Novel contributions: exam-intelligence RAG grounding, community-driven upload pipeline, honest missing-content behaviour, cohort analytics without lecturer dependency
- Limitations of the current system
- Future work: offline mode with downloadable topic bundles, @AI in collaboration threads, native mobile app, multi-university expansion, lecturer annotation of model answers

---

## 14. Evaluation Plan

### Instrument 1 — System Usability Scale (SUS)

10 standardised questions on a 5-point Likert scale. Widely cited, academically defensible, quick to administer.

Run with minimum 5 participants, ideally 10. All participants should be students from your department or a similar computing department.

**Scoring:** SUS score above 68 = above average usability. Target 70+.

---

### Instrument 2 — Task-Based Observation

Ask each participant to complete these tasks while you observe and record time taken and errors made:

1. Upload a past question PDF you provide (tests the upload pipeline)
2. Search for past questions on a specific topic using the heatmap
3. Ask the AI assistant "What is [topic]?" and identify a cited past question in the response
4. Complete a 5-question practice test and review the results
5. Find the exam analytics page and identify the highest-frequency topic

Record for each task: time to complete, number of errors, moments of visible confusion, verbal comments.

---

### Instrument 3 — Pre/Post Knowledge Assessment

**Before** participants use the system: give them a 5-question test on a topic covered in the uploaded past questions.

**After** 15 minutes of using ExamMind — searching, reading AI responses, reviewing past questions, taking a practice test: give them the same 5 questions.

**Measure:** did scores improve? By how much? This is your strongest quantitative finding. Even a small improvement across 10 participants is a meaningful result.

---

### Instrument 4 — AI Response Quality Assessment

For 10 different topic queries, manually assess AI responses against these criteria:

| Criterion | Scale |
|---|---|
| Relevance of retrieved past questions | 1–5 |
| Accuracy of explanation | 1–5 |
| Correctness of citations (year, course code) | 1–5 |
| Appropriate behaviour when content missing (flags vs fabricates) | Pass/Fail |

---

## 15. Data Collection Plan

Start collecting past question PDFs immediately — before the upload pipeline is even built. Have them ready the moment the pipeline is working.

### Target

- Minimum 3 courses
- Minimum 3 years per course (5 preferred for meaningful pattern analytics)
- Mix of past question papers and lecture notes

### Where to get them

- Your personal files from previous semesters
- Course representative WhatsApp and Telegram groups
- Classmates and department seniors
- Department notice board or departmental website
- University library

### Format guidance

PDFs are ideal. Scanned papers work if legible. Very low quality scans (blurry, rotated, handwritten) may reduce AI extraction accuracy — note this as a limitation in your evaluation chapter and quantify how often it occurred.

### File naming for your own organisation

```
[COURSE_CODE]_[TYPE]_[YEAR]_[SEMESTER].pdf

Examples:
CSC301_PQ_2023_First.pdf
CSC301_PQ_2022_First.pdf
CSC204_NOTES_Week3_SDLC.pdf
CSC205_PQ_2021_Second.pdf
```

---

## 16. Full Action Plan by Week

### Today — three actions only

- [ ] Send the Antigravity check-in message (in Section 17 below) with `exammind-v2.html` attached
- [ ] Open a document and write the Introduction chapter — 4 paragraphs, you already know what to write
- [ ] Start collecting past question PDFs from WhatsApp groups and your personal files

### Week 1

- [ ] Review Antigravity's plan and timeline for the upload pipeline before they start building
- [ ] Write the Literature Review chapter headings and identify 2 papers per section to read
- [ ] Collect and organise at least 30 past question PDFs across 3 courses
- [ ] Download and read the SUS questionnaire format — confirm you'll use it for evaluation

### Week 2

- [ ] Upload pipeline delivered by Antigravity — test it with real past question PDFs immediately
- [ ] Does AI correctly extract course code, year, semester, department without any manual input?
- [ ] Does it correctly detect a duplicate when you upload the same paper twice?
- [ ] Write the Methodology chapter first draft in parallel

### Week 3

- [ ] Dual search working — test with both past questions and lecture notes uploaded
- [ ] Ask the AI a topic question and confirm it searches both sources simultaneously
- [ ] Ask the AI a topic with no lecture notes uploaded — does it flag correctly and prompt upload?
- [ ] Recruit 5–10 student participants for usability testing

### Week 4

- [ ] Design alignment confirmed — no glassmorphism, all screens match `exammind-v2.html`
- [ ] All missing screens built (analytics, collaboration, empty state)
- [ ] Run usability testing sessions — SUS questionnaire + task observation + pre/post test
- [ ] Write Implementation chapter first draft

### Week 5–6

- [ ] Analyse evaluation results — SUS scores, task completion times, pre/post improvement scores
- [ ] Write Evaluation chapter with findings
- [ ] Write Conclusion chapter
- [ ] Full dissertation review and editing pass
- [ ] Confirm live deployed demo link exists and works for submission

---

## 17. The Antigravity Spec Message

Send this today. Attach `exammind-v2.html`.

---

Hey — the lecturer analytics screen looks great and the RAG foundation is solid. Here's what I need next.

**The upload pipeline is the core of everything. Let's build this now.**

**Frontend — Upload Screen**

- Drag-and-drop screen accessible to students only
- Accepts PDF files
- Five states that the student moves through:
  1. Idle — drop zone + "what the AI reads" explainer + recent uploads history
  2. Processing — 4-step animated tracker (received → AI reading → duplicate check → indexing)
  3. Confirm metadata — show AI-extracted fields, student edits any wrong field, then confirms
  4. Duplicate detected — coral alert, show existing document details, link to it, no upload
  5. Success — teal confirmation, summary of what was indexed, two CTAs

No manual form fields. The AI reads everything. Student only corrects what's wrong.

**Backend — Upload Pipeline**

- On PDF upload, run an LLM call (before chunking) to extract structured JSON: document_type, course_code, course_title, year, semester, department, faculty, topics_covered
- Run duplicate check: same document_type + course_code + year + semester = duplicate → return existing document ID and URL, block indexing
- If new: chunk, embed, store with all metadata tags on each chunk
- Strip all upload permissions from lecturer role — ingestion is students only
- Add LectureNotes table and lecture_note_chunks table with same pipeline
- Expand /rag/ask to search BOTH past_questions AND lecture_notes simultaneously
- If lecture notes search returns empty for a topic: return `no_lecture_notes_found: true` so the frontend can show the upload prompt in the AI assistant right panel

**Priority order:**
1. Backend metadata extraction + duplicate detection
2. Frontend upload screen (all 5 states)
3. LectureNotes table + embedding pipeline
4. Dual search in /rag/ask endpoint
5. Frontend "no lecture notes found" prompt in AI assistant

**Design:** Please remove all gradient card backgrounds. The attached HTML file is the design reference going forward. Flat dark surfaces, gold accents only, no blur or glassmorphism effects anywhere.

Please share your plan and timeline before starting so we can confirm we're aligned.

---

## 18. Key Decisions Made and Why

| Decision | What was decided | Why |
|---|---|---|
| Who uploads content | Students only, not lecturers | Lecturers in Nigerian universities are unlikely to consistently engage with an upload portal. Student-driven content matches real-world behaviour and creates a living community platform |
| Lecturer role | Read-only analytics only | The dashboard is a bonus for engaged lecturers, not a system dependency. Everything works without any lecturer logging in |
| Upload verification model | Instant indexing + passive community verification | Gated peer verification (waiting for 3 approvals) creates bad UX and abandonment. Wikipedia model is better — fast entry, passive quality improvement over time |
| Duplicate handling | AI detects and blocks at upload, points to existing | Prevents database pollution without manual moderation overhead |
| Vector database choice | pgvector inside PostgreSQL | Eliminates the need for a separate Pinecone or Weaviate instance, simplifies deployment and maintenance, sufficient for this scale |
| Missing content behaviour | AI explicitly flags, never fabricates | Honesty is a feature. Every gap reported is a community contribution prompt |
| Course registry | Pre-seeded, students select not create | Prevents typos, phantom courses, and inconsistent naming permanently |
| Glassmorphism | Rejected | Performs poorly on low-end Android devices common among Nigerian university students. Flat dark surfaces are faster and cleaner |
| Lecturer upload permissions | Stripped from backend | Earlier assumption was wrong. Corrected before too much was built on it |
| RAG vs fine-tuning | RAG | Past questions change every year. RAG allows continuous updates without retraining. Fine-tuning would freeze the knowledge base at a point in time |
| Two separate chunk tables | past_question_chunks and lecture_note_chunks | Enables clean filtered search per document type and allows independent expansion of each. Cleaner than a single chunks table with a type column at this design stage |
| Phased build approach | RAG foundation first, ingestion pipeline second | Correct engineering sequence — prove retrieval works before building the pipeline that feeds it |

---

*This document is the single source of truth for the ExamMind project. Update it as new decisions are made. Share it with Antigravity. Reference it when writing your dissertation.*
