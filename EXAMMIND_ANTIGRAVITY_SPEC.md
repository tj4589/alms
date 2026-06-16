# ExamMind — Final Student-Focused Build Specification

## Project Overview

ExamMind is a student-focused AI-powered academic knowledge retrieval and collaborative study system for authenticated university students.

The system uses:

- student-contributed past examination questions,
- lecture notes and academic materials,
- OCR cleanup and metadata extraction,
- semantic vector search,
- Retrieval-Augmented Generation (RAG),
- practice-question generation,
- progress tracking,
- study groups,
- discussion threads,
- reading rooms.

ExamMind is not a generic LMS. It is an exam-intelligent student study platform.

## Authentication

- Student registration
- Student login
- JWT-based authentication
- Secure student access to uploads, search, AI assistant, practice, progress, and collaboration tools

The implemented system supports authenticated student users only.

## Upload Pipeline

Students upload:

- past question PDFs
- lecture note PDFs

Upload flow:

1. Student uploads PDF.
2. Backend checks readability, document type signals, scan quality, and duplicate risk.
3. OCR text is cleaned before display and indexing.
4. Raw OCR is stored only for trace/debug views.
5. Metadata extraction identifies course code, course title, year/session, semester, department, faculty/college, topics, and document type.
6. Student confirms the cleaned metadata and structured preview.
7. Cleaned text is chunked and embedded.
8. Material becomes searchable immediately.

## AI Assistant

The RAG assistant:

- searches uploaded ExamMind materials,
- retrieves relevant chunks,
- answers from retrieved context,
- cites source names where possible,
- admits when uploaded material is missing,
- avoids raw provider errors.

DeepSeek is the primary LLM provider. Cohere is an optional fallback provider. Embeddings and search remain local.

## Search

Search should show one clean card per uploaded material, grouped by source document, with the best matching snippets underneath.

Search cards should use metadata titles first. If a title is missing, generate:

```text
<course_code> <course_title> <document_type> <academic_year>
```

## Practice

Practice generation should use uploaded academic materials where available. When there is not enough indexed content, the interface should explain the limitation clearly.

## Analytics and Progress

Student-facing analytics include:

- questions attempted,
- practice scores,
- topic readiness,
- study activity,
- examination analytics based on uploaded material and practice results.

## Collaboration

The collaboration layer includes:

- discussion threads for topic conversations,
- study groups for long-term group learning,
- reading rooms for live revision sessions,
- AI study cards generated from room context.

## Design Direction

- Clean student-focused interface
- No raw OCR/debug text in primary views
- Clear empty states
- Clean action buttons
- Mobile responsive
- Consistent visual language across upload, search, AI, practice, and collaboration

## MVP Build Order

1. Authentication and secure student access
2. Upload/OCR/indexing
3. Search and grouped snippets
4. RAG assistant
5. Practice generation
6. Progress and examination analytics
7. Discussion threads, study groups, and reading rooms
8. Final testing evidence for Chapter Four

## Academic Positioning

Project title:

“ExamMind: An AI-Powered Academic Knowledge Retrieval and Collaborative Study System for University Students.”

Core contribution:

Using student-contributed academic materials and historical examination questions as the grounding knowledge base for semantic search, RAG answers, practice generation, and collaborative study.
