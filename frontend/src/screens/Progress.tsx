import { useEffect, useMemo, useState } from 'react';
import type { ScreenType } from '../types';
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

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function readinessColor(score: number): string {
  if (score >= 80) return 'var(--teal)';
  if (score >= 50) return 'var(--gold)';
  return 'var(--coral)';
}

function calcStreak(attempts: AttemptEntry[]): number {
  if (!attempts.length) return 0;
  const days = new Set(attempts.map((a) => new Date(a.completed_at).toDateString()));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function Progress({ go, userId }: { go: (s: ScreenType) => void; userId: number | null }) {
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setError('');

    apiGet(`/analytics/student/${userId}`)
      .then((data) => { if (!cancelled) setAnalytics(data as StudentAnalytics); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load progress data.');
      });

    return () => { cancelled = true; };
  }, [userId]);

  // ── Derived stats ──────────────────────────────────────────
  const overallMastery = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    const sum = analytics.readiness.reduce((acc, r) => acc + r.score, 0);
    return Math.round(sum / analytics.readiness.length);
  }, [analytics]);

  const streak = useMemo(
    () => (analytics ? calcStreak(analytics.attempts) : null),
    [analytics],
  );

  const badgeCount = useMemo(
    () => analytics?.readiness.filter((r) => r.score >= 70).length ?? null,
    [analytics],
  );

  // All readiness entries with a topic, sorted weakest-first so gaps are visible
  const sortedReadiness = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    return [...analytics.readiness]
      .filter((r) => r.topic)
      .sort((a, b) => a.score - b.score);
  }, [analytics]);

  // Weekly activity bars
  const weekBars = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    analytics?.attempts.forEach((a) => {
      const d = new Date(a.completed_at);
      if (d >= weekStart) {
        const day = d.getDay();
        counts[day === 0 ? 6 : day - 1]++;
      }
    });

    const max = Math.max(...counts, 1);
    return counts.map((c) => ({ count: c, height: Math.max(Math.round((c / max) * 64), 4) }));
  }, [analytics]);

  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();

  const busiestDayIdx = useMemo(() => {
    const max = Math.max(...weekBars.map((b) => b.count));
    return max > 0 ? weekBars.findIndex((b) => b.count === max) : null;
  }, [weekBars]);

  // Last 5 attempts, newest first
  const recentAttempts = useMemo(() => {
    if (!analytics?.attempts.length) return null;
    return [...analytics.attempts]
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
      .slice(0, 5);
  }, [analytics]);

  const hasData = analytics !== null;

  return (
    <div className="page" id="s-progress">
      <div className="pg-head">
        <div className="pg-title">My <em>Progress</em></div>
        <div className="pg-sub">
          {hasData
            ? `${analytics.attempts.length} practice session${analytics.attempts.length === 1 ? '' : 's'} · ${analytics.readiness.length} topics tracked`
            : 'Personalized learning journey and performance metrics.'}
        </div>
      </div>

      {error && <div className="upload-alert">{error}</div>}

      {!userId && !hasData && (
        <div className="upload-alert">Sign in to see your personalised progress data.</div>
      )}

      <div className="ana-stats">
        <div className="ana-card">
          <div className="ana-num" style={{ color: overallMastery !== null ? readinessColor(overallMastery) : undefined }}>
            {overallMastery !== null ? `${overallMastery}%` : '84%'}
          </div>
          <div className="ana-lbl">Overall Mastery</div>
          <div className={`ana-delta ${overallMastery !== null && overallMastery >= 70 ? 'up' : 'dn'}`}>
            {overallMastery !== null
              ? overallMastery >= 80 ? 'Excellent standing' : overallMastery >= 60 ? 'Good progress' : 'Needs attention'
              : '+4% this month'}
          </div>
        </div>
        <div className="ana-card">
          <div className="ana-num">{streak !== null ? streak : 12}</div>
          <div className="ana-lbl">Study Streak (Days)</div>
          <div className="ana-delta up">
            {streak !== null
              ? streak === 0 ? 'Start today!' : streak === 1 ? 'Day 1 — keep going!' : `${streak} days in a row`
              : 'New personal record!'}
          </div>
        </div>
        <div className="ana-card">
          <div className="ana-num">{badgeCount !== null ? badgeCount : 142}</div>
          <div className="ana-lbl">Concept Badges</div>
          <div className="ana-delta up">
            {badgeCount !== null ? `topics scored ≥ 70%` : '+3 recently'}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Topic Breakdown</div>
            {hasData && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Weakest first</div>}
          </div>
          <div className="prog-list">
            {sortedReadiness ? (
              sortedReadiness.length > 0 ? sortedReadiness.map((r) => (
                <div key={r.id} className="prog-item">
                  <div className="prog-top">
                    <span className="prog-nm">{r.topic}</span>
                    <span className="prog-pct">{r.score}%</span>
                  </div>
                  <div className="prog-track">
                    <div className="prog-fill" style={{ width: `${r.score}%`, background: readinessColor(r.score) }}></div>
                  </div>
                </div>
              )) : (
                <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>
                  No readiness data yet. Complete a practice test to start tracking topics.
                </div>
              )
            ) : (
              // Static demo while loading
              <>
                {[
                  { name: 'Data Structures', pct: 92, color: 'var(--teal)' },
                  { name: 'Algorithms', pct: 78, color: 'var(--gold)' },
                  { name: 'Operating Systems', pct: 64, color: 'var(--gold)' },
                  { name: 'Database Systems', pct: 88, color: 'var(--teal)' },
                  { name: 'Computer Networks', pct: 52, color: 'var(--coral)' },
                ].map((topic) => (
                  <div key={topic.name} className="prog-item">
                    <div className="prog-top">
                      <span className="prog-nm">{topic.name}</span>
                      <span className="prog-pct">{topic.pct}%</span>
                    </div>
                    <div className="prog-track">
                      <div className="prog-fill" style={{ width: `${topic.pct}%`, background: topic.color }}></div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Weekly Activity</div>
          </div>
          <div className="bar-chart">
            {weekBars.map((bar, i) => (
              <div className="bc-col" key={i}>
                <div
                  className={`bc-bar${i === todayIdx ? ' on' : ''}`}
                  style={{ height: bar.height }}
                  title={`${bar.count} session${bar.count === 1 ? '' : 's'}`}
                ></div>
                <span className="bc-lbl">{DAY_LABELS[i]}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>
            {hasData
              ? busiestDayIdx !== null
                ? `Most active: ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][busiestDayIdx]} (${weekBars[busiestDayIdx].count} session${weekBars[busiestDayIdx].count === 1 ? '' : 's'})`
                : 'No sessions this week yet — start today!'
              : "You're most productive on Thursdays and Saturdays. Keep it up!"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div className="card-ttl">Recent Practice</div>
          <button className="card-lnk as-button" onClick={() => go('practice')}>New session →</button>
        </div>
        {recentAttempts ? (
          recentAttempts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {recentAttempts.map((attempt) => (
                <div key={attempt.id} className="qi">
                  <div className="qi-yr">{fmtDate(attempt.completed_at)}</div>
                  <div className="qi-body">
                    <div className="qi-title">{attempt.topic ?? 'Mixed revision'}</div>
                    <div className="qi-meta">
                      <span className={`tag ${attempt.score >= 80 ? 'tag-e' : attempt.score >= 60 ? 'tag-m' : 'tag-h'}`}>
                        {attempt.score >= 80 ? 'Strong' : attempt.score >= 60 ? 'Moderate' : 'Weak'}
                      </span>
                      <span className="qi-course">{attempt.total_questions} questions</span>
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: readinessColor(attempt.score), flexShrink: 0 }}>
                    {attempt.score}%
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>
              No practice sessions yet.
              <button className="cta" style={{ marginLeft: 12, marginTop: 0 }} onClick={() => go('practice')}>Start now →</button>
            </div>
          )
        ) : (
          // Static demo goals while loading
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="qd" style={{ cursor: 'default' }}>
              <div className="qd-text" style={{ marginBottom: 0 }}>Complete 5 practice tests on <em>Graph Theory</em> before Friday.</div>
              <div className="qd-meta" style={{ marginTop: 8 }}>
                <span className="tag tag-m">Priority: High</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', cursor: 'pointer' }} onClick={() => go('practice')}>Progress: 2/5</span>
              </div>
            </div>
            <div className="qd" style={{ cursor: 'default' }}>
              <div className="qd-text" style={{ marginBottom: 0 }}>Review 2022 Operating Systems past questions.</div>
              <div className="qd-meta" style={{ marginTop: 8 }}>
                <span className="tag tag-e">Priority: Medium</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>Progress: 0/1</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
