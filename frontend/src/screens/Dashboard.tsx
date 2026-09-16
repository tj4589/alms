import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileQuestion,
  FileText,
  FolderOpen,
  MessageCircle,
  Plus,
} from 'lucide-react';
import type { AcademicMetadata, ScreenType, User } from '../types';
import { apiGet } from '../lib/api';

import './Dashboard.css';

type ReadinessEntry = {
  id: number;
  topic: string | null;
  score: number;
  course_id: number | null;
};

type AttemptEntry = {
  id: number;
  score: number;
  total_questions: number;
  topic: string | null;
  course_id: number | null;
  completed_at: string;
};

type StudentAnalytics = {
  readiness: ReadinessEntry[];
  attempts: AttemptEntry[];
};

type CourseEntry = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
};

type MaterialEntry = {
  id: number;
  title?: string | null;
  topic?: string | null;
  content_text?: string | null;
  year?: number | null;
  semester?: string | null;
  course_id?: number | null;
  uploaded_by?: number | null;
  created_at?: string | null;
  metadata_json?: AcademicMetadata | Record<string, unknown> | null;
};

type StudySessionEntry = {
  id: number;
  title: string;
  topic?: string | null;
  exam_goal?: string | null;
  course_id?: number | null;
  starts_at?: string | null;
  status?: string | null;
};

type ArchiveItem = {
  id: string;
  kind: 'Past question' | 'Lecture note';
  title: string;
  courseCode: string;
  meta: string;
  courseId: number | null;
  createdAt: string | null;
};

type CourseWorkspace = {
  id: string;
  code: string;
  name: string;
  materialCount: number;
  questionCount: number;
  readiness: number | null;
  lastActiveAt: string | null;
};

function timeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function metadataString(
  metadata: AcademicMetadata | Record<string, unknown> | null | undefined,
  key: string,
): string {
  const value = metadata && typeof metadata === 'object'
    ? metadata[key as keyof typeof metadata]
    : null;
  return typeof value === 'string' ? value.trim() : '';
}

function shorten(value: string, max = 86): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function materialTitle(material: MaterialEntry, kind: ArchiveItem['kind']): string {
  const metadata = material.metadata_json;
  return (
    metadataString(metadata, 'document_title') ||
    material.title ||
    material.topic ||
    (material.content_text ? shorten(material.content_text) : '') ||
    (kind === 'Past question' ? 'Uploaded past question' : 'Uploaded lecture note')
  );
}

function materialMeta(material: MaterialEntry): string {
  const metadata = material.metadata_json;
  const parts = [
    metadataString(metadata, 'academic_year') || (material.year ? String(material.year) : ''),
    material.semester || metadataString(metadata, 'semester'),
    metadataString(metadata, 'document_type').replaceAll('_', ' '),
  ].filter(Boolean);
  return parts.join(' / ') || 'Indexed academic source';
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return 'Recently added';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently added';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatSchedule(value: string | null | undefined): string {
  if (!value) return 'Schedule pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Schedule pending';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Dashboard({
  go,
  user,
  onOpenSearch,
}: {
  go: (screen: ScreenType) => void;
  user: User | null;
  onOpenSearch: (query: string) => void;
}) {
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [courses, setCourses] = useState<CourseEntry[]>([]);
  const [pastQuestions, setPastQuestions] = useState<MaterialEntry[]>([]);
  const [lectureNotes, setLectureNotes] = useState<MaterialEntry[]>([]);
  const [studySessions, setStudySessions] = useState<StudySessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openedAt] = useState(() => Date.now());
  const [archiveView, setArchiveView] = useState<'materials' | 'questions'>('materials');
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const firstName = user?.name?.split(' ')[0] || 'student';

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    Promise.allSettled([
      apiGet(`/analytics/student/${user.id}`),
      apiGet('/courses'),
      apiGet(`/past-questions?uploaded_by=${user.id}`),
      apiGet(`/lecture-notes?uploaded_by=${user.id}`),
      apiGet('/study-sessions?active_only=true'),
    ]).then(([analyticsResult, coursesResult, questionsResult, notesResult, sessionsResult]) => {
      if (cancelled) return;
      setLoadError([analyticsResult, coursesResult, questionsResult, notesResult, sessionsResult].some(result => result.status === 'rejected'));
      setAnalytics(
        analyticsResult.status === 'fulfilled'
          ? analyticsResult.value as StudentAnalytics
          : { readiness: [], attempts: [] },
      );
      setCourses(
        coursesResult.status === 'fulfilled' && Array.isArray(coursesResult.value)
          ? coursesResult.value as CourseEntry[]
          : [],
      );
      setPastQuestions(
        questionsResult.status === 'fulfilled' && Array.isArray(questionsResult.value)
          ? questionsResult.value as MaterialEntry[]
          : [],
      );
      setLectureNotes(
        notesResult.status === 'fulfilled' && Array.isArray(notesResult.value)
          ? notesResult.value as MaterialEntry[]
          : [],
      );
      setStudySessions(
        sessionsResult.status === 'fulfilled' && Array.isArray(sessionsResult.value)
          ? sessionsResult.value as StudySessionEntry[]
          : [],
      );
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [user?.id, retryKey]);

  const courseById = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses],
  );

  const archiveItems = useMemo<ArchiveItem[]>(() => {
    const toItem = (material: MaterialEntry, kind: ArchiveItem['kind']): ArchiveItem => {
      const course = material.course_id ? courseById.get(material.course_id) : null;
      const courseCode = metadataString(material.metadata_json, 'course_code') || course?.code || 'Archive';
      return {
        id: `${kind === 'Past question' ? 'pq' : 'ln'}-${material.id}`,
        kind,
        title: materialTitle(material, kind),
        courseCode,
        meta: materialMeta(material),
        courseId: material.course_id || null,
        createdAt: material.created_at || null,
      };
    };

    return [
      ...pastQuestions.map((item) => toItem(item, 'Past question')),
      ...lectureNotes.map((item) => toItem(item, 'Lecture note')),
    ].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [courseById, lectureNotes, pastQuestions]);

  const courseWorkspaces = useMemo<CourseWorkspace[]>(() => {
    const workspaceMap = new Map<string, CourseWorkspace & { readinessScores: number[] }>();

    const ensureWorkspace = (courseId: number | null, fallbackCode = 'Archive') => {
      const course = courseId ? courseById.get(courseId) : null;
      const code = course?.code || fallbackCode;
      const key = courseId ? `course-${courseId}` : `code-${code}`;
      if (!workspaceMap.has(key)) {
        workspaceMap.set(key, {
          id: key,
          code,
          name: course?.name || (code === 'Archive' ? 'Unsorted academic sources' : code),
          materialCount: 0,
          questionCount: 0,
          readiness: null,
          readinessScores: [],
          lastActiveAt: null,
        });
      }
      return workspaceMap.get(key)!;
    };

    archiveItems.forEach((item) => {
      const workspace = ensureWorkspace(item.courseId, item.courseCode);
      workspace.materialCount += 1;
      if (item.kind === 'Past question') workspace.questionCount += 1;
      if (item.createdAt && (!workspace.lastActiveAt || item.createdAt > workspace.lastActiveAt)) {
        workspace.lastActiveAt = item.createdAt;
      }
    });

    analytics?.readiness.forEach((entry) => {
      if (!entry.course_id) return;
      const workspace = ensureWorkspace(entry.course_id);
      workspace.readinessScores.push(entry.score);
    });

    analytics?.attempts.forEach((attempt) => {
      if (!attempt.course_id) return;
      const workspace = ensureWorkspace(attempt.course_id);
      if (!workspace.lastActiveAt || attempt.completed_at > workspace.lastActiveAt) {
        workspace.lastActiveAt = attempt.completed_at;
      }
    });

    return [...workspaceMap.values()]
      .map(({ readinessScores, ...workspace }) => ({
        ...workspace,
        readiness: readinessScores.length
          ? Math.round(readinessScores.reduce((sum, score) => sum + score, 0) / readinessScores.length)
          : null,
      }))
      .sort((a, b) => {
        const activityDelta = (b.materialCount + b.questionCount) - (a.materialCount + a.questionCount);
        if (activityDelta) return activityDelta;
        return a.code.localeCompare(b.code);
      })
      .slice(0, 5);
  }, [analytics, archiveItems, courseById]);

  const weakestTopic = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    return [...analytics.readiness]
      .filter((entry) => entry.topic)
      .sort((a, b) => a.score - b.score)[0] || null;
  }, [analytics]);

  const overallReadiness = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    return Math.round(
      analytics.readiness.reduce((sum, entry) => sum + entry.score, 0) / analytics.readiness.length,
    );
  }, [analytics]);

  const recentActivity = useMemo(() => {
    const materialActivity = archiveItems.map((item) => ({
      id: `material-${item.id}`,
      type: item.kind,
      title: item.title,
      meta: `${item.courseCode} / ${item.meta}`,
      date: item.createdAt,
      icon: item.kind === 'Past question' ? FileQuestion : FileText,
    }));
    const practiceActivity = (analytics?.attempts || []).map((attempt) => ({
      id: `attempt-${attempt.id}`,
      type: 'Practice',
      title: attempt.topic ? `Practiced ${attempt.topic}` : 'Completed practice session',
      meta: `${attempt.score}% score / ${attempt.total_questions} question${attempt.total_questions === 1 ? '' : 's'}`,
      date: attempt.completed_at,
      icon: ClipboardCheck,
    }));

    return [...materialActivity, ...practiceActivity]
      .sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 6);
  }, [analytics, archiveItems]);

  const upcomingSessions = useMemo(() => {
    return studySessions
      .filter((session) => session.starts_at && new Date(session.starts_at).getTime() >= openedAt)
      .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())
      .slice(0, 2);
  }, [studySessions, openedAt]);

  const hasUploads = archiveItems.length > 0;
  const latestMaterial = archiveItems[0] || null;
  const visibleArchiveItems = archiveView === 'questions'
    ? archiveItems.filter((item) => item.kind === 'Past question').slice(0, 5)
    : archiveItems.slice(0, 5);

  const retry = () => {
    setLoading(true);
    setLoadError(false);
    setRetryKey(key => key + 1);
  };

  return (
    <div className="page workbench-page student-desk" id="s-dashboard">
      <header className="desk-heading">
        <div>
          <h1>{timeOfDay()}, {firstName}<span>.</span></h1>
          <p>A little focus. A little progress. Your own pace.</p>
        </div>
        <span className="desk-date"><CalendarDays size={16} aria-hidden="true" />{todayLabel()}</span>
      </header>

      {loadError && !loading && (
        <div className="desk-error" role="alert">
          <div><strong>We couldn’t load everything.</strong><span>Your saved work hasn’t changed. Reconnect and try again.</span></div>
          <button type="button" onClick={retry}>Try again <ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      )}

      <div className="desk-layout">
        <div className="desk-main">
          <section className="desk-next" aria-labelledby="desk-next-title" aria-busy={loading}>
            <div className="desk-next-copy">
              <h2 id="desk-next-title">{loading ? 'Getting your desk ready…' : weakestTopic ? <>A little more practice<br />with {weakestTopic.topic}.</> : hasUploads ? 'Pick up where you left off.' : loadError ? 'Your study space is right here.' : <>Big semester.<br />One small start.</>}</h2>
              <p>{loading ? 'Gathering your courses, notes and recent practice.' : weakestTopic ? `Your latest readiness for this topic is ${weakestTopic.score}%. Make room for a quick practice session.` : hasUploads ? 'Your notes are here. Turn what you’ve learned into something that sticks.' : loadError ? 'You can still add material or find your study group while we reconnect.' : 'Bring a lecture note or a past paper. We’ll help you find answers, make connections and get ready for what’s next.'}</p>
              {!loading && <button type="button" className="desk-primary" onClick={() => go(hasUploads ? 'practice' : 'upload')}>{hasUploads ? 'Let’s practise' : 'Add your first material'}<ArrowRight size={18} aria-hidden="true" /></button>}
            </div>
            <div className="desk-next-side">
              {hasUploads ? (
                <div className="desk-resume">
                  <FileText size={23} strokeWidth={1.5} aria-hidden="true" />
                  <span>Last added to your desk</span>
                  <strong>{shorten(latestMaterial!.title, 62)}</strong>
                  <button type="button" onClick={() => onOpenSearch(latestMaterial!.courseCode)}>Open materials <ArrowRight size={16} aria-hidden="true" /></button>
                </div>
              ) : (
                <ol className="desk-start-steps" aria-label="How to get started">
                  <li><span>1</span><div><strong>Bring your material</strong><small>Notes, PDFs or past questions</small></div></li>
                  <li><span>2</span><div><strong>Make sense of it</strong><small>Search, ask and connect the dots</small></div></li>
                  <li><span>3</span><div><strong>Give it a go</strong><small>Practise at your own pace</small></div></li>
                </ol>
              )}
            </div>
          </section>

          {hasUploads && <div className="desk-summary" aria-label="Your study overview">
            <span><strong>{archiveItems.length}</strong> saved material{archiveItems.length === 1 ? '' : 's'}</span>
            <span><strong>{analytics?.attempts.length || 0}</strong> practice session{analytics?.attempts.length === 1 ? '' : 's'}</span>
            {overallReadiness !== null && <span><strong>{overallReadiness}%</strong> overall readiness</span>}
          </div>}

          <section className="desk-section" aria-labelledby="desk-courses-title">
            <header className="desk-section-head"><h2 id="desk-courses-title">Your courses</h2><button type="button" className="desk-text-button" onClick={() => go('upload')}><Plus size={16} aria-hidden="true" />Add material</button></header>
            {loading ? <div className="desk-loading" role="status">Loading your courses…</div> : courseWorkspaces.length ? (
              <div className="desk-course-grid">{courseWorkspaces.map((course) => (
                <button type="button" className="desk-course" key={course.id} onClick={() => onOpenSearch(course.code === 'Archive' ? course.name : course.code)}>
                  <span className="desk-course-top"><span>{course.code}</span><ArrowRight size={18} aria-hidden="true" /></span>
                  <strong>{course.name}</strong>
                  <small>{course.materialCount} material{course.materialCount === 1 ? '' : 's'} · {course.questionCount} past question{course.questionCount === 1 ? '' : 's'}</small>
                  {course.readiness !== null && <span className="desk-course-readiness">{course.readiness}% readiness</span>}
                </button>
              ))}</div>
            ) : <div className="desk-course-empty">
              <FolderOpen size={27} strokeWidth={1.4} aria-hidden="true" />
              <h3>{loadError ? 'Your courses couldn’t be loaded' : 'A home for every course.'}</h3>
              <p>{loadError ? 'Try reconnecting to see your saved materials.' : 'Add your first material and we’ll organise it by course. Less searching through chats. More time to understand.'}</p>
              <button type="button" className="desk-outline" onClick={loadError ? retry : () => go('upload')}>{loadError ? 'Reload courses' : 'Upload course material'}<ArrowRight size={16} aria-hidden="true" /></button>
              {!loadError && <span className="desk-file-hint">Lecture notes · Past questions · Scanned PDFs</span>}
            </div>}
          </section>

          {hasUploads && <section className="desk-section" aria-labelledby="desk-materials-title">
            <header className="desk-section-head"><h2 id="desk-materials-title">On your desk</h2><button type="button" className="desk-text-button" onClick={() => go('search')}>View all <ArrowRight size={16} aria-hidden="true" /></button></header>
            <div className="desk-filters" role="group" aria-label="Filter materials">
              <button type="button" aria-pressed={archiveView === 'materials'} onClick={() => setArchiveView('materials')}>All materials <span>{archiveItems.length}</span></button>
              <button type="button" aria-pressed={archiveView === 'questions'} onClick={() => setArchiveView('questions')}>Past questions <span>{pastQuestions.length}</span></button>
            </div>
            <div className="desk-materials">
              {visibleArchiveItems.length ? visibleArchiveItems.map(item => <button type="button" className="desk-material" key={item.id} onClick={() => onOpenSearch(item.courseCode)}>
                {item.kind === 'Past question' ? <FileQuestion size={21} strokeWidth={1.5} aria-hidden="true" /> : <FileText size={21} strokeWidth={1.5} aria-hidden="true" />}
                <span><strong>{item.title}</strong><small>{item.courseCode} · {item.kind}</small></span><time>{formatShortDate(item.createdAt)}</time><ArrowRight size={16} aria-hidden="true" />
              </button>) : <p className="desk-muted">No past questions yet. Add one when you’re ready to practise.</p>}
            </div>
          </section>}

          {!hasUploads && !loading && !loadError && <section className="desk-shortcuts" aria-label="Other ways to get started">
            <button type="button" onClick={() => go('assistant')}><MessageCircle size={21} strokeWidth={1.5} aria-hidden="true" /><span><strong>Stuck on a topic?</strong><small>Talk it through with your study assistant.</small></span><ArrowRight size={17} aria-hidden="true" /></button>
            <button type="button" onClick={() => go('questions')}><FileQuestion size={21} strokeWidth={1.5} aria-hidden="true" /><span><strong>See what’s been asked</strong><small>Explore the past question library.</small></span><ArrowRight size={17} aria-hidden="true" /></button>
          </section>}
        </div>

        <aside className="desk-aside" aria-label="Study together and recent activity">
          <section className="desk-together" aria-labelledby="desk-together-title">
            <div className="desk-together-photo"><img src="/images/landing/study-together.jpg" alt="Students sharing notes and studying together" /></div>
            <div className="desk-together-copy"><h2 id="desk-together-title">Better, together.</h2><p>For the “wait, how did you get that?” moments. Find your people and figure it out together.</p>
              <button type="button" onClick={() => go('groups')}>Find a study group <ArrowRight size={17} aria-hidden="true" /></button>
            </div>
            <button type="button" className="desk-discussions" onClick={() => go('collab')}><MessageCircle size={17} aria-hidden="true" />Join the conversation<ArrowRight size={15} aria-hidden="true" /></button>
          </section>

          <section className="desk-agenda" aria-labelledby="desk-agenda-title">
            <header className="desk-section-head"><h2 id="desk-agenda-title">Coming up</h2><CalendarDays size={18} strokeWidth={1.5} aria-hidden="true" /></header>
            {loading ? <p className="desk-muted" role="status">Checking your sessions…</p> : upcomingSessions.length ? upcomingSessions.map(session => <button className="desk-session" type="button" key={session.id} onClick={() => go('groups')}><small>{formatSchedule(session.starts_at)}</small><strong>{session.title}</strong><span>{session.topic || session.exam_goal || 'Study session'}<ArrowRight size={15} aria-hidden="true" /></span></button>) : <><p className="desk-muted">{loadError ? 'We couldn’t check your upcoming sessions.' : 'No study sessions on the calendar yet. Make time to work through a topic with your group.'}</p><button type="button" className="desk-text-button" onClick={() => go('groups')}>Go to study groups <ArrowRight size={16} aria-hidden="true" /></button></>}
          </section>

          {recentActivity.length > 0 && <section className="desk-activity" aria-labelledby="desk-activity-title"><header className="desk-section-head"><h2 id="desk-activity-title">Small steps add up</h2></header><ol>{recentActivity.slice(0, 3).map(activity => <li key={activity.id}><activity.icon size={16} aria-hidden="true" /><div><strong>{activity.title}</strong><small>{activity.type} · {formatShortDate(activity.date)}</small></div></li>)}</ol><button type="button" className="desk-text-button" onClick={() => go('progress')}>Your progress <ArrowRight size={16} aria-hidden="true" /></button></section>}
        </aside>
      </div>
    </div>
  );
}
