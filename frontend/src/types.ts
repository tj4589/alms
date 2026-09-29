export type ScreenType = 'dashboard' | 'questions' | 'assistant' | 'upload' | 'offline' | 'practice' | 'collab' | 'empty' | 'progress' | 'groups' | 'search' | 'settings' | 'profile' | 'reader' | 'onboarding' | 'spaces' | 'workspace';

export type Course = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  department?: string | null;
  level?: string | null;
};

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  role: string;
};

export type LearningSpaceMembership = {
  id: number;
  role: string;
  status: string;
  external_member_id?: string | null;
  onboarding_required: boolean;
  joined_at?: string | null;
};

export type LearningSpace = {
  id: number;
  slug: string;
  name: string;
  type: 'academy' | 'university' | 'personal' | 'organization' | string;
  description?: string | null;
  logo?: string | null;
  status: string;
  membership?: LearningSpaceMembership | null;
};

export type LearningSpaceMembershipEntry = {
  space: LearningSpace & { membership: LearningSpaceMembership };
};

export type LearningSpacesResponse = {
  active_space: LearningSpace | null;
  memberships: LearningSpaceMembershipEntry[];
  available_spaces: LearningSpace[];
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
  visibility?: 'public' | 'group' | 'private';
  contributor_label?: string | null;
  metadata_json?: AcademicMetadata | Record<string, unknown> | null;
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
  visibility?: 'public' | 'group' | 'private';
  contributor_label?: string | null;
  metadata_json?: AcademicMetadata | Record<string, unknown> | null;
};

export type SearchThread = {
  id: number;
  title: string;
  created_by?: number | null;
  created_by_username?: string | null;
  course_id?: number | null;
  created_at?: string | null;
  category?: string | null;
  mood?: string | null;
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
  visibility?: 'public' | 'private';
  status?: string;
  welcome_message?: string | null;
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
  sourceCitations?: MaxeCitation[];
  mode?: 'source' | 'beyond_materials';
  knowledgeGap?: boolean;
  knowledgeGapMessage?: string | null;
  learningSuggestion?: {
    message: string;
    topic?: string | null;
    action?: string | null;
    evidence?: Record<string, unknown>;
  } | null;
  context?: {
    active_resource?: { resource_type?: string; resource_id?: number; title?: string } | null;
    selected_text_used?: boolean;
    selected_text_source?: string | null;
  };
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

export type MaxeCitation = {
  source?: string;
  material_type?: string;
  resource_type?: string;
  resource_id?: number;
  material_id?: number;
  chunk_id?: number | null;
  resource_title?: string;
  label?: string;
  page_from?: number | null;
  page_to?: number | null;
  slide_from?: number | null;
  slide_to?: number | null;
  timestamp_start?: number | null;
  timestamp_end?: number | null;
  section?: string | null;
  target?: {
    screen?: string;
    resource_type?: string;
    resource_id?: number;
    start_time?: number;
    end_time?: number | null;
    page_from?: number | null;
    slide_from?: number | null;
  };
};
