# AI-LMS Platform Walkthrough

## Project Overview
The AI-Based Learning Management System MVP has been fully implemented in `C:\Users\DELL\.gemini\antigravity\scratch\alms`. You now have a full-stack codebase optimized for AI-driven exam preparation using past papers.

## 🛠 Tech Stack
- **Frontend**: React.js (Vite), TypeScript, Premium Vanilla CSS Design System with dark mode styling, custom micro-animations, and glassmorphism.
- **Backend**: Python (FastAPI), SQLAlchemy (using a PostgreSQL + pgvector schema design), LangChain, and OpenAI SDK.
- **Deployment Ready**: Included `docker-compose.yml` for standing up the pgvector database.

## ✨ Features Implemented

### Lecturer View
- **Upload Portal**: Lecturers can upload PDF exam papers. The backend chunks these PDFs and uses OpenAI's `text-embedding-3-small` to store vectors in Postgres.

### Student View
- **Dashboard**: A premium, animated glassmorphic dashboard overriding default components.
- **AI Study Assistant**: A chat interface wired to a Retrieval-Augmented Generation (RAG) backend endpoint that answers questions based *strictly* on past paper context.
- **Past Question Browser**: Allows filtering and viewing historical questions by topic, difficulty, and year.
- **Practice Test Generator**: Automatically drafts practice exam papers based on the semantic distribution of historical questions.
- **Analytics Heatmap**: Visualizes a student's mastery across different topics.

## 🚀 How to Run

1. **Start the Database**
   ```bash
   cd C:\Users\DELL\.gemini\antigravity\scratch\alms\backend
   docker-compose up -d
   ```
2. **Setup Backend**
   ```bash
   cd C:\Users\DELL\.gemini\antigravity\scratch\alms\backend
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   set OPENAI_API_KEY=your_key_here
   python init_db.py
   uvicorn main:app --reload
   ```
3. **Start Frontend**
   ```bash
   cd C:\Users\DELL\.gemini\antigravity\scratch\alms\frontend
   npm install
   npm run dev
   ```
Visit `http://localhost:5173` to explore the UI! You can toggle between Student and Lecturer view directly from the header.
