export type ScreenType = 'dashboard' | 'questions' | 'assistant' | 'upload' | 'offline' | 'analytics' | 'practice' | 'collab' | 'empty' | 'progress' | 'groups';

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  role: string;
};

export type SearchUnderstanding = {
  interpreted_topic: string | null;
  related_terms: string[];
  possible_courses: string[];
  possible_lecturers: string[];
  lecturer_name?: string | null;
  course_code?: string | null;
  topic?: string | null;
  should_search?: boolean;
  should_call_rag?: boolean;
  needs_course?: boolean;
  needs_lecturer?: boolean;
  intent: string;
  confidence: number;
  needs_clarification: boolean;
  clarifying_question: string | null;
};

export type PastQuestion = {
  id: number;
  course_id?: number | null;
  year?: number | null;
  semester?: string | null;
  difficulty?: string | null;
  content_text?: string | null;
  metadata_json?: Record<string, unknown> | null;
  verified_status?: string | null;
};

export type LectureNote = {
  id: number;
  course_id?: number | null;
  topic?: string | null;
  title: string;
  year?: number | null;
  semester?: string | null;
  verified_status?: string | null;
  metadata_json?: Record<string, unknown> | null;
};

export type SearchThread = {
  id: number;
  title: string;
  created_by?: number | null;
  created_by_username?: string | null;
  course_id?: number | null;
  created_at?: string | null;
};

export type StudyGroupResult = {
  id: number;
  name: string;
  description?: string | null;
  course_id?: number | null;
  topic?: string | null;
  created_by_username?: string | null;
  created_at?: string | null;
  member_count?: number;
  is_member?: boolean;
};

export type StudySessionResult = {
  id: number;
  title: string;
  topic?: string | null;
  exam_goal?: string | null;
  course_id?: number | null;
  creator_username?: string | null;
  status?: string | null;
  created_at?: string | null;
  participant_count?: number;
  studying_count?: number;
  on_break_count?: number;
};

export type SearchSuggestedAction = {
  label: string;
  action: 'ask_ai' | 'upload' | 'practice' | 'discussion' | 'study_group' | 'reading_room';
  payload?: Record<string, unknown>;
};

export type GlobalSearchResult = {
  query: string;
  understanding?: SearchUnderstanding | null;
  past_questions: PastQuestion[];
  lecture_notes: LectureNote[];
  threads: SearchThread[];
  related_topics: string[];
  study_groups: StudyGroupResult[];
  study_sessions: StudySessionResult[];
  suggested_actions?: SearchSuggestedAction[];
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
    lecturer_name?: string | null;
    course_code?: string | null;
    topic?: string | null;
    needs_course?: boolean;
    needs_lecturer?: boolean;
    intent: string;
    confidence: number;
    needs_clarification: boolean;
    clarifying_question: string | null;
  } | null;
};
