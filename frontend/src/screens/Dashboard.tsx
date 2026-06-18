import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AcademicMetadata, ScreenType, User } from '../types';
import { apiGet } from '../lib/api';

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
  completed_at: string;
};

type StudentAnalytics = {
  readiness: ReadinessEntry[];
  attempts: AttemptEntry[];
};

type MaterialEntry = {
  id: number;
  title?: string | null;
  topic?: string | null;
  year?: number | null;
  semester?: string | null;
  metadata_json?: AcademicMetadata | Record<string, unknown> | null;
};

type UploadedMaterial = {
  id: string;
  title: string;
  type: 'Past Question' | 'Lecture Note';
  meta: string;
};

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function timeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function readinessColor(score: number): string {
  if (score >= 80) return 'var(--teal)';
  if (score >= 50) return 'var(--gold)';
  return 'var(--coral)';
}

function metadataString(metadata: AcademicMetadata | Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata && typeof metadata === 'object' ? metadata[key as keyof typeof metadata] : null;
  return typeof value === 'string' ? value.trim() : '';
}

function titleFromMaterial(material: MaterialEntry, fallback: string): string {
  const metadata = material.metadata_json;
  return (
    metadataString(metadata, 'document_title') ||
    material.title ||
    material.topic ||
    metadataString(metadata, 'source_file') ||
    fallback
  );
}

function materialMeta(material: MaterialEntry): string {
  const metadata = material.metadata_json;
  const parts = [
    metadataString(metadata, 'course_code'),
    metadataString(metadata, 'academic_year') || (material.year ? String(material.year) : ''),
    material.semester || metadataString(metadata, 'semester'),
  ].filter(Boolean);
  return parts.join(' · ') || 'Uploaded academic material';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent practice';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function Dashboard({
  go,
  user,
}: {
  go: (s: ScreenType) => void;
  user: User | null;
  notifyUnavailable: (feature: string) => void;
}) {
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [materials, setMaterials] = useState<UploadedMaterial[]>([]);
  const [materialsLoaded, setMaterialsLoaded] = useState(false);
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    apiGet(`/analytics/student/${user.id}`)
      .then((data) => { if (!cancelled) setAnalytics(data as StudentAnalytics); })
      .catch(() => { if (!cancelled) setAnalytics({ readiness: [], attempts: [] }); });

    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    Promise.allSettled([
      apiGet(`/past-questions?uploaded_by=${user.id}`),
      apiGet(`/lecture-notes?uploaded_by=${user.id}`),
    ])
      .then(([pastQuestions, lectureNotes]) => {
        if (cancelled) return;
        const pqRows = pastQuestions.status === 'fulfilled' && Array.isArray(pastQuestions.value)
          ? pastQuestions.value as MaterialEntry[]
          : [];
        const noteRows = lectureNotes.status === 'fulfilled' && Array.isArray(lectureNotes.value)
          ? lectureNotes.value as MaterialEntry[]
          : [];
        const nextMaterials: UploadedMaterial[] = [
          ...pqRows.slice(0, 4).map((row) => ({
            id: `pq-${row.id}`,
            title: titleFromMaterial(row, 'Past question'),
            type: 'Past Question' as const,
            meta: materialMeta(row),
          })),
          ...noteRows.slice(0, 4).map((row) => ({
            id: `ln-${row.id}`,
            title: titleFromMaterial(row, 'Lecture note'),
            type: 'Lecture Note' as const,
            meta: materialMeta(row),
          })),
        ].slice(0, 5);
        setMaterials(nextMaterials);
      })
      .finally(() => {
        if (!cancelled) setMaterialsLoaded(true);
      });

    return () => { cancelled = true; };
  }, [user?.id]);

  const totalPracticed = useMemo(
    () => analytics?.attempts.reduce((sum, a) => sum + a.total_questions, 0) ?? 0,
    [analytics],
  );

  const avgScore = useMemo(() => {
    if (!analytics?.attempts.length) return null;
    const sum = analytics.attempts.reduce((acc, a) => acc + a.score, 0);
    return Math.round(sum / analytics.attempts.length);
  }, [analytics]);

  const masteredCount = useMemo(
    () => analytics?.readiness.filter((r) => r.score >= 80).length ?? 0,
    [analytics],
  );

  const inProgressCount = useMemo(
    () => analytics?.readiness.filter((r) => r.score >= 50 && r.score < 80).length ?? 0,
    [analytics],
  );

  const sessionCount = useMemo(() => analytics?.attempts.length ?? 0, [analytics]);

  const overallReadiness = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    const sum = analytics.readiness.reduce((acc, item) => acc + item.score, 0);
    return Math.round(sum / analytics.readiness.length);
  }, [analytics]);

  const weakestTopic = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    return [...analytics.readiness]
      .filter((r) => r.topic)
      .sort((a, b) => a.score - b.score)[0] ?? null;
  }, [analytics]);

  const topReadiness = useMemo(() => {
    if (!analytics?.readiness.length) return [];
    return [...analytics.readiness]
      .filter((r) => r.topic)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [analytics]);

  const recentAttempts = useMemo(() => {
    if (!analytics?.attempts.length) return [];
    return [...analytics.attempts]
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
      .slice(0, 4);
  }, [analytics]);

  const weekBars = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    analytics?.attempts.forEach((attempt) => {
      const date = new Date(attempt.completed_at);
      if (date >= weekStart) {
        const day = date.getDay();
        counts[day === 0 ? 6 : day - 1]++;
      }
    });

    const max = Math.max(...counts, 1);
    return counts.map((count) => ({ count, height: count ? Math.max(Math.round((count / max) * 64), 8) : 4 }));
  }, [analytics]);

  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();
  const hasUploads = materials.length > 0;
  const hasPracticeData = Boolean(analytics && analytics.attempts.length > 0);

  return (
    <div className="page dashboard-page" id="s-dashboard">
      <div className="pg-head dashboard-head">
        <div>
          <div className="pg-title">{timeOfDay()}, <em>{firstName}.</em></div>
          <div className="pg-sub">
            {hasPracticeData
              ? `${masteredCount} topics mastered · ${inProgressCount} in progress · ${sessionCount} practice sessions`
              : 'Your student dashboard is ready for uploaded materials, practice, and progress tracking.'}
          </div>
        </div>
        <div className="dashboard-head-actions">
          <button className="cta cta-ghost" onClick={() => go('search')}>Search archive</button>
          <button className="cta" onClick={() => go('upload')}>Upload material</button>
        </div>
      </div>

      <div className="focus-card dashboard-focus welcome-card">
        <div className="focus-left">
          <div className="focus-pill">Student dashboard · {todayLabel()}</div>
          <div className="focus-course">
            {weakestTopic
              ? <>Revise <em>{weakestTopic.topic}</em></>
              : hasUploads
                ? <>Generate practice from <em>uploaded materials</em></>
                : <>Build your <em>academic archive</em></>}
          </div>
          <div className="focus-meta">
            {weakestTopic
              ? `Current readiness is ${weakestTopic.score}%. Practice can help strengthen this topic.`
              : hasUploads
                ? 'Your uploads are ready for search, AI questions, and practice generation.'
                : 'Upload past questions or lecture notes to unlock cleaner search, AI retrieval, and practice.'}
          </div>
        </div>
        <div
          className="focus-right compact-readiness readiness-ring"
          style={{ '--ring-score': `${overallReadiness ?? 0}%` } as CSSProperties}
        >
          <div className="cd-unit">
            <span className="cd-num">{overallReadiness !== null ? overallReadiness : '--'}</span>
            <div className="cd-lbl">readiness</div>
          </div>
        </div>
        <button className="focus-cta" onClick={() => go(hasUploads ? 'practice' : 'upload')}>
          {hasUploads ? 'Start practice' : 'Upload first'}
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--gold)' }}></div>
          <div className="stat-lbl">Uploaded materials</div>
          <div className="stat-val" style={{ color: 'var(--gold)' }}>{materialsLoaded ? materials.length : '--'}</div>
          <div className="stat-delta">{hasUploads ? 'ready for retrieval' : 'add PDFs to begin'}</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--teal)' }}></div>
          <div className="stat-lbl">Questions practiced</div>
          <div className="stat-val" style={{ color: 'var(--teal)' }}>{totalPracticed}</div>
          <div className="stat-delta">across {sessionCount} session{sessionCount === 1 ? '' : 's'}</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--coral)' }}></div>
          <div className="stat-lbl">Average score</div>
          <div className="stat-val" style={{ color: 'var(--coral)' }}>{avgScore !== null ? `${avgScore}%` : '--'}</div>
          <div className="stat-delta">{avgScore !== null ? 'from completed practice' : 'no attempts yet'}</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--purple)' }}></div>
          <div className="stat-lbl">Topics tracked</div>
          <div className="stat-val" style={{ color: 'var(--purple)' }}>{analytics?.readiness.length ?? 0}</div>
          <div className="stat-delta">{masteredCount} mastered · {inProgressCount} in progress</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Recent uploads</div>
            <button className="card-lnk as-button" onClick={() => go('upload')}>Upload more</button>
          </div>
          {hasUploads ? (
            <div className="dashboard-list">
              {materials.map((material) => (
                <button className="dashboard-row" key={material.id} onClick={() => go('search')}>
                  <span className="dashboard-row-type">{material.type}</span>
                  <span className="dashboard-row-main">
                    <strong>{material.title}</strong>
                    <small>{material.meta}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              <div className="dashboard-empty-title">No uploaded materials yet</div>
              <p>Upload past questions or lecture notes to make ExamMind searchable and useful for AI retrieval.</p>
              <button className="cta" onClick={() => go('upload')}>Upload academic PDF</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">Topic readiness</div>
              <button className="card-lnk as-button" onClick={() => go('progress')}>Details</button>
            </div>
            <div className="prog-list">
              {topReadiness.length ? (
                topReadiness.map((entry) => (
                  <div key={entry.id}>
                    <div className="prog-top">
                      <span className="prog-nm">{entry.topic}</span>
                      <span className="prog-pct">{entry.score}%</span>
                    </div>
                    <div className="prog-track">
                      <div className="prog-fill" style={{ width: `${entry.score}%`, background: readinessColor(entry.score) }}></div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="dashboard-empty compact">
                  <div className="dashboard-empty-title">No readiness data yet</div>
                  <p>Complete practice sessions to build topic readiness and progress insights.</p>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-hd"><div className="card-ttl">This week</div></div>
            <div className="bar-chart">
              {weekBars.map((bar, index) => (
                <div className="bc-col" key={DAY_LABELS[index]}>
                  <div
                    className={`bc-bar${index === todayIdx ? ' on' : ''}`}
                    style={{ height: bar.height }}
                    title={`${bar.count} session${bar.count === 1 ? '' : 's'}`}
                  ></div>
                  <span className="bc-lbl">{DAY_LABELS[index]}</span>
                </div>
              ))}
            </div>
            <div className="dashboard-week-note">
              {weekBars.reduce((sum, bar) => sum + bar.count, 0)} session{weekBars.reduce((sum, bar) => sum + bar.count, 0) === 1 ? '' : 's'} this week
            </div>
          </div>
        </div>
      </div>

      <div className="two-col dashboard-bottom">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Recent practice</div>
            <button className="card-lnk as-button" onClick={() => go('practice')}>Practice</button>
          </div>
          {recentAttempts.length ? (
            <div className="dashboard-list">
              {recentAttempts.map((attempt) => (
                <div className="dashboard-row static" key={attempt.id}>
                  <span className="dashboard-row-type">{formatDate(attempt.completed_at)}</span>
                  <span className="dashboard-row-main">
                    <strong>{attempt.topic || 'Practice session'}</strong>
                    <small>{attempt.score}% · {attempt.total_questions} question{attempt.total_questions === 1 ? '' : 's'}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty compact">
              <div className="dashboard-empty-title">No practice attempts yet</div>
              <p>Start a practice session once you have uploaded enough academic material.</p>
            </div>
          )}
        </div>

        <div className="card dashboard-ai-card">
          <div className="card-hd"><div className="card-ttl">AI study insight</div></div>
          <p>
            {hasUploads
              ? 'Your uploaded academic materials can now ground search results, AI Assistant answers, and practice generation.'
              : 'Upload course materials first so the AI Assistant can answer from your academic archive instead of generic context.'}
          </p>
          <div className="dashboard-action-row">
            <button className="cta" onClick={() => go('assistant')}>Ask AI</button>
            <button className="cta cta-ghost" onClick={() => go('collab')}>Open study spaces</button>
          </div>
        </div>
      </div>
    </div>
  );
}
