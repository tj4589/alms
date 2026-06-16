import { useEffect, useMemo, useState } from 'react';
import type { ScreenType, SearchActionContext } from '../types';
import { apiGet, apiPost } from '../lib/api';
import { queuePracticeAttempt } from '../offline';

type Course = {
  id: number;
  code: string;
  name: string;
};

type GeneratedQuestion = {
  id: number;
  prompt: string;
  year?: number | null;
  difficulty?: string | null;
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

const selectStyle = {
  width: '100%',
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '8px 12px',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  outline: 'none',
};

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
  const [answers, setAnswers] = useState<Record<number, boolean | null>>({});
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
  }, [initialContext?.topic, initialTopic]);

  const score = useMemo(() => {
    return Object.values(answers).filter(Boolean).length;
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
        setError('No past questions matched this practice setup yet. Upload and index past questions, then generate again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate practice test.');
    } finally {
      setLoading(false);
    }
  };

  const markQuestion = (questionId: number, correct: boolean) => {
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
      setSubmitting(false);
      return;
    }

    try {
      const data = await apiPost('/practice/submit', requestBody) as SubmitResponse;
      setResult(data);
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
        <div className="pg-sub">Generated from uploaded past questions · self-marked · readiness updated after submission</div>
      </div>

      {notice && <div className="upload-alert" style={{ borderColor: 'rgba(232,162,58,0.35)', color: 'var(--text2)' }}>{notice}</div>}
      {error && <div className="upload-alert">{error}</div>}

      <div className="two-col">
        <div className="card">
          <div className="card-hd"><div className="card-ttl">Generate a practice test</div></div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
            <div>
              <div style={{fontSize: 11, color: 'var(--text3)', marginBottom: 5, fontWeight: 500}}>Course</div>
              <select style={selectStyle} value={selectedCourseId} onChange={(event) => setSelectedCourseId(Number(event.target.value) || '')}>
                {courses.length === 0 && <option value="">No courses loaded</option>}
                {courses.map((course) => (
                  <option value={course.id} key={course.id}>{course.code} - {course.name}</option>
                ))}
              </select>
            </div>

            <div>
              <div style={{fontSize: 11, color: 'var(--text3)', marginBottom: 5, fontWeight: 500}}>Topic focus</div>
              <select style={selectStyle} value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)}>
                {topics.map((topic) => <option value={topic} key={topic}>{topic}</option>)}
              </select>
            </div>

            <div>
              <div style={{fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 500}}>Number of questions: <span id="q-count">{qCount}</span></div>
              <input type="range" min="5" max="30" value={qCount} step="1" style={{width: '100%', accentColor: 'var(--gold)'}} onChange={(e) => setQCount(parseInt(e.target.value, 10))} />
            </div>

            <button 
              className="cta" 
              style={{width: '100%', justifyContent: 'center', padding: 12, fontSize: 13.5}}
              onClick={generateTest}
              disabled={loading || !selectedCourseId}
            >
              {loading ? 'Generating questions...' : 'Generate test →'}
            </button>
          </div>
        </div>

        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">Attempt summary</div></div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--border)'}}>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 13, fontWeight: 500}}>{selectedCourse ? `${selectedCourse.code} practice` : 'No course selected'}</div>
                  <div style={{fontSize: 11, color: 'var(--text3)'}}>{selectedTopic} · {generatedQuestions.length} questions generated</div>
                </div>
                <div style={{fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--gold)'}}>{score}/{generatedQuestions.length || 0}</div>
              </div>
            </div>
          </div>

          {generatedQuestions.length === 0 && !result && (
            <div className="pred-card">
              <div className="pred-lbl">How it works</div>
              <div className="pred-title">Build from <em style={{color: 'var(--gold)'}}>past questions</em></div>
              <div className="pred-body">Pick a course and topic, generate a test, attempt each question, then self-mark honestly. ExamMind updates your readiness score after every submission.</div>
            </div>
          )}
        </div>
      </div>

      {generatedQuestions.length > 0 && (
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Generated questions</div>
            <div style={{fontSize: 12, color: 'var(--text3)'}}>Mark after attempting</div>
          </div>

          {generatedQuestions.map((question, index) => (
            <div className="qd" style={{cursor: 'default'}} key={question.id}>
              <div className="qd-text">{index + 1}. {question.prompt}</div>
              <div className="qd-meta">
                <span className="tag tag-m">{question.difficulty || 'Mixed'}</span>
                <span className="qi-yr">{question.year || 'Year unknown'}</span>
                <button className={`cta cta-ghost ${answers[question.id] === true ? 'on' : ''}`} style={{marginTop: 0}} onClick={() => markQuestion(question.id, true)}>Correct</button>
                <button className={`cta cta-ghost ${answers[question.id] === false ? 'on' : ''}`} style={{marginTop: 0}} onClick={() => markQuestion(question.id, false)}>Incorrect</button>
              </div>
            </div>
          ))}

          <button className="cta" onClick={submitPractice} disabled={submitting || !allMarked}>
            {submitting ? 'Submitting score...' : `Submit score (${score}/${generatedQuestions.length})`}
          </button>
        </div>
      )}

      {result && (
        <div className="success-card" style={{marginTop: 18}}>
          <div className="success-label">Practice submitted</div>
          <div className="success-title">Readiness score: {result.readiness_score}%</div>
          <div className="success-body">{result.debrief}</div>
          <div className="empty-actions">
            <button className="cta" onClick={() => go('progress')}>View full progress →</button>
            <button className="cta cta-ghost" onClick={() => { setResult(null); setGeneratedQuestions([]); setAnswers({}); }}>Practice again</button>
          </div>
        </div>
      )}
    </div>
  );
}
