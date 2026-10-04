import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SearchActionContext } from '../types';
import { apiDownloadPost, apiGet, apiPost } from '../lib/api';
import SaveButton from '../components/SaveButton';
import './Practice.css';
import './WorkspacePage.css';

const QUESTION_COUNTS = [5, 10, 15, 20];

type Course = { id: number; code: string; name: string };
type ResourceChoice = { id: number; resource_type: 'lecture_note' | 'past_question' | 'audio'; title: string; course_id?: number | null };
type Citation = { label?: string; source?: string; resource_id?: number; page_from?: number | null; slide_from?: number | null; timestamp_start?: number | null };
type QuizQuestion = {
  id: number;
  position: number;
  question_type: 'multiple_choice' | 'short_answer';
  prompt: string;
  options: string[];
  topic?: string | null;
  difficulty: string;
  citation: Citation;
};
type Quiz = {
  id: number;
  topic?: string | null;
  source_scope: string;
  resource_type?: string | null;
  resource_id?: number | null;
  difficulty: string;
  question_type: string;
  question_count: number;
  questions: QuizQuestion[];
};
type ReviewItem = {
  question_id: number;
  position: number;
  prompt: string;
  answer: string | number | null;
  correct_answer: string;
  is_correct: boolean | null;
  status?: 'correct' | 'incorrect' | 'needs_review';
  graded?: boolean;
  model_answer?: string;
  identified_concepts?: string[];
  missing_concepts?: string[];
  explanation: string;
  citation: Citation;
  topic?: string | null;
};
type Attempt = {
  id: number;
  quiz_id: number;
  topic?: string | null;
  score: number;
  total_questions: number;
  graded_questions?: number;
  needs_review_count?: number;
  percentage: number | null;
  completed_at: string;
  review: ReviewItem[];
};

function citationLabel(citation: Citation | undefined): string {
  return citation?.label || citation?.source || 'Verified source';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Practice({
  initialTopic = '',
  initialContext = null,
}: {
  initialTopic?: string;
  initialContext?: SearchActionContext | null;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [resources, setResources] = useState<ResourceChoice[]>([]);
  const [sourceScope, setSourceScope] = useState<'workspace' | 'resource' | 'topic'>('workspace');
  const [selectedResource, setSelectedResource] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<number | ''>('');
  const [topic, setTopic] = useState(initialContext?.topic || initialTopic || '');
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed');
  const [questionType, setQuestionType] = useState<'multiple_choice' | 'short_answer'>('multiple_choice');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [reviewAttemptId, setReviewAttemptId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      setHistory(await apiGet('/learning/attempts?limit=12') as Attempt[]);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet('/courses'), apiGet('/lecture-notes'), apiGet('/past-questions')])
      .then(([courseData, noteData, pastData]) => {
        if (cancelled) return;
        const nextCourses = courseData as Course[];
        setCourses(nextCourses);
        setSelectedCourseId(initialContext?.course_id || nextCourses[0]?.id || '');
        const notes = (noteData as Array<{ id: number; title?: string; metadata_json?: { document_title?: string; document_type?: string }; course_id?: number }>).map(item => ({ id: item.id, resource_type: item.metadata_json?.document_type === 'audio' ? 'audio' as const : 'lecture_note' as const, title: item.title || item.metadata_json?.document_title || 'Lecture note', course_id: item.course_id }));
        const past = (pastData as Array<{ id: number; title?: string; metadata_json?: { document_title?: string }; course_id?: number }>).map(item => ({ id: item.id, resource_type: 'past_question' as const, title: item.title || item.metadata_json?.document_title || 'Past question', course_id: item.course_id }));
        setResources([...notes, ...past]);
      })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load practice sources.'); })
      .finally(() => { if (!cancelled) void loadHistory(); });
    return () => { cancelled = true; };
  }, [initialContext?.course_id]);

  const selectedResourceChoice = resources.find(resource => `${resource.resource_type}:${resource.id}` === selectedResource);
  const allAnswered = Boolean(quiz?.questions.length) && quiz!.questions.every(question => (answers[question.id] || '').trim().length > 0);
  const answeredCount = quiz?.questions.filter(question => (answers[question.id] || '').trim()).length || 0;
  const selectedCourse = courses.find(course => course.id === selectedCourseId);
  const review = attempt?.review || (reviewAttemptId ? history.find(item => item.id === reviewAttemptId)?.review || [] : []);
  const displayedHistory = useMemo(() => history.slice(0, 8), [history]);

  const generateQuiz = async () => {
    setLoading(true); setError(''); setNotice(''); setAttempt(null); setQuiz(null); setAnswers({}); setReviewAttemptId(null);
    try {
      const payload = await apiPost('/learning/quizzes', {
        source_scope: sourceScope,
        resource_type: sourceScope === 'resource' ? selectedResourceChoice?.resource_type : undefined,
        resource_id: sourceScope === 'resource' ? selectedResourceChoice?.id : undefined,
        course_id: selectedCourseId || undefined,
        topic: topic.trim() || undefined,
        count: questionCount,
        difficulty,
        question_type: questionType,
      }) as Quiz;
      setQuiz(payload);
      if (!payload.questions.length) setError('No reliably gradable questions were found in the authorized sources.');
      else setNotice(`Built from ${payload.questions.length} cited question${payload.questions.length === 1 ? '' : 's'} in your authorized archive.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not create this quiz.'); }
    finally { setLoading(false); }
  };

  const submitQuiz = async () => {
    if (!quiz || !allAnswered) return;
    setLoading(true); setError('');
    try {
      const payload = await apiPost(`/learning/quizzes/${quiz.id}/attempts`, { answers: quiz.questions.map(question => ({ question_id: question.id, answer: answers[question.id] })) }) as Attempt;
      setAttempt(payload); setNotice('Attempt stored. This result is now part of your private learning evidence.'); await loadHistory();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not store this attempt.'); }
    finally { setLoading(false); }
  };

  const resetQuiz = () => { setQuiz(null); setAttempt(null); setAnswers({}); setReviewAttemptId(null); setNotice(''); setError(''); };
  const exportAttempt = (format: 'md' | 'txt') => {
    if (!attempt) return Promise.reject(new Error('There is no completed quiz attempt to export.'));
    const title = `${quiz?.topic || selectedCourse?.code || 'ExamMind'} quiz result`;
    const body = attempt.review.map(item => `${item.prompt}\n${item.status === 'correct' || item.is_correct ? 'Supported' : item.status === 'needs_review' ? 'Needs review' : 'Review'}: ${item.explanation}${item.model_answer ? `\nModel answer: ${item.model_answer}` : ''}`).join('\n\n');
    return apiDownloadPost('/collaboration/exports', {
      content_type: 'quiz_result',
      title,
      format,
      payload: {
        title,
        score: attempt.score,
        total: attempt.total_questions,
        body,
        citations: attempt.review.map(item => item.citation),
      },
    }, `quiz-result-${attempt.id}.${format}`);
  };

  return (
    <div className="page workspace-page" id="s-practice">
      <div className="pg-head"><div className="pg-title">Practice <em>Tests</em></div><div className="pg-sub">Build a cited quiz from material you are allowed to access. Every stored result is private to you.</div></div>
      {notice && <div className="upload-alert practice-notice" role="status"><CheckCircle2 size={18} aria-hidden="true" />{notice}</div>}
      {error && <div className="upload-alert" role="alert">{error}</div>}

      {!quiz ? <>
        <div className="practice-workspace">
          <section className="practice-setup-column" aria-labelledby="practice-setup-heading"><div className="paper-setup"><span className="paper-marks" aria-hidden="true"><i /><i /><i /><i /></span><h2 className="setup-heading" id="practice-setup-heading">Set a paper</h2><p className="setup-lede">ExamMind only generates questions from sources your account can access. Reading a source alone never creates a readiness result.</p>
            <div className="setup-field"><label className="setup-label" htmlFor="practice-course">Course</label><select id="practice-course" className="setup-select" value={selectedCourseId} onChange={event => setSelectedCourseId(Number(event.target.value) || '')}><option value="">All authorized courses</option>{courses.map(course => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</select></div>
            <div className="setup-field"><label className="setup-label" htmlFor="practice-scope">Source scope</label><select id="practice-scope" className="setup-select" value={sourceScope} onChange={event => setSourceScope(event.target.value as typeof sourceScope)}><option value="workspace">My authorized workspace</option><option value="topic">Topic across authorized sources</option><option value="resource">One authorized source</option></select><p className="setup-hint">Private and group sources stay behind the same permission checks as Maxe.</p></div>
            {sourceScope === 'resource' && <div className="setup-field"><label className="setup-label" htmlFor="practice-resource">Source</label><select id="practice-resource" className="setup-select" value={selectedResource} onChange={event => setSelectedResource(event.target.value)}><option value="">Choose a source</option>{resources.map(resource => <option key={`${resource.resource_type}:${resource.id}`} value={`${resource.resource_type}:${resource.id}`}>{resource.title}</option>)}</select></div>}
            <div className="setup-field"><label className="setup-label" htmlFor="practice-topic">Topic focus <span>(optional)</span></label><input id="practice-topic" className="setup-input" value={topic} onChange={event => setTopic(event.target.value)} placeholder="e.g. opportunity cost" /></div>
            <div className="setup-field"><label className="setup-label" htmlFor="practice-difficulty">Difficulty</label><select id="practice-difficulty" className="setup-select" value={difficulty} onChange={event => setDifficulty(event.target.value as typeof difficulty)}><option value="mixed">Mixed progression</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
            <div className="setup-field"><label className="setup-label" htmlFor="practice-type">Question format</label><select id="practice-type" className="setup-select" value={questionType} onChange={event => setQuestionType(event.target.value as typeof questionType)}><option value="multiple_choice">Multiple choice</option><option value="short_answer">Short answer with keyword grading</option></select></div>
            <div className="setup-field"><span className="setup-label" id="practice-count-label">Questions</span><div className="count-choice" role="group" aria-labelledby="practice-count-label">{QUESTION_COUNTS.map(count => <button type="button" className={`count-option${questionCount === count ? ' is-on' : ''}`} aria-pressed={questionCount === count} key={count} onClick={() => setQuestionCount(count)}>{count}</button>)}</div></div>
            <button type="button" className="practice-primary" onClick={() => void generateQuiz()} disabled={loading || (sourceScope === 'resource' && !selectedResourceChoice)}>{loading ? 'Building cited quiz...' : 'Create cited quiz'}</button>
          </div></section>
          <aside className="practice-support" aria-label="Practice evidence guide"><div className="margin-block"><h2 className="margin-label">What counts</h2><p className="margin-lede">Evidence, <em>not vibes.</em></p><p className="margin-note">Only submitted answers affect readiness. A document view or Maxe question never marks a topic mastered.</p></div><div className="margin-block"><h2 className="margin-label">A private record</h2><ul className="margin-steps"><li><span className="margin-step-no">01</span><span>Choose authorized material.</span></li><li><span className="margin-step-no">02</span><span>Answer the cited questions.</span></li><li><span className="margin-step-no">03</span><span>Review explanations and retake.</span></li></ul></div><div className="margin-block margin-block--end"><h2 className="margin-label">Recent attempts</h2><p className="margin-note">{loadingHistory ? 'Loading your private history...' : `${history.length} stored attempt${history.length === 1 ? '' : 's'}.`}</p></div></aside>
        </div>
        <section className="practice-history-panel" aria-labelledby="practice-history-heading"><div className="progress-section-head"><div><p className="progress-section-label">Private history</p><h2 id="practice-history-heading">Recent quiz attempts</h2></div><span>{history.length} stored</span></div>{loadingHistory ? <p className="practice-history-empty">Loading your attempts...</p> : displayedHistory.length === 0 ? <p className="practice-history-empty">No quiz attempts yet. Your first submitted quiz will appear here.</p> : <div className="practice-history-list">{displayedHistory.map(item => <div className="practice-history-row" key={item.id}><span>{formatDate(item.completed_at)}</span><strong>{item.topic || 'Mixed revision'}</strong><span>{item.score}/{item.total_questions} - {item.percentage === null ? 'Needs review' : `${item.percentage}%`}</span><button type="button" className="mark" onClick={() => setReviewAttemptId(reviewAttemptId === item.id ? null : item.id)}>{reviewAttemptId === item.id ? 'Hide review' : 'Review answers'}</button>{reviewAttemptId === item.id && <div className="history-review">{item.review.map(reviewItem => <div key={reviewItem.question_id}><strong>{reviewItem.status === 'correct' || reviewItem.is_correct ? 'Correct' : reviewItem.status === 'needs_review' ? 'Needs review' : 'Review'} - {reviewItem.topic || 'Mixed revision'}</strong><p>{reviewItem.explanation}</p>{reviewItem.model_answer && <small>Model answer: {reviewItem.model_answer}</small>}<small>{citationLabel(reviewItem.citation)}</small></div>)}</div>}</div>)}</div>}</section>
      </> : <section className="paper" aria-labelledby="quiz-paper-heading"><header className="paper-head"><div><h2 className="paper-title" id="quiz-paper-heading">{selectedCourse?.code || 'ExamMind'} quiz</h2><p className="paper-meta">{quiz.topic || 'Mixed revision'} - {quiz.question_count} questions - {quiz.difficulty} - every question has a verified source</p></div><span className="paper-progress"><span className="is-num">{answeredCount}</span> of <span className="is-num">{quiz.questions.length}</span> answered</span></header><ol className="paper-questions">{quiz.questions.map((question, index) => { const answer = answers[question.id] || ''; const reviewItem = review.find(item => item.question_id === question.id); const reviewStatus = reviewItem?.status || (reviewItem?.is_correct ? 'correct' : reviewItem ? 'incorrect' : undefined); return <li className={`question${reviewStatus === 'correct' ? ' is-correct' : reviewStatus ? ' is-incorrect' : ''}`} key={question.id}><span className="question-no">{String(index + 1).padStart(2, '0')}</span><div><p className="question-prompt">{question.prompt}</p><p className="question-tags"><span>{question.topic || 'Mixed revision'}</span><span>{question.difficulty}</span><span>{citationLabel(question.citation)}</span></p>{question.question_type === 'multiple_choice' ? <div className="quiz-options" role="radiogroup" aria-label={`Answers for question ${index + 1}`}>{question.options.map((option, optionIndex) => <button type="button" role="radio" aria-checked={answer === String(optionIndex)} className={`quiz-option${answer === String(optionIndex) ? ' is-selected' : ''}`} key={option} onClick={() => setAnswers(current => ({ ...current, [question.id]: String(optionIndex) }))}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}</div> : <textarea className="quiz-short-answer" value={answer} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} placeholder="Write a short answer in your own words" aria-label={`Answer question ${index + 1}`} rows={3} />}{reviewItem && <div className="answer-review"><strong>{reviewStatus === 'correct' ? 'Supported answer' : reviewStatus === 'needs_review' ? 'Needs review' : 'Review this answer'}</strong><p>{reviewItem.explanation}</p>{reviewItem.status === 'needs_review' && <p>Identified concepts: {reviewItem.identified_concepts?.join(', ') || 'None yet'}; missing concepts: {reviewItem.missing_concepts?.join(', ') || 'None'}.</p>}<small>Model answer: {reviewItem.model_answer || reviewItem.correct_answer}</small></div>}</div></li>; })}</ol><footer className="paper-foot"><button type="button" className="practice-primary" onClick={() => void submitQuiz()} disabled={loading || !allAnswered || Boolean(attempt)}>{loading ? 'Storing attempt...' : attempt ? 'Attempt stored' : 'Submit answers'}</button><p className="paper-foot-note">{attempt ? `Stored ${attempt.score}/${attempt.total_questions}; ${attempt.graded_questions ?? attempt.total_questions} graded. Retakes create a new history entry.` : allAnswered ? 'Your answers will be graded against the stored question keys.' : `${quiz.questions.length - answeredCount} still to answer.`}</p><button type="button" className="mark" onClick={resetQuiz}>Build another quiz</button></footer>{attempt && <div className="success-card practice-result"><div className="success-label">Private attempt stored</div><div className="success-title">{attempt.percentage === null ? 'No graded score yet' : `${attempt.percentage}% supported`}</div><div className="success-body">Read the source-grounded explanations above. Ambiguous answers are marked “Needs review” and excluded from readiness evidence.</div><SaveButton compact triggerLabel="Export result" menuLabel="Export result" hideSaveActions target={{ itemType: 'practice_result', refId: attempt.id, title: `${quiz.topic || selectedCourse?.code || 'ExamMind'} quiz result`, meta: `${attempt.score}/${attempt.total_questions}`, exports: [{ label: 'Export Markdown', description: 'Download this private quiz result as Markdown', run: () => exportAttempt('md') }, { label: 'Export plain text', description: 'Download this private quiz result as text', run: () => exportAttempt('txt') }] }} /></div>}</section>}
    </div>
  );
}
