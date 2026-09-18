import { useEffect, useMemo, useState } from 'react';
import SaveButton from '../components/SaveButton';
import type { ScreenType, SearchActionContext } from '../types';
import { apiGet, apiPost } from '../lib/api';
import { queuePracticeAttempt } from '../offline';

import './Practice.css';

const QUESTION_COUNTS = [5, 10, 15, 20, 30];

type Course = {
  id: number;
  code: string;
  name: string;
};

type GeneratedQuestion = {
  id: string;
  prompt: string;
  source?: string;
  source_type?: 'past_question' | 'generated_from_notes' | string;
  year?: number | null;
  difficulty?: string | null;
  topic_tags?: string[];
};

type GenerateResponse = {
  topic: string;
  warning?: string | null;
  questions: GeneratedQuestion[];
};

type SubmitResponse = {
  attempt_id: number;
  readiness_score: number;
  debrief: string;
};

const BASE_TOPICS = [
  'Mixed revision',
  'critical path',
  'risk management',
  'cost variance',
  'stakeholder management',
  'communication management',
  'procurement management',
  'earned value management',
];


export default function Practice({
  go,
  initialTopic = '',
  initialContext = null,
}: {
  go: (s: ScreenType) => void;
  initialTopic?: string;
  initialContext?: SearchActionContext | null;
}) {
  const contextTopic = initialContext?.topic || initialTopic;
  const topics = contextTopic && !BASE_TOPICS.includes(contextTopic)
    ? [contextTopic, ...BASE_TOPICS]
    : BASE_TOPICS;

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | ''>('');
  const [selectedTopic, setSelectedTopic] = useState(
    contextTopic && contextTopic !== 'Mixed revision' ? contextTopic : 'Mixed revision'
  );
  const [qCount, setQCount] = useState<number>(10);
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCourses() {
      try {
        const data = await apiGet('/courses') as Course[];
        if (!cancelled) {
          setCourses(data);
          if (data.length > 0) {
            const contextCourse = data.find(course =>
              (initialContext?.course_id && course.id === initialContext.course_id) ||
              (initialContext?.course_code && course.code.toLowerCase() === initialContext.course_code.toLowerCase())
            );
            setSelectedCourseId(contextCourse?.id ?? data[0].id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load courses.');
        }
      }
    }

    loadCourses();
    return () => {
      cancelled = true;
    };
  }, [initialContext?.course_id, initialContext?.course_code]);

  useEffect(() => {
    const nextTopic = initialContext?.topic || initialTopic;
    if (nextTopic && nextTopic !== selectedTopic) {
      setSelectedTopic(nextTopic);
    }
  }, [initialContext?.topic, initialTopic, selectedTopic]);

  const score = useMemo(() => {
    return Object.values(answers).filter(Boolean).length;
  }, [answers]);

  const markedCount = useMemo(() => {
    return Object.values(answers).filter((value) => value !== null && value !== undefined).length;
  }, [answers]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const allMarked = generatedQuestions.length > 0 && generatedQuestions.every((question) => answers[question.id] !== undefined && answers[question.id] !== null);

  const generateTest = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    setResult(null);
    setGeneratedQuestions([]);
    setAnswers({});

    const requestBody = {
      course_id: selectedCourseId || undefined,
      topic: selectedTopic === 'Mixed revision' ? undefined : selectedTopic,
      count: qCount,
    };

    try {
      const data = await apiPost('/practice/generate', requestBody) as GenerateResponse;
      setGeneratedQuestions(data.questions || []);
      setAnswers(Object.fromEntries((data.questions || []).map((question) => [question.id, null])));
      if (data.warning) {
        setNotice(data.warning);
      }
      if (!data.questions || data.questions.length === 0) {
        setError('Nothing in the archive matched this setup yet. Add past questions or materials, then set the paper again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate practice test.');
    } finally {
      setLoading(false);
    }
  };

  const markQuestion = (questionId: string, correct: boolean) => {
    setAnswers((current) => ({ ...current, [questionId]: correct }));
  };

  const submitPractice = async () => {
    if (!allMarked) {
      setError('Mark each question correct or incorrect before submitting.');
      return;
    }

    setSubmitting(true);
    setError('');

    const requestBody = {
      course_id: selectedCourseId || undefined,
      topic: selectedTopic === 'Mixed revision' ? undefined : selectedTopic,
      score,
      total_questions: generatedQuestions.length,
    };

    if (!navigator.onLine) {
      await queuePracticeAttempt(requestBody);
      setResult({ attempt_id: -1, readiness_score: Math.round((score / generatedQuestions.length) * 100), debrief: 'You are offline. This attempt has been saved and will sync to your progress when you reconnect.' });
      setNotice(`Practice saved offline. Score: ${score}/${generatedQuestions.length}. Readiness will sync when you reconnect.`);
      setSubmitting(false);
      return;
    }

    try {
      const data = await apiPost('/practice/submit', requestBody) as SubmitResponse;
      setResult(data);
      setNotice(`Practice submitted. Score: ${score}/${generatedQuestions.length}. Readiness updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit practice score.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" id="s-practice">
      <div className="pg-head">
        <div className="pg-title">Practice <em>Tests</em></div>
        <div className="pg-sub">Built from past questions and materials in the shared archive · self-marked · readiness updated after submission</div>
      </div>

      {notice && <div className="upload-alert" style={{ borderColor: result ? 'rgba(62,207,178,0.35)' : 'rgba(232,162,58,0.35)', color: 'var(--text2)' }}>{notice}</div>}
      {error && <div className="upload-alert">{error}</div>}

      <div className="practice-layout">
        <div className="paper-setup">
          <span className="paper-marks" aria-hidden="true"><i /><i /><i /><i /></span>

          {courses.length === 0 ? (
            <div className="setup-blocked">
              <h2 className="setup-heading">Nothing to practise from yet</h2>
              <p className="setup-blocked-body">
                Practice tests are built from past questions and materials in the shared archive.
                Add some, or wait for a coursemate to, and ExamMind will set the questions.
              </p>
              <button className="practice-primary" onClick={() => go('upload')}>Add materials</button>
            </div>
          ) : (
            <>
              <h2 className="setup-heading">Set a paper</h2>
              <p className="setup-lede">Choose what to be tested on. Questions come from the shared archive.</p>

              <div className="setup-field">
                <label className="setup-label" htmlFor="practice-course">Course</label>
                <select id="practice-course" className="setup-select" value={selectedCourseId} onChange={(event) => setSelectedCourseId(Number(event.target.value) || '')}>
                  {courses.map((course) => (
                    <option value={course.id} key={course.id}>{course.code} - {course.name}</option>
                  ))}
                </select>
              </div>

              <div className="setup-field">
                <label className="setup-label" htmlFor="practice-topic">Topic focus</label>
                <select id="practice-topic" className="setup-select" value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)}>
                  {topics.map((topic) => <option value={topic} key={topic}>{topic}</option>)}
                </select>
              </div>

              <div className="setup-field">
                <span className="setup-label" id="practice-count-label">Questions</span>
                <div className="count-choice" role="group" aria-labelledby="practice-count-label">
                  {QUESTION_COUNTS.map((count) => (
                    <button
                      type="button"
                      key={count}
                      className={`count-option${qCount === count ? ' is-on' : ''}`}
                      aria-pressed={qCount === count}
                      onClick={() => setQCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <p className="setup-hint">About {Math.max(1, Math.round(qCount * 1.5))} minutes at a steady pace.</p>
              </div>

              <button className="practice-primary" onClick={generateTest} disabled={loading || !selectedCourseId}>
                {loading ? 'Setting your paper...' : 'Set the paper'}
              </button>
            </>
          )}
        </div>

        <aside className="practice-margin">
          <section className="margin-block">
            <h2 className="margin-label">This attempt</h2>
            <dl className="margin-facts">
              <div><dt>Course</dt><dd>{selectedCourse ? selectedCourse.code : 'Not chosen'}</dd></div>
              <div><dt>Topic</dt><dd>{selectedTopic}</dd></div>
              <div><dt>Questions</dt><dd className="is-num">{generatedQuestions.length || qCount}</dd></div>
              {generatedQuestions.length > 0 && (
                <div><dt>Marked</dt><dd className="is-num">{markedCount}/{generatedQuestions.length}</dd></div>
              )}
            </dl>
          </section>

          {generatedQuestions.length === 0 && !result && (
            <section className="margin-block margin-block--end">
              <h2 className="margin-label">How it works</h2>
              <p className="margin-lede">Build from <em>past questions</em></p>
              <p className="margin-note">Pick a course and topic, sit the paper, then mark yourself honestly. Your readiness score updates after every submission.</p>
            </section>
          )}
        </aside>
      </div>

      {generatedQuestions.length > 0 && (
        <section className="paper" aria-label="Your practice paper">
          <header className="paper-head">
            <div>
              <h2 className="paper-title">{selectedCourse ? selectedCourse.code : 'Practice'} paper</h2>
              <p className="paper-meta">{selectedTopic} · {generatedQuestions.length} questions · attempt each one, then mark yourself</p>
            </div>
            <span className="paper-progress" aria-live="polite">
              <span className="is-num">{markedCount}</span> of <span className="is-num">{generatedQuestions.length}</span> marked
            </span>
          </header>

          <ol className="paper-questions">
            {generatedQuestions.map((question, index) => {
              const mark = answers[question.id];
              const state = mark === true ? ' is-correct' : mark === false ? ' is-incorrect' : '';
              return (
                <li className={`question${state}`} key={question.id}>
                  <span className="question-no">{String(index + 1).padStart(2, '0')}</span>
                  <div className="question-body">
                    <p className="question-prompt">{question.prompt}</p>
                    <p className="question-tags">
                      <span>{question.difficulty || 'Mixed'}</span>
                      <span>{question.source_type === 'generated_from_notes' ? 'From lecture notes' : 'From past questions'}</span>
                      <span>{question.year || 'Year unknown'}</span>
                      {(question.topic_tags || []).map(tag => <span key={`${question.id}-${tag}`}>{tag}</span>)}
                    </p>
                    <div className="mark-row" role="group" aria-label={`Mark question ${index + 1}`}>
                      <button
                        type="button"
                        className={`mark mark-correct${mark === true ? ' is-on' : ''}`}
                        aria-pressed={mark === true}
                        onClick={() => markQuestion(question.id, true)}
                      >
                        I got it right
                      </button>
                      <button
                        type="button"
                        className={`mark mark-incorrect${mark === false ? ' is-on' : ''}`}
                        aria-pressed={mark === false}
                        onClick={() => markQuestion(question.id, false)}
                      >
                        I got it wrong
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <footer className="paper-foot">
            <button className="practice-primary" onClick={submitPractice} disabled={submitting || !allMarked}>
              {submitting ? 'Submitting...' : allMarked ? `Submit ${score}/${generatedQuestions.length}` : 'Submit'}
            </button>
            <p className="paper-foot-note">
              {allMarked
                ? 'Every question is marked. Submitting updates your readiness score.'
                : `${generatedQuestions.length - markedCount} still to mark before you can submit.`}
            </p>
          </footer>
        </section>
      )}

      {result && (
        <div className="success-card" style={{marginTop: 18}}>
          <div className="success-label">Practice submitted</div>
          <div className="success-title">Readiness score: {result.readiness_score}%</div>
          <div className="success-body">{result.debrief}</div>
          <div className="empty-actions">
            <button className="cta" onClick={() => go('progress')}>View full progress →</button>
            <button className="cta cta-ghost" onClick={() => { setResult(null); setGeneratedQuestions([]); setAnswers({}); }}>Practice again</button>
            {/* No file behind a result, so no Download is offered. */}
            <SaveButton
              target={{
                itemType: 'practice_result',
                refId: result.attempt_id,
                title: `Practice result: ${result.readiness_score}% readiness`,
                meta: [selectedTopic, new Date().toLocaleDateString()].filter(Boolean).join(' · '),
                // The score and debrief are the whole of it, so saving one
                // keeps everything there was to keep.
                snapshot: async () => ({ ...result, topic: selectedTopic }),
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
