export type ScreenType = 'dashboard' | 'questions' | 'assistant' | 'upload' | 'offline' | 'analytics' | 'practice' | 'collab' | 'empty' | 'progress' | 'groups' | 'search';

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  role: string;
};

export type AcademicMetadata = {
  document_type: 'past_question' | 'lecture_note' | 'course_outline' | 'tutorial' | 'assignment' | 'revision_slide' | 'exam_prep' | 'unknown';
  document_title?: string;
  course_code?: string;
  course_title?: string;
  instructor_names?: string[];
  academic_year?: string;
  year?: number | null;
  semester?: string;
  department?: string;
  faculty?: string;
  college?: string;
  exam_type?: 'quiz' | 'test' | 'midterm' | 'final' | 'unknown';
  topics_covered?: string[];
  source_file?: string;
  extraction_method?: 'embedded_text' | 'ocr' | 'mixed' | 'manual' | 'failed';
  extraction_confidence?: number;
  extraction_failure_reason?: 'embedded_text_weak' | 'ocr_not_installed' | 'ocr_failed' | 'ocr_low_confidence' | 'file_too_blurry' | 'unsupported_pdf' | 'encrypted_pdf' | '';
  indexed_status?: 'indexed' | 'indexed_review_required' | 'unindexed';
  searchable?: boolean;
  needs_review?: boolean;
  needs_clearer_file?: boolean;
  confidence_score?: number;
};

export type SearchUnderstanding = {
  interpreted_topic: string | null;
  related_terms: string[];
  possible_courses: string[];
  possible_people: string[];
  person_name?: string | null;
  course_code?: string | null;
  topic?: string | null;
  should_search?: boolean;
  should_call_rag?: boolean;
  needs_course?: boolean;
  needs_person?: boolean;
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
  title?: string | null;
  content_text?: string | null;
  snippets?: string[];
  chunk_ids?: number[];
  matching_sections?: number;
  metadata_json?: AcademicMetadata | Record<string, unknown> | null;
  verified_status?: string | null;
};

export type SearchActionContext = {
  query: string;
  topic?: string;
  course_id?: number | null;
  course_code?: string;
  course_title?: string;
  material_title?: string;
};

export type LectureNote = {
  id: number;
  course_id?: number | null;
  topic?: string | null;
  title: string;
  year?: number | null;
  semester?: string | null;
  verified_status?: string | null;
  metadata_json?: AcademicMetadata | Record<string, unknown> | null;
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
    possible_people: string[];
    person_name?: string | null;
    course_code?: string | null;
    topic?: string | null;
    needs_course?: boolean;
    needs_person?: boolean;
    intent: string;
    confidence: number;
    needs_clarification: boolean;
    clarifying_question: string | null;
  } | null;
};
