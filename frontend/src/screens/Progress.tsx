import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ClipboardCheck,
  FileQuestion,
  RefreshCw,
} from 'lucide-react';
import type { ScreenType } from '../types';
import { apiGet } from '../lib/api';
import './Progress.css';

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

type LoadState = 'loading' | 'empty' | 'error' | 'ready';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function topicLabel(value: string | null): string {
  const topic = value?.trim();
  return topic || 'Mixed revision';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function Progress({ go, userId }: { go: (screen: ScreenType) => void; userId: number | null }) {
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    apiGet(`/analytics/student/${userId}`)
      .then((data) => {
        if (cancelled) return;
        const next = data as StudentAnalytics;
        const normalized = {
          readiness: Array.isArray(next.readiness) ? next.readiness : [],
          attempts: Array.isArray(next.attempts) ? next.attempts : [],
        };
        setAnalytics(normalized);
        setLoadState(normalized.readiness.length || normalized.attempts.length ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });

    return () => { cancelled = true; };
  }, [requestVersion, userId]);

  const topicReadiness = useMemo(() => {
    if (!analytics) return [];
    return analytics.readiness
      .filter((entry) => entry.topic?.trim())
      .map((entry) => ({ ...entry, topic: topicLabel(entry.topic), score: clampScore(entry.score) }))
      .sort((a, b) => a.score - b.score || a.topic.localeCompare(b.topic));
  }, [analytics]);

  const weakestTopic = topicReadiness[0] ?? null;
  const nextWeakestTopic = topicReadiness[1] ?? null;

  const overallReadiness = useMemo(() => {
    if (!topicReadiness.length) return null;
    return Math.round(topicReadiness.reduce((sum, entry) => sum + entry.score, 0) / topicReadiness.length);
  }, [topicReadiness]);

  const recentAttempts = useMemo(() => {
    if (!analytics) return [];
    return [...analytics.attempts]
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
      .slice(0, 6);
  }, [analytics]);

  const totalQuestions = useMemo(
    () => analytics?.attempts.reduce((sum, attempt) => sum + Math.max(0, attempt.total_questions || 0), 0) ?? 0,
    [analytics],
  );

  const retry = () => {
    setLoadState('loading');
    setRequestVersion((version) => version + 1);
  };

  return (
    <div className="page progress-report" id="s-progress">
      <header className="progress-report-head">
        <div>
          <p className="progress-report-kicker">Personal study record</p>
          <h1>Progress</h1>
          <p>Readiness is calculated from your completed practice and changes as you submit new results.</p>
        </div>
      </header>

      {!userId ? (
        <section className="progress-state" aria-labelledby="progress-private-title">
          <AlertCircle aria-hidden="true" />
          <div>
            <h2 id="progress-private-title">Your progress is private</h2>
            <p>Sign in to view readiness and practice history associated with your account.</p>
          </div>
        </section>
      ) : loadState === 'loading' ? (
        <section className="progress-loading" aria-label="Loading your progress" aria-live="polite">
          <div className="progress-loading-lead" />
          <div className="progress-loading-line" />
          <div className="progress-loading-table"><span /><span /><span /></div>
        </section>
      ) : loadState === 'error' ? (
        <section className="progress-state progress-state-error" aria-labelledby="progress-error-title" role="alert">
          <AlertCircle aria-hidden="true" />
          <div>
            <h2 id="progress-error-title">Your progress could not be loaded</h2>
            <p>Your study record is still safe. Try loading this page again.</p>
            <button type="button" onClick={retry}><RefreshCw aria-hidden="true" /> Try again</button>
          </div>
        </section>
      ) : loadState === 'empty' ? (
        <section className="progress-state progress-state-empty" aria-labelledby="progress-empty-title">
          <ClipboardCheck aria-hidden="true" />
          <div>
            <p className="progress-state-label">No progress data yet</p>
            <h2 id="progress-empty-title">Complete a practice session to establish your first readiness score.</h2>
            <p>Choose a topic, answer the generated questions, and submit the session. ExamMind will use that result to begin your topic progress record.</p>
            <button type="button" onClick={() => go('practice')}>Start practice <ArrowRight aria-hidden="true" /></button>
          </div>
        </section>
      ) : analytics ? (
        <>
          <section className="progress-decision" aria-labelledby="progress-decision-title">
            <div className="progress-decision-copy">
              <p className="progress-section-label">What to study next</p>
              {weakestTopic ? (
                <>
                  <h2 id="progress-decision-title">Review <em>{weakestTopic.topic}</em></h2>
                  <p>
                    {nextWeakestTopic
                      ? `At ${weakestTopic.score}%, this is your lowest readiness result. Your next-lowest topic is ${nextWeakestTopic.topic} at ${nextWeakestTopic.score}%.`
                      : `At ${weakestTopic.score}%, this is your only tracked topic readiness result.`}
                    {' '}Practise it again to measure whether your understanding has improved.
                  </p>
                  <button type="button" onClick={() => go('practice')}>
                    Practice this topic <ArrowRight aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <h2 id="progress-decision-title">Establish topic readiness</h2>
                  <p>Your practice history is recorded, but no topic readiness score is available yet. Complete a topic-focused session to create one.</p>
                  <button type="button" onClick={() => go('practice')}>
                    Start topic practice <ArrowRight aria-hidden="true" />
                  </button>
                </>
              )}
            </div>

            <div className="progress-primary-measure" aria-label={weakestTopic ? `${weakestTopic.score}% readiness for ${weakestTopic.topic}` : 'No topic readiness score'}>
              <span>Lowest topic readiness</span>
              <strong>{weakestTopic ? `${weakestTopic.score}%` : '—'}</strong>
              <small>{weakestTopic?.topic ?? 'Awaiting topic evidence'}</small>
            </div>
          </section>

          <dl className="progress-evidence" aria-label="Evidence behind this recommendation">
            <div><dt>Overall readiness</dt><dd>{overallReadiness !== null ? `${overallReadiness}%` : 'Not available'}</dd></div>
            <div><dt>Tracked topics</dt><dd>{topicReadiness.length}</dd></div>
            <div><dt>Practice sessions</dt><dd>{analytics.attempts.length}</dd></div>
            <div><dt>Questions answered</dt><dd>{totalQuestions}</dd></div>
          </dl>

          <section className="progress-section" aria-labelledby="topic-readiness-title">
            <div className="progress-section-head">
              <div>
                <p className="progress-section-label">Current evidence</p>
                <h2 id="topic-readiness-title">Topic readiness</h2>
              </div>
              <span>Lowest readiness first</span>
            </div>

            {topicReadiness.length ? (
              <ol className="progress-topic-list">
                {topicReadiness.map((entry, index) => (
                  <li key={entry.id}>
                    <span className="progress-topic-rank">{String(index + 1).padStart(2, '0')}</span>
                    <span className="progress-topic-name">{entry.topic}</span>
                    <span className="progress-topic-bar" aria-hidden="true"><span style={{ width: `${entry.score}%` }} /></span>
                    <strong>{entry.score}%</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="progress-inline-empty">
                <span>No topic readiness has been recorded yet.</span>
                <button type="button" onClick={() => go('practice')}>Create a topic score</button>
              </div>
            )}
          </section>

          <section className="progress-section progress-history" aria-labelledby="practice-history-title">
            <div className="progress-section-head">
              <div>
                <p className="progress-section-label">History</p>
                <h2 id="practice-history-title">Recent practice</h2>
              </div>
              <span>{analytics.attempts.length} total {analytics.attempts.length === 1 ? 'session' : 'sessions'}</span>
            </div>

            {recentAttempts.length ? (
              <div className="progress-attempt-table" role="table" aria-label="Recent practice sessions">
                <div className="progress-attempt-head" role="row">
                  <span role="columnheader">Date</span><span role="columnheader">Topic</span><span role="columnheader">Questions</span><span role="columnheader">Score</span>
                </div>
                {recentAttempts.map((attempt) => (
                  <div className="progress-attempt-row" role="row" key={attempt.id}>
                    <span role="cell">{formatDate(attempt.completed_at)}</span>
                    <strong role="cell">{topicLabel(attempt.topic)}</strong>
                    <span role="cell">{Math.max(0, attempt.total_questions)} questions</span>
                    <span role="cell" className="progress-attempt-score">{clampScore(attempt.score)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="progress-inline-empty">
                <span>No completed practice sessions are available.</span>
                <button type="button" onClick={() => go('practice')}>Start practice</button>
              </div>
            )}
          </section>

          <footer className="progress-report-note">
            <FileQuestion aria-hidden="true" />
            <p><strong>How readiness works:</strong> each submitted topic score updates that topic’s running readiness. It is evidence from your own completed practice, not a prediction.</p>
          </footer>
        </>
      ) : null}
    </div>
  );
}
