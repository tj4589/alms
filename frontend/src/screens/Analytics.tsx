import { useEffect, useMemo, useState } from 'react';
import type { ScreenType, User } from '../types';
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

type TopicStat = {
  topic: string;
  attempts: number;
  questions: number;
  averageScore: number;
};

function topicColor(idx: number) {
  return [
    'var(--gold)', 'var(--teal)', 'var(--coral)', 'var(--gold)', 'var(--teal)', 'var(--coral)',
  ][idx] ?? 'var(--text3)';
}

function topicLabel(topic: string | null): string {
  const cleaned = String(topic || '').trim();
  return cleaned || 'General practice';
}

function scorePercent(attempt: AttemptEntry): number {
  if (attempt.total_questions > 0 && attempt.score <= attempt.total_questions) {
    return (attempt.score / attempt.total_questions) * 100;
  }
  return attempt.score;
}

export default function Analytics({
  go,
  notifyUnavailable: _notifyUnavailable,
  user,
}: {
  go: (s: ScreenType) => void;
  notifyUnavailable: (feature: string) => void;
  user: User | null;
}) {
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.id) {
      setAnalytics(null);
      setError('');
      return;
    }

    let cancelled = false;
    setError('');

    apiGet(`/analytics/student/${user.id}`)
      .then((data) => { if (!cancelled) setAnalytics(data as StudentAnalytics); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your analytics.');
      });

    return () => { cancelled = true; };
  }, [user?.id]);

  const attempts = analytics?.attempts ?? [];
  const totalQuestions = useMemo(
    () => attempts.reduce((sum, attempt) => sum + Math.max(0, attempt.total_questions || 0), 0),
    [attempts],
  );

  const averageScore = useMemo(() => {
    if (!attempts.length) return null;
    const total = attempts.reduce((sum, attempt) => sum + scorePercent(attempt), 0);
    return Math.round(total / attempts.length);
  }, [attempts]);

  const topicRows = useMemo<TopicStat[]>(() => {
    const byTopic = new Map<string, { attempts: number; questions: number; scoreTotal: number }>();
    attempts.forEach((attempt) => {
      const label = topicLabel(attempt.topic);
      const current = byTopic.get(label) ?? { attempts: 0, questions: 0, scoreTotal: 0 };
      current.attempts += 1;
      current.questions += Math.max(0, attempt.total_questions || 0);
      current.scoreTotal += scorePercent(attempt);
      byTopic.set(label, current);
    });
    return Array.from(byTopic.entries())
      .map(([topic, stat]) => ({
        topic,
        attempts: stat.attempts,
        questions: stat.questions,
        averageScore: Math.round(stat.scoreTotal / stat.attempts),
      }))
      .sort((a, b) => b.attempts - a.attempts || a.averageScore - b.averageScore);
  }, [attempts]);

  const hardestTopics = useMemo(
    () => [...topicRows].sort((a, b) => a.averageScore - b.averageScore).slice(0, 4),
    [topicRows],
  );

  const latestReadiness = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    const total = analytics.readiness.reduce((sum, item) => sum + item.score, 0);
    return Math.round(total / analytics.readiness.length);
  }, [analytics]);

  const maxAttempts = Math.max(...topicRows.map((t) => t.attempts), 1);
  const hasPracticeData = attempts.length > 0;

  if (!user) {
    return (
      <div className="page" id="s-analytics">
        <div className="pg-head">
          <div>
            <div className="pg-title">Exam <em>Intelligence</em></div>
            <div className="pg-sub">Please sign in to view your analytics.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-ttl">Private analytics</div>
          <p style={{ color: 'var(--text3)', margin: '10px 0 0' }}>
            Your practice progress is available after you sign in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" id="s-analytics">
      <div className="pg-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="pg-title">Exam <em>Intelligence</em></div>
          <div className="pg-sub">
            {hasPracticeData
              ? `Your practice history · ${attempts.length} sessions · ${totalQuestions} questions`
              : 'Complete a practice session to see your analytics.'}
          </div>
        </div>
      </div>

      {error && <div className="upload-alert">{error}</div>}

      {!hasPracticeData ? (
        <div className="card">
          <div className="card-ttl">No practice analytics yet</div>
          <p style={{ color: 'var(--text3)', margin: '10px 0 16px' }}>
            Complete a practice session to see your analytics.
          </p>
          <button className="cta" onClick={() => go('practice')}>Start practice</button>
        </div>
      ) : (
        <>
          <div className="ana-stats">
            <div className="ana-card">
              <div className="ana-num" style={{ color: 'var(--gold)' }}>
                {totalQuestions}
              </div>
              <div className="ana-lbl">Questions attempted</div>
              <div className="ana-delta up">
                {attempts.length} practice {attempts.length === 1 ? 'session' : 'sessions'}
              </div>
            </div>
            <div className="ana-card">
              <div className="ana-num" style={{ color: 'var(--teal)' }}>
                {averageScore ?? 0}%
              </div>
              <div className="ana-lbl">Your average score</div>
              <div className={`ana-delta ${(averageScore ?? 0) >= 60 ? 'up' : 'dn'}`}>
                {(averageScore ?? 0) >= 70 ? 'On track' : (averageScore ?? 0) >= 50 ? 'Keep practising' : 'Needs attention'}
              </div>
            </div>
            <div className="ana-card">
              <div className="ana-num" style={{ color: 'var(--coral)' }}>
                {latestReadiness !== null ? `${latestReadiness}%` : 'New'}
              </div>
              <div className="ana-lbl">Your readiness</div>
              <div className="ana-delta" style={{ color: 'var(--text3)' }}>
                {analytics?.readiness.length ? `${analytics.readiness.length} tracked ${analytics.readiness.length === 1 ? 'topic' : 'topics'}` : 'No readiness score yet'}
              </div>
            </div>
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-hd">
                <div className="card-ttl">Your topics by practice frequency</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {topicRows.slice(0, 6).map((t, i) => (
                  <div key={t.topic}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{t.topic}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: topicColor(i) }}>{t.attempts}</span>
                    </div>
                    <div className="prog-track">
                      <div
                        className="prog-fill"
                        style={{ width: `${Math.round((t.attempts / maxAttempts) * 100)}%`, background: topicColor(i) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-hd"><div className="card-ttl">Your hardest topics</div></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {hardestTopics.map((t) => (
                  <div key={t.topic} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>{t.topic}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: t.averageScore < 50 ? 'var(--coral)' : 'var(--gold)', fontWeight: 600 }}>
                      {t.averageScore}%
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>
                  Based on your completed practice sessions.
                </div>
                <button className="cta" onClick={() => go('practice')}>Practice these topics</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
