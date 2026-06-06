import { useEffect, useMemo, useState } from 'react';
import type { ScreenType } from '../types';
import { saveStudyPack } from '../offline';
import { apiGet } from '../lib/api';

type Course = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
};

type PastQuestion = {
  id: number;
  course_id?: number | null;
  year?: number | null;
  semester?: string | null;
  difficulty?: string | null;
  content_text: string;
  metadata_json?: {
    course_code?: string;
    topics_covered?: string[];
    source_file?: string;
    [key: string]: unknown;
  } | null;
};

function questionTopic(question: PastQuestion) {
  return question.metadata_json?.topics_covered?.[0] || 'General';
}

function courseLabel(course?: Course, question?: PastQuestion) {
  if (course) return `${course.code} - ${course.name}`;
  return question?.metadata_json?.course_code || 'Unknown course';
}

function difficultyClass(difficulty?: string | null) {
  const normalized = (difficulty || '').toLowerCase();
  if (normalized === 'hard') return 'tag-h';
  if (normalized === 'medium' || normalized === 'mixed') return 'tag-m';
  return 'tag-e';
}

function heatmapIntensity(index: number) {
  if (index < 2) return 'v5';
  if (index < 4) return 'v4';
  if (index < 6) return 'v3';
  return 'v2';
}

export default function Questions({
  go,
  onAskQuestion,
  onQuestionCountChange,
}: {
  go: (s: ScreenType) => void;
  onAskQuestion: (questionText: string) => void;
  onQuestionCountChange: (count: number) => void;
}) {
  const [topicFilter, setTopicFilter] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [offlineMessage, setOfflineMessage] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [questions, setQuestions] = useState<PastQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadCourses() {
      try {
        const data = await apiGet('/courses') as Course[];
        if (!cancelled) {
          setCourses(data);
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
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      setLoading(true);
      setError('');
      try {
        const query = selectedCourseId ? `?course_id=${selectedCourseId}` : '';
        const data = await apiGet(`/past-questions${query}`) as PastQuestion[];
        if (!cancelled) {
          setQuestions(data);
          onQuestionCountChange(data.length);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load past questions.');
          setQuestions([]);
          onQuestionCountChange(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadQuestions();
    return () => {
      cancelled = true;
    };
  }, [selectedCourseId, onQuestionCountChange]);

  const courseById = useMemo(() => {
    return new Map(courses.map((course) => [course.id, course]));
  }, [courses]);

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => {
      const topic = questionTopic(question);
      counts.set(topic, (counts.get(topic) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [questions]);

  const visibleQuestions = useMemo(() => {
    if (!topicFilter) return questions;
    return questions.filter((question) => questionTopic(question) === topicFilter);
  }, [questions, topicFilter]);

  const filterTopic = (topic: string) => {
    setTopicFilter((current) => current === topic ? '' : topic);
    setOfflineMessage('');
  };

  const selectCourse = (courseId: number | null) => {
    setSelectedCourseId(courseId);
    setTopicFilter('');
    setOfflineMessage('');
  };

  const saveOfflinePack = async () => {
    const packQuestions = visibleQuestions.map((question) => ({
      year: String(question.year || 'Unknown'),
      topic: questionTopic(question),
      difficulty: question.difficulty || 'Mixed',
      text: question.content_text,
    }));
    const selectedCourse = selectedCourseId ? courseById.get(selectedCourseId) : undefined;

    await saveStudyPack({
      id: `${selectedCourse?.code || 'all'}-${topicFilter || 'all'}-${Date.now()}`,
      courseCode: selectedCourse?.code || 'All courses',
      title: topicFilter ? `${topicFilter} past-question pack` : 'Past-question pack',
      savedAt: new Date().toISOString(),
      questions: packQuestions,
    });
    setOfflineMessage(`${packQuestions.length} questions saved for offline study.`);
    window.dispatchEvent(new Event('exammind-offline-updated'));
  };

  const askQuestion = (event: React.MouseEvent, question: PastQuestion) => {
    event.stopPropagation();
    onAskQuestion(question.content_text);
  };

  return (
    <div className="page" id="s-questions">
      <div className="pg-head">
        <div className="pg-title">Past <em>Questions</em></div>
        <div className="pg-sub">{questions.length} questions · {courses.length} courses · click a topic to filter instantly</div>
      </div>

      <div className="heatmap-hero">
        <div className="heatmap-hero-hd">
          <div className="card-ttl">Topic frequency map - click to filter</div>
          <div className="card-lnk" onClick={() => go('analytics')}>Full analytics →</div>
        </div>
        <div className="heatmap-grid">
          {topicCounts.length > 0 ? topicCounts.map(([topic, count], index) => (
            <div className={`hm ${heatmapIntensity(index)}`} style={topicFilter === topic ? {outline: '2px solid var(--gold)'} : {}} onClick={() => filterTopic(topic)} key={topic}>
              <div className="hm-name">{topic}</div>
              <div className="hm-count">{count}</div>
              <div className="hm-sub">questions</div>
            </div>
          )) : (
            <div className="note-absent-msg">Topic frequency appears after past questions are uploaded and indexed.</div>
          )}
        </div>
      </div>

      <div className="pills">
        <button className={`pill ${selectedCourseId === null ? 'on' : ''}`} onClick={() => selectCourse(null)}>All courses</button>
        {courses.map((course) => (
          <button className={`pill ${selectedCourseId === course.id ? 'on' : ''}`} onClick={() => selectCourse(course.id)} key={course.id}>
            {course.code} - {course.name}
          </button>
        ))}
      </div>

      {topicFilter && <div style={{fontSize: 12, color: 'var(--gold)', marginBottom: 12}}>Showing: {topicFilter} questions - click topic again to clear</div>}

      <div className="offline-actions">
        <button className="cta cta-ghost" onClick={saveOfflinePack} disabled={visibleQuestions.length === 0}>Save current pack offline</button>
        {offlineMessage && <span>{offlineMessage}</span>}
      </div>

      {loading && <div className="card">Loading past questions...</div>}
      {error && <div className="upload-alert">{error}</div>}
      {!loading && !error && visibleQuestions.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No past questions yet</div>
          <div className="empty-body">Upload a past question PDF and it will appear here after indexing.</div>
          <div className="empty-actions">
            <button className="cta" onClick={() => go('upload')}>Upload past question</button>
          </div>
        </div>
      )}

      {!loading && !error && visibleQuestions.map((question) => {
        const course = question.course_id ? courseById.get(question.course_id) : undefined;
        return (
          <div className="qd" onClick={() => onAskQuestion(question.content_text)} key={question.id}>
            <div className="qd-text">{question.content_text}</div>
            <div className="qd-meta">
              <span className={`tag ${difficultyClass(question.difficulty)}`}>{question.difficulty || 'Mixed'}</span>
              <div className="qi-yr">{question.year || 'Year unknown'}</div>
              <span className="qi-course" style={{fontSize: 12, color: 'var(--text3)'}}>{courseLabel(course, question)} · {questionTopic(question)}</span>
              <button className="ask-ai-btn" onClick={(event) => askQuestion(event, question)}>Ask AI →</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
