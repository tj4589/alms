export type ScreenType = 'dashboard' | 'questions' | 'assistant' | 'upload' | 'offline' | 'analytics' | 'practice' | 'collab' | 'empty' | 'progress' | 'groups';

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  role: string;
};

export type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  sources?: string[];
  noPastQuestionsFound?: boolean;
  noLectureNotesFound?: boolean;
  wasStudyQuery?: boolean;
  understanding?: {
    interpreted_topic: string | null;
    related_terms: string[];
    possible_courses: string[];
    possible_lecturers: string[];
    intent: string;
    confidence: number;
    needs_clarification: boolean;
    clarifying_question: string | null;
  } | null;
};
