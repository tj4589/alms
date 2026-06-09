export type ScreenType = 'dashboard' | 'questions' | 'assistant' | 'upload' | 'offline' | 'analytics' | 'practice' | 'collab' | 'empty' | 'progress' | 'groups';

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  role: string;
};

export type MsgType =
  | 'greeting' | 'guidance' | 'unsure_support' | 'upload_help'
  | 'missing_materials' | 'academic_answer' | 'search_result'
  | 'practice_help' | 'confirmation' | 'follow_up' | 'error';

export type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  msgType?: MsgType;
  sources?: string[];
  noPastQuestionsFound?: boolean;
  noLectureNotesFound?: boolean;
  wasStudyQuery?: boolean;
  showUnderstoodAs?: boolean;
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
