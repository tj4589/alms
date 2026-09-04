import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileQuestion,
  FileText,
  FolderOpen,
  Search,
  Upload,
} from 'lucide-react';
import type { AcademicMetadata, ScreenType, User } from '../types';
import { apiGet } from '../lib/api';
import { WorkbenchEmpty, WorkbenchSection } from '../components/workbench/WorkbenchSection';
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
  const [archiveView, setArchiveView] = useState<'materials' | 'questions'>('materials');
  const [archiveQuery, setArchiveQuery] = useState('');

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
  }, [user?.id]);

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
      .filter((session) => session.starts_at)
      .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())
      .slice(0, 2);
  }, [studySessions]);

  const hasUploads = archiveItems.length > 0;
  const latestMaterial = archiveItems[0] || null;
  const visibleArchiveItems = archiveView === 'questions'
    ? archiveItems.filter((item) => item.kind === 'Past question').slice(0, 5)
    : archiveItems.slice(0, 5);
  const hasQueueItems = upcomingSessions.length > 0 || Boolean(weakestTopic) || Boolean(latestMaterial) || hasUploads;
  const hasRecentActivity = recentActivity.length > 0;

  const handleArchiveSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = archiveQuery.trim();
    if (query) onOpenSearch(query);
  };

  return (
    <div className="page workbench-page" id="s-dashboard">
      <header className="wb-page-head dashboard-command-head">
        <div>
          <p className="wb-date">{todayLabel()}</p>
          <h1>{timeOfDay()}, {firstName}.</h1>
          <p className="wb-page-intro">
            {weakestTopic
              ? <>Your next priority is <strong>{weakestTopic.topic}</strong>.</>
              : hasUploads
                ? 'Your academic archive is ready to study.'
                : 'Start by adding material from one of your courses.'}
          </p>
        </div>
        <div className="wb-head-actions">
          {hasUploads && (
            <button type="button" className="wb-button wb-button-secondary" onClick={() => go('search')}>
              <Search aria-hidden="true" />
              Search archive
            </button>
          )}
          <button type="button" className="wb-button wb-button-primary" onClick={() => go('upload')}>
            <Upload aria-hidden="true" />
            Upload material
          </button>
        </div>
      </header>

      <section className={`dashboard-next-panel ${hasUploads ? 'has-sources' : 'is-empty'}`} aria-labelledby="dashboard-next-title">
        <div className="dashboard-next-copy">
          <p className="dashboard-next-label">Next study action</p>
          <h2 id="dashboard-next-title">
            {loading
              ? 'Preparing your workspace'
              : weakestTopic
                ? <>Strengthen <em>{weakestTopic.topic}</em></>
                : hasUploads
                  ? 'Build your first readiness signal'
                  : 'Start with one course source'}
          </h2>
          <p>
            {loading
              ? 'Checking your courses, indexed material, and practice record.'
              : weakestTopic
                ? `${weakestTopic.topic} is your lowest tracked topic at ${weakestTopic.score}% readiness.`
                : hasUploads
                  ? 'Your material is indexed. Complete a focused practice session to begin measuring topic readiness.'
                  : 'Upload lecture notes or a past question. ExamMind will organise it into a course workspace you can search and practise from.'}
          </p>
          {!loading && (
            <button type="button" className="dashboard-next-action" onClick={() => go(hasUploads ? 'practice' : 'upload')}>
              {weakestTopic ? 'Practise this topic' : hasUploads ? 'Start practice' : 'Upload course material'}
              <ArrowRight aria-hidden="true" />
            </button>
          )}

          {!loading && (overallReadiness !== null || archiveItems.length > 0 || (analytics?.attempts.length || 0) > 0) && (
            <dl className="dashboard-next-evidence" aria-label="Current study evidence">
              {overallReadiness !== null && <div><dt>Overall readiness</dt><dd>{overallReadiness}%</dd></div>}
              {archiveItems.length > 0 && <div><dt>Indexed sources</dt><dd>{archiveItems.length}</dd></div>}
              {(analytics?.attempts.length || 0) > 0 && <div><dt>Practice sessions</dt><dd>{analytics?.attempts.length}</dd></div>}
            </dl>
          )}
        </div>

        <div className="dashboard-document-stack" aria-label={hasUploads ? `${archiveItems.length} indexed academic sources` : 'No academic sources indexed yet'}>
          <span className="dashboard-document-sheet sheet-back" aria-hidden="true" />
          <span className="dashboard-document-sheet sheet-middle" aria-hidden="true" />
          <div className="dashboard-document-sheet sheet-front">
            <FileText aria-hidden="true" />
            <small>{hasUploads ? 'Academic archive' : 'New workspace'}</small>
            <strong>{hasUploads ? `${archiveItems.length} source${archiveItems.length === 1 ? '' : 's'} indexed` : 'Waiting for your first source'}</strong>
            <span>{hasUploads && latestMaterial ? shorten(latestMaterial.title, 42) : 'PDF / scan / lecture note'}</span>
          </div>
        </div>
      </section>

      {hasUploads && (
        <form className="dashboard-archive-command" onSubmit={handleArchiveSearch}>
          <label htmlFor="archive-grounded-search">Search your sources</label>
          <div className="wb-search-control">
            <Search aria-hidden="true" />
            <input
              id="archive-grounded-search"
              type="search"
              value={archiveQuery}
              onChange={(event) => setArchiveQuery(event.target.value)}
              placeholder="Course, topic, lecturer, or past question"
              required
            />
            <button type="submit" aria-label="Search your academic archive" title="Search archive">
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
          <span>Grounded in your indexed material</span>
        </form>
      )}

      <div className={`dashboard-workspace-grid ${hasQueueItems ? '' : 'is-single'}`}>
        <WorkbenchSection
          id="course-workspaces"
          index="01"
          title="Your courses"
          description="Sources, past questions, and current readiness."
          action={hasUploads ? (
            <button type="button" className="wb-text-action" onClick={() => go('search')}>
              View archive <ArrowRight aria-hidden="true" />
            </button>
          ) : undefined}
        >
          {loading ? (
            <div className="wb-loading-list" aria-label="Loading course workspaces">
              <span></span><span></span><span></span>
            </div>
          ) : courseWorkspaces.length ? (
            <div className="wb-course-list">
              {courseWorkspaces.map((course) => (
                <button
                  type="button"
                  className="wb-course-row"
                  key={course.id}
                  onClick={() => onOpenSearch(course.code === 'Archive' ? course.name : course.code)}
                >
                  <span className="wb-course-code">{course.code}</span>
                  <span className="wb-course-main">
                    <strong>{course.name}</strong>
                    <small>
                      {course.materialCount} source{course.materialCount === 1 ? '' : 's'} / {course.questionCount} past question{course.questionCount === 1 ? '' : 's'}
                    </small>
                  </span>
                  <span className="wb-course-status">
                    <small>{course.lastActiveAt ? `Active ${formatShortDate(course.lastActiveAt)}` : 'Ready to begin'}</small>
                    <strong>{course.readiness !== null ? `${course.readiness}%` : '--'}</strong>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-course-empty">
              <div className="dashboard-folder-stack" aria-hidden="true"><span /><span /><span /></div>
              <div>
                <strong>No course workspaces yet</strong>
                <p>Your first uploaded document will create one automatically.</p>
              </div>
              <button type="button" className="wb-inline-action" onClick={() => go('upload')}>Add a source</button>
            </div>
          )}
        </WorkbenchSection>

        {hasQueueItems && (
          <WorkbenchSection
            id="academic-queue"
            index="02"
            title="Study agenda"
            description="Upcoming sessions and useful follow-ups."
            className="wb-queue-section"
          >
            <div className="wb-queue-list">
            {upcomingSessions.map((session) => (
              <button type="button" className="wb-queue-row" key={`session-${session.id}`} onClick={() => go('groups')}>
                <span className="wb-queue-icon"><CalendarDays aria-hidden="true" /></span>
                <span>
                  <small>{formatSchedule(session.starts_at)}</small>
                  <strong>{session.title}</strong>
                  <em>{session.exam_goal || session.topic || 'Scheduled study session'}</em>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            ))}

            {weakestTopic ? (
              <button type="button" className="wb-queue-row" onClick={() => go('practice')}>
                <span className="wb-queue-icon"><ClipboardCheck aria-hidden="true" /></span>
                <span>
                  <small>Recommended next</small>
                  <strong>Practice {weakestTopic.topic}</strong>
                  <em>{weakestTopic.score}% readiness / strengthen before review</em>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="wb-queue-row" onClick={() => go(hasUploads ? 'practice' : 'upload')}>
                <span className="wb-queue-icon">{hasUploads ? <ClipboardCheck aria-hidden="true" /> : <Upload aria-hidden="true" />}</span>
                <span>
                  <small>Recommended next</small>
                  <strong>{hasUploads ? 'Complete your first practice set' : 'Add your first academic source'}</strong>
                  <em>{hasUploads ? 'Build a readiness baseline from indexed material' : 'Lecture notes and past questions work best'}</em>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            )}

            {latestMaterial && (
              <button type="button" className="wb-queue-row" onClick={() => onOpenSearch(latestMaterial.courseCode)}>
                <span className="wb-queue-icon"><FolderOpen aria-hidden="true" /></span>
                <span>
                  <small>Archive follow-up</small>
                  <strong>{shorten(latestMaterial.title, 54)}</strong>
                  <em>Search and review the latest indexed source</em>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            )}
            </div>
          </WorkbenchSection>
        )}
      </div>

      {(hasUploads || hasRecentActivity) && (
      <div className={`dashboard-secondary-grid ${hasUploads && hasRecentActivity ? '' : 'is-single'}`}>
        {hasUploads && <WorkbenchSection
          id="archive-evidence"
          index="03"
          title="Recently indexed"
          description="Material available to search and practise from."
          action={(
            <div className="wb-view-tabs" role="tablist" aria-label="Archive view">
              <button
                type="button"
                role="tab"
                aria-selected={archiveView === 'materials'}
                className={archiveView === 'materials' ? 'is-active' : ''}
                onClick={() => setArchiveView('materials')}
              >
                Materials <span>{archiveItems.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={archiveView === 'questions'}
                className={archiveView === 'questions' ? 'is-active' : ''}
                onClick={() => setArchiveView('questions')}
              >
                Past questions <span>{pastQuestions.length}</span>
              </button>
            </div>
          )}
        >
          {loading ? (
            <div className="wb-loading-list" aria-label="Loading archive sources">
              <span></span><span></span><span></span>
            </div>
          ) : visibleArchiveItems.length ? (
            <div className="wb-archive-list" role="tabpanel">
              {visibleArchiveItems.map((item) => (
                <button type="button" className="wb-archive-row" key={item.id} onClick={() => onOpenSearch(item.courseCode)}>
                  <span className="wb-file-icon">
                    {item.kind === 'Past question' ? <FileQuestion aria-hidden="true" /> : <FileText aria-hidden="true" />}
                  </span>
                  <span className="wb-archive-main">
                    <small>{item.courseCode} / {item.kind}</small>
                    <strong>{item.title}</strong>
                    <em>{item.meta}</em>
                  </span>
                  <span className="wb-archive-date">{formatShortDate(item.createdAt)}</span>
                  <ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <WorkbenchEmpty
              icon={archiveView === 'questions' ? FileQuestion : FolderOpen}
              title={archiveView === 'questions' ? 'No past questions indexed' : 'Your archive is empty'}
              body={archiveView === 'questions'
                ? 'Upload a past paper to unlock exam-style retrieval and practice generation.'
                : 'Add lecture notes or past questions to create a source-grounded study archive.'}
              action={<button type="button" className="wb-inline-action" onClick={() => go('upload')}>Upload PDF</button>}
            />
          )}
        </WorkbenchSection>}

        {hasRecentActivity && <WorkbenchSection
          id="recent-activity"
          index="04"
          title="Activity"
          description="Uploads and completed practice, in order."
          action={(
            <button type="button" className="wb-text-action" onClick={() => go('progress')}>
              Progress <ArrowRight aria-hidden="true" />
            </button>
          )}
        >
          {loading ? (
            <div className="wb-loading-list" aria-label="Loading recent activity">
              <span></span><span></span><span></span>
            </div>
          ) : recentActivity.length ? (
            <ol className="wb-activity-list">
              {recentActivity.map((activity) => {
                const ActivityIcon = activity.icon;
                return (
                  <li key={activity.id}>
                    <span className="wb-activity-marker"><ActivityIcon aria-hidden="true" /></span>
                    <span>
                      <small>{activity.type} / {formatShortDate(activity.date)}</small>
                      <strong>{activity.title}</strong>
                      <em>{activity.meta}</em>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <WorkbenchEmpty
              icon={ClipboardCheck}
              title="No study activity yet"
              body="Uploads and completed practice sessions will appear here in chronological order."
              action={<button type="button" className="wb-inline-action" onClick={() => go('upload')}>Start with an upload</button>}
            />
          )}
        </WorkbenchSection>}
      </div>
      )}
    </div>
  );
}
