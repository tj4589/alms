import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, ClipboardCheck, FileQuestion, RefreshCw } from 'lucide-react';
import type { ScreenType } from '../types';
import { apiGet, apiPatch } from '../lib/api';
import './Progress.css';
import './WorkspacePage.css';

type TopicEvidence = { topic: string; score: number | null; classification: 'strong' | 'developing' | 'weak' | 'insufficient_evidence'; answers: number; correct: number; missed: number; attempts: number; last_answered_at?: string | null };
type Readiness = { available: boolean; score: number | null; formula: string; thresholds: Record<string, number>; evidence_used: { answered_questions: number; correct_answers: number; attempts: number; latest_answered_at?: string | null }; topics: TopicEvidence[]; assessed_topics: string[]; unassessed_topics: string[]; recommended_next_action: string };
type ReviewItem = { question_id: number; is_correct: boolean; explanation: string; citation?: { label?: string; source?: string }; topic?: string | null };
type Attempt = { id: number; quiz_id: number; score: number; total_questions: number; percentage: number; topic?: string | null; completed_at: string; review: ReviewItem[] };
type Profile = { explicit_preferences: Record<string, { value: string; source: string }>; inferred_preferences: Record<string, { value: string; source: string; sample_size?: number }>; };

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Progress({ go, userId, onPracticeTopic }: { go: (screen: ScreenType) => void; userId: number | null; onPracticeTopic?: (topic: string) => void }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoadState('loading');
    try {
      const [nextReadiness, nextAttempts, nextProfile] = await Promise.all([
        apiGet('/learning/readiness'),
        apiGet('/learning/attempts?limit=30'),
        apiGet('/learning/profile'),
      ]);
      setReadiness(nextReadiness as Readiness);
      setAttempts(nextAttempts as Attempt[]);
      setProfile(nextProfile as Profile);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const topics = useMemo(() => [...(readiness?.topics || [])].sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.topic.localeCompare(b.topic)), [readiness]);
  const weakest = topics.find(topic => topic.classification === 'weak');
  const savePreference = async (key: 'explanation_preference' | 'preferred_learning_format', value: string) => {
    setPreferenceSaving(true);
    try {
      const next = await apiPatch('/learning/profile', { [key]: value });
      setProfile(next as Profile);
    } finally { setPreferenceSaving(false); }
  };

  const goToTopic = (topic: string) => onPracticeTopic ? onPracticeTopic(topic) : go('practice');

  return <div className="page workspace-page progress-report" id="s-progress">
    <header className="progress-report-head"><div><p className="progress-report-kicker">Private learning record</p><h1>Progress</h1><p>Readiness is calculated from completed quiz answers only. Reading and asking Maxe questions never create mastery evidence.</p></div><button type="button" className="progress-refresh" onClick={() => void load()} disabled={loadState === 'loading'} aria-label="Refresh learning progress" title="Refresh learning progress"><RefreshCw aria-hidden="true" /></button></header>

    {!userId ? <section className="progress-state" aria-labelledby="progress-private-title"><AlertCircle aria-hidden="true" /><div><h2 id="progress-private-title">Your progress is private</h2><p>Sign in to view readiness and practice history associated with your account.</p></div></section> : loadState === 'loading' ? <section className="progress-loading" aria-label="Loading your progress" aria-live="polite"><div className="progress-loading-lead" /><div className="progress-loading-line" /><div className="progress-loading-table"><span /><span /><span /></div></section> : loadState === 'error' ? <section className="progress-state progress-state-error" role="alert"><AlertCircle aria-hidden="true" /><div><h2>Your progress could not be loaded</h2><p>Your study record is still safe. Try again.</p><button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Try again</button></div></section> : readiness ? <>
      <section className="progress-decision" aria-labelledby="progress-decision-title"><div className="progress-decision-copy"><p className="progress-section-label">Recommended next action</p>{!readiness.available ? <><h2 id="progress-decision-title">Start your evidence record</h2><p>Not enough evidence yet. Complete a short quiz to begin tracking readiness.</p><button type="button" onClick={() => go('practice')}>Start a short quiz <ArrowRight aria-hidden="true" /></button></> : weakest ? <><h2 id="progress-decision-title">Review <em>{weakest.topic}</em></h2><p>{readiness.recommended_next_action}</p><button type="button" onClick={() => goToTopic(weakest.topic)}>Practice this topic <ArrowRight aria-hidden="true" /></button></> : <><h2 id="progress-decision-title">Keep broadening the evidence</h2><p>{readiness.recommended_next_action}</p><button type="button" onClick={() => go('practice')}>Take another quiz <ArrowRight aria-hidden="true" /></button></>}</div><div className="progress-primary-measure" aria-label={readiness.available ? `${readiness.score}% evidence-based readiness` : 'Readiness is not available yet'}><span>Overall readiness</span><strong>{readiness.available ? `${readiness.score}%` : '—'}</strong><small>{readiness.available ? `${readiness.evidence_used.answered_questions} answered questions` : 'Awaiting enough evidence'}</small></div></section>

      <dl className="progress-evidence" aria-label="Evidence behind readiness"><div><dt>Answered questions</dt><dd>{readiness.evidence_used.answered_questions}</dd></div><div><dt>Correct answers</dt><dd>{readiness.evidence_used.correct_answers}</dd></div><div><dt>Quiz attempts</dt><dd>{readiness.evidence_used.attempts}</dd></div><div><dt>Latest evidence</dt><dd>{formatDate(readiness.evidence_used.latest_answered_at)}</dd></div></dl>

      <section className="progress-section" aria-labelledby="topic-readiness-title"><div className="progress-section-head"><div><p className="progress-section-label">Evidence by topic</p><h2 id="topic-readiness-title">Topic signals</h2></div><span>{topics.length} tracked</span></div>{topics.length ? <ol className="progress-topic-list">{topics.map((topic, index) => <li key={topic.topic}><span className="progress-topic-rank">{String(index + 1).padStart(2, '0')}</span><span className="progress-topic-name">{topic.topic}<small className={`topic-signal topic-signal-${topic.classification}`}>{topic.classification.replace('_', ' ')}</small></span><span className="progress-topic-bar" aria-hidden="true"><span style={{ width: `${topic.score ?? 0}%` }} /></span><strong>{topic.score === null ? '—' : `${topic.score}%`}</strong></li>)}</ol> : <div className="progress-inline-empty"><span>No quiz evidence has been recorded yet.</span><button type="button" onClick={() => go('practice')}>Create a quiz</button></div>}</section>

      <section className="progress-section" aria-labelledby="evidence-explanation-title"><div className="progress-section-head"><div><p className="progress-section-label">How to read this</p><h2 id="evidence-explanation-title">Explainable readiness</h2></div></div><div className="progress-explanation"><p><strong>Formula:</strong> {readiness.formula}</p><p><strong>Strong:</strong> {readiness.thresholds.strong}% or higher with enough answers. <strong>Weak:</strong> below {readiness.thresholds.weak_below}% with enough answers. Topics with fewer than {readiness.thresholds.minimum_answers_for_topic} answers stay unclassified.</p><p><strong>Unassessed topics:</strong> {readiness.unassessed_topics.length ? readiness.unassessed_topics.join(', ') : 'None identified from your authorized sources.'}</p></div></section>

      <section className="progress-section" aria-labelledby="practice-history-title"><div className="progress-section-head"><div><p className="progress-section-label">Retakes stay separate</p><h2 id="practice-history-title">Quiz history</h2></div><span>{attempts.length} total</span></div>{attempts.length ? <div className="progress-attempt-table" role="table" aria-label="Private quiz history"><div className="progress-attempt-head" role="row"><span role="columnheader">Date</span><span role="columnheader">Topic</span><span role="columnheader">Score</span><span role="columnheader">Review</span></div>{attempts.map(attempt => <div className="progress-attempt-row progress-attempt-row-action" role="row" key={attempt.id}><span role="cell">{formatDate(attempt.completed_at)}</span><strong role="cell">{attempt.topic || 'Mixed revision'}</strong><span role="cell" className="progress-attempt-score">{attempt.percentage}%</span><button type="button" className="progress-review-button" onClick={() => setReviewId(reviewId === attempt.id ? null : attempt.id)}>{reviewId === attempt.id ? 'Hide' : 'Review answers'}</button>{reviewId === attempt.id && <div className="progress-review-drawer">{attempt.review.map(item => <div key={item.question_id}><strong>{item.is_correct ? 'Correct' : 'Review'} - {item.topic || 'Mixed revision'}</strong><p>{item.explanation}</p><small>{item.citation?.label || item.citation?.source || 'Verified source'}</small></div>)}</div>}</div>)}</div> : <div className="progress-inline-empty"><span>No completed quiz attempts are available.</span><button type="button" onClick={() => go('practice')}>Start practice</button></div>}</section>

      <section className="progress-section progress-profile-section" aria-labelledby="learning-profile-title"><div className="progress-section-head"><div><p className="progress-section-label">Learning profile</p><h2 id="learning-profile-title">Preferences and observations</h2></div><span>Private to you</span></div><div className="learning-profile-grid"><label>How should explanations feel?<select value={profile?.explicit_preferences?.explanation_preference?.value || ''} disabled={preferenceSaving} onChange={event => void savePreference('explanation_preference', event.target.value)}><option value="">Choose a preference</option><option value="concise">Concise</option><option value="step_by_step">Step by step</option><option value="examples">With examples</option><option value="exam_style">Exam style</option></select><small>Explicit choice - never guessed.</small></label><label>Preferred quiz format<select value={profile?.explicit_preferences?.preferred_learning_format?.value || ''} disabled={preferenceSaving} onChange={event => void savePreference('preferred_learning_format', event.target.value)}><option value="">Choose a preference</option><option value="multiple_choice">Multiple choice</option><option value="short_answer">Short answer</option><option value="mixed">A mix</option></select><small>Explicit choice - never guessed.</small></label><div className="learning-observation"><span>Observed behaviour</span><strong>{profile?.inferred_preferences?.preferred_learning_format?.value || 'Not enough behaviour yet'}</strong><small>{profile?.inferred_preferences?.preferred_learning_format ? `${profile.inferred_preferences.preferred_learning_format.source} (${profile.inferred_preferences.preferred_learning_format.sample_size || 0} questions)` : 'Complete at least two quiz questions to form an observation.'}</small></div></div></section>
      <footer className="progress-report-note"><FileQuestion aria-hidden="true" /><p><strong>What this does not mean:</strong> readiness is a record of quiz evidence, not a prediction of your intelligence or a claim that passive reading equals mastery.</p></footer>
    </> : <section className="progress-state progress-state-empty"><ClipboardCheck aria-hidden="true" /><div><p className="progress-state-label">No evidence yet</p><h2>Not enough evidence yet. Complete a short quiz to begin tracking readiness.</h2><button type="button" onClick={() => go('practice')}>Start a short quiz <ArrowRight aria-hidden="true" /></button></div></section>}
  </div>;
}
