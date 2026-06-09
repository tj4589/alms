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

export default function Dashboard({
  go,
  user,
}: {
  go: (s: ScreenType) => void;
  user: User | null;
  notifyUnavailable: (feature: string) => void;
}) {
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    apiGet(`/analytics/student/${user.id}`)
      .then((data) => { if (!cancelled) setAnalytics(data as StudentAnalytics); })
      .catch(() => { /* falls back to static demo values silently */ });

    return () => { cancelled = true; };
  }, [user?.id]);

  // ── Derived stats ──────────────────────────────────────────
  const totalPracticed = useMemo(
    () => analytics?.attempts.reduce((sum, a) => sum + a.total_questions, 0) ?? null,
    [analytics],
  );

  const avgScore = useMemo(() => {
    if (!analytics?.attempts.length) return null;
    const sum = analytics.attempts.reduce((acc, a) => acc + a.score, 0);
    return Math.round(sum / analytics.attempts.length);
  }, [analytics]);

  const masteredCount = useMemo(
    () => analytics?.readiness.filter((r) => r.score >= 80).length ?? null,
    [analytics],
  );

  const inProgressCount = useMemo(
    () => analytics?.readiness.filter((r) => r.score >= 50 && r.score < 80).length ?? null,
    [analytics],
  );

  const sessionCount = useMemo(() => analytics?.attempts.length ?? null, [analytics]);

  // Top 4 readiness entries by score — drives the readiness bars
  const topReadiness = useMemo(() => {
    if (!analytics?.readiness.length) return null;
    return [...analytics.readiness]
      .filter((r) => r.topic)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [analytics]);

  // Weekly bar chart — group this-week's attempts by day (Mon=0 … Sun=6)
  const weekBars = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // last Monday
    weekStart.setHours(0, 0, 0, 0);

    analytics?.attempts.forEach((a) => {
      const d = new Date(a.completed_at);
      if (d >= weekStart) {
        const day = d.getDay(); // 0=Sun
        counts[day === 0 ? 6 : day - 1]++;
      }
    });

    const max = Math.max(...counts, 1);
    return counts.map((c) => ({ count: c, height: Math.max(Math.round((c / max) * 64), 4) }));
  }, [analytics]);

  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();

  return (
    <div className="page" id="s-dashboard">
      <div className="pg-head">
        <div className="pg-title">{timeOfDay()}, <em>{firstName}.</em></div>
        <div className="pg-sub">
          {analytics
            ? `${masteredCount ?? 0} topics mastered · ${analytics.readiness.length} tracked · ${analytics.attempts.length} practice sessions`
            : 'Your exam intelligence dashboard'}
        </div>
      </div>

      <div className="focus-card">
        <div className="focus-left">
          <div className="focus-pill">⏱ Next exam</div>
          <div className="focus-course">Data Structures &amp; <em>Algorithms</em></div>
          <div className="focus-meta">CSC 301 · Faculty of Computing · First semester final</div>
        </div>
        <div className="focus-right">
          <div className="cd-unit"><span className="cd-num">14</span><div className="cd-lbl">days</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-unit"><span className="cd-num">06</span><div className="cd-lbl">hrs</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-unit"><span className="cd-num">32</span><div className="cd-lbl">min</div></div>
        </div>
        <button className="focus-cta" onClick={() => go('practice')}>Start practice →</button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--gold)' }}></div>
          <div className="stat-lbl">Questions practiced</div>
          <div className="stat-val" style={{ color: 'var(--gold)' }}>
            {totalPracticed ?? 142}
          </div>
          <div className="stat-delta">
            {analytics ? `across ${sessionCount} session${sessionCount === 1 ? '' : 's'}` : '↑ 18 this week'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--teal)' }}></div>
          <div className="stat-lbl">Practice avg score</div>
          <div className="stat-val" style={{ color: 'var(--teal)' }}>
            {avgScore !== null ? `${avgScore}%` : '71%'}
          </div>
          <div className="stat-delta">
            {analytics
              ? avgScore !== null
                ? avgScore >= 70 ? 'Above target' : 'Below 70% target'
                : 'No attempts yet'
              : '↑ 6% from last week'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--coral)' }}></div>
          <div className="stat-lbl">Topics mastered</div>
          <div className="stat-val" style={{ color: 'var(--coral)' }}>
            {masteredCount ?? 8}
          </div>
          <div className="stat-delta">
            {analytics
              ? `${inProgressCount ?? 0} in progress`
              : '3 in progress'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--purple)' }}></div>
          <div className="stat-lbl">Practice sessions</div>
          <div className="stat-val" style={{ color: 'var(--purple)' }}>
            {sessionCount ?? 4}
          </div>
          <div className="stat-delta">
            {analytics
              ? `${analytics.readiness.length} topic${analytics.readiness.length === 1 ? '' : 's'} tracked`
              : '24 total this week'}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">High-frequency questions</div>
            <div className="card-lnk" onClick={() => go('questions')}>View all →</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2023</div>
            <div className="qi-body">
              <div className="qi-title">Explain the time complexity of QuickSort in best, average and worst cases.</div>
              <div className="qi-meta"><span className="tag tag-h">Hard</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{ width: '90%' }}></div></div>9×</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2022</div>
            <div className="qi-body">
              <div className="qi-title">With a diagram, describe how a Binary Search Tree performs deletion.</div>
              <div className="qi-meta"><span className="tag tag-m">Medium</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{ width: '70%' }}></div></div>7×</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2021</div>
            <div className="qi-body">
              <div className="qi-title">Compare Dijkstra's and Bellman-Ford algorithms. When would you use each?</div>
              <div className="qi-meta"><span className="tag tag-h">Hard</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{ width: '55%' }}></div></div>6×</div>
          </div>
          <div className="qi" style={{ borderBottom: 'none' }}>
            <div className="qi-yr">2023</div>
            <div className="qi-body">
              <div className="qi-title">Define hashing. Explain collision resolution strategies with examples.</div>
              <div className="qi-meta"><span className="tag tag-e">Easy</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{ width: '45%' }}></div></div>5×</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">Topic readiness</div>
              <button className="card-lnk as-button" onClick={() => go('progress')}>Details →</button>
            </div>
            <div className="prog-list">
              {topReadiness ? (
                topReadiness.map((r) => (
                  <div key={r.id}>
                    <div className="prog-top">
                      <span className="prog-nm">{r.topic}</span>
                      <span className="prog-pct">{r.score}%</span>
                    </div>
                    <div className="prog-track">
                      <div className="prog-fill" style={{ width: `${r.score}%`, background: readinessColor(r.score) }}></div>
                    </div>
                  </div>
                ))
              ) : (
                <>
                  <div><div className="prog-top"><span className="prog-nm">Sorting algorithms</span><span className="prog-pct">84%</span></div><div className="prog-track"><div className="prog-fill" style={{ width: '84%', background: 'var(--teal)' }}></div></div></div>
                  <div><div className="prog-top"><span className="prog-nm">Graph theory</span><span className="prog-pct">61%</span></div><div className="prog-track"><div className="prog-fill" style={{ width: '61%', background: 'var(--gold)' }}></div></div></div>
                  <div><div className="prog-top"><span className="prog-nm">Tree structures</span><span className="prog-pct">48%</span></div><div className="prog-track"><div className="prog-fill" style={{ width: '48%', background: 'var(--gold)' }}></div></div></div>
                  <div><div className="prog-top"><span className="prog-nm">Dynamic programming</span><span className="prog-pct">22%</span></div><div className="prog-track"><div className="prog-fill" style={{ width: '22%', background: 'var(--coral)' }}></div></div></div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-hd"><div className="card-ttl">This week</div></div>
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
            {analytics && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text3)' }}>
                {weekBars.reduce((s, b) => s + b.count, 0)} session{weekBars.reduce((s, b) => s + b.count, 0) === 1 ? '' : 's'} this week
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
