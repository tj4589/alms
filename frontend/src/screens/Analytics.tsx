import { useEffect, useState } from 'react';
import type { ScreenType, User } from '../types';
import { apiGet } from '../lib/api';

type CohortTopic = {
  topic: string;
  average_score: number;
  attempts: number;
};

type CohortAnalytics = {
  active_students: number;
  avg_practice_score: number;
  questions_attempted: number;
  notes_uploaded: number;
  most_challenging_topics: CohortTopic[];
};

export default function Analytics({
  go,
  notifyUnavailable: _notifyUnavailable,
  user: _user,
}: {
  go: (s: ScreenType) => void;
  notifyUnavailable: (feature: string) => void;
  user: User | null;
}) {
  const [cohort, setCohort] = useState<CohortAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    apiGet('/analytics/cohort')
      .then((data) => { if (!cancelled) setCohort(data as CohortAnalytics); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load analytics.'); });
    return () => { cancelled = true; };
  }, []);

  // Derive topic frequency chart — sorted by attempts desc (most frequent first)
  const topicRows = cohort?.most_challenging_topics
    ? [...cohort.most_challenging_topics].sort((a, b) => b.attempts - a.attempts).slice(0, 6)
    : null;

  const maxAttempts = topicRows ? Math.max(...topicRows.map((t) => t.attempts), 1) : 1;

  function topicColor(idx: number) {
    return [
      'var(--gold)', 'var(--gold)', 'var(--teal)', 'var(--teal)', 'var(--purple)', 'var(--coral)',
    ][idx] ?? 'var(--text3)';
  }

  const hasData = cohort !== null;

  return (
    <div className="page" id="s-analytics">
      <div className="pg-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="pg-title">Exam <em>Intelligence</em></div>
          <div className="pg-sub">
            {hasData
              ? `${cohort.active_students} students · ${cohort.questions_attempted} questions attempted · ${cohort.notes_uploaded} resources`
              : 'Aggregate past question pattern analysis'}
          </div>
        </div>
      </div>

      {error && <div className="upload-alert">{error}</div>}

      <div className="ana-stats">
        <div className="ana-card">
          <div className="ana-num" style={{ color: 'var(--gold)' }}>
            {hasData ? cohort.questions_attempted : 847}
          </div>
          <div className="ana-lbl">Questions attempted</div>
          <div className="ana-delta up">
            {hasData ? `across ${cohort.active_students} students` : '+120 this semester'}
          </div>
        </div>
        <div className="ana-card">
          <div className="ana-num" style={{ color: 'var(--teal)' }}>
            {hasData ? cohort.active_students : 12}
          </div>
          <div className="ana-lbl">Active students</div>
          <div className="ana-delta" style={{ color: 'var(--text3)' }}>
            {hasData ? `${cohort.notes_uploaded} resources uploaded` : '3 departments'}
          </div>
        </div>
        <div className="ana-card">
          <div className="ana-num" style={{ color: 'var(--coral)' }}>
            {hasData ? `${Math.round(cohort.avg_practice_score)}%` : '38%'}
          </div>
          <div className="ana-lbl">Class avg score</div>
          <div className={`ana-delta ${hasData && cohort.avg_practice_score >= 60 ? 'up' : 'dn'}`}>
            {hasData
              ? cohort.avg_practice_score >= 70 ? 'Above target' : cohort.avg_practice_score >= 50 ? 'Below 70% target' : 'Needs attention'
              : 'Highest-yield cluster'}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">
              {hasData ? 'Topics by practice frequency' : 'Topic frequency · CSC 301 (2014–2023)'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {topicRows && topicRows.length > 0 ? (
              topicRows.map((t, i) => (
                <div key={t.topic}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13 }}>{t.topic}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: topicColor(i) }}>{t.attempts}</span>
                  </div>
                  <div className="prog-track">
                    <div className="prog-fill" style={{ width: `${Math.round((t.attempts / maxAttempts) * 100)}%`, background: topicColor(i) }}></div>
                  </div>
                </div>
              ))
            ) : topicRows !== null ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
                No practice data yet. Students complete practice sessions to generate topic frequency.
              </div>
            ) : (
              // Static demo while loading
              <>
                {[
                  { name: 'Sorting algorithms', count: 43, pct: 100, color: 'var(--gold)' },
                  { name: 'Graph algorithms', count: 38, pct: 88, color: 'var(--gold)' },
                  { name: 'Tree structures', count: 31, pct: 72, color: 'var(--teal)' },
                  { name: 'Hashing', count: 27, pct: 63, color: 'var(--teal)' },
                  { name: 'Recursion', count: 22, pct: 51, color: 'var(--purple)' },
                  { name: 'Dynamic programming', count: 19, pct: 44, color: 'var(--coral)' },
                ].map((item) => (
                  <div key={item.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{item.name}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: item.color }}>{item.count}</span>
                    </div>
                    <div className="prog-track">
                      <div className="prog-fill" style={{ width: `${item.pct}%`, background: item.color }}></div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">Hardest topics (lowest avg score)</div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {cohort?.most_challenging_topics.slice(0, 4).map((t) => (
                <div key={t.topic} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>{t.topic}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: t.average_score < 50 ? 'var(--coral)' : 'var(--gold)', fontWeight: 600 }}>
                    {t.average_score}%
                  </span>
                </div>
              )) ?? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 72, marginBottom: 6 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}><div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--coral)' }}>48%</div><div style={{ width: '100%', height: 52, background: 'var(--coral2)', border: '1px solid rgba(240,115,90,0.2)', borderRadius: '5px 5px 0 0' }}></div><div style={{ fontSize: 10, color: 'var(--text3)' }}>Hard</div></div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}><div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--gold)' }}>35%</div><div style={{ width: '100%', height: 38, background: 'var(--gold2)', border: '1px solid rgba(232,162,58,0.2)', borderRadius: '5px 5px 0 0' }}></div><div style={{ fontSize: 10, color: 'var(--text3)' }}>Med</div></div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}><div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--teal)' }}>17%</div><div style={{ width: '100%', height: 18, background: 'var(--teal2)', border: '1px solid rgba(62,207,178,0.2)', borderRadius: '5px 5px 0 0' }}></div><div style={{ fontSize: 10, color: 'var(--text3)' }}>Easy</div></div>
                </div>
              )}
              {cohort && (
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>
                  Based on {cohort.questions_attempted} practice attempts across all students.
                </div>
              )}
            </div>
          </div>

          <div className="pred-card">
            <div className="pred-lbl">AI prediction</div>
            <div className="pred-title">Graph algorithms are <em style={{ color: 'var(--gold)' }}>very likely</em> in 2024</div>
            <div className="pred-body">Appeared in 8 of the last 10 exams. Dynamic Programming has not appeared since 2021 — high probability of reappearance.</div>
            <button className="cta" onClick={() => go('practice')}>Practice these topics</button>
          </div>
        </div>
      </div>
    </div>
  );
}
