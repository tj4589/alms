import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Inbox, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ScreenType, User } from '../types';
import { ApiHttpError, apiGet, apiPublicGet } from '../lib/api';
import './AdminDashboard.css';

type Contribution = {
  id: number;
  material_type?: string | null;
  moderation_status?: string | null;
  submitted_at?: string | null;
  uploader?: { name?: string | null; username?: string | null } | null;
  material?: { title?: string | null; file_name?: string | null } | null;
};

type FeedbackItem = {
  id: number;
  source: 'authenticated' | 'public' | string;
  identity_label?: string | null;
  category?: string | null;
  message?: string | null;
  rating?: number | null;
  page_path?: string | null;
  created_at: string;
};

type AdminDashboardProps = {
  go: (screen: ScreenType) => void;
  user: User;
};

type PanelError = {
  contributions: string;
  feedback: string;
};

type HealthState = 'loading' | 'healthy' | 'unavailable' | 'error';

type HealthCheck = {
  state: HealthState;
  label: string;
  detail: string;
};

type ServiceHealth = {
  process: HealthCheck;
  database: HealthCheck;
};

function initialHealth(): ServiceHealth {
  return {
    process: { state: 'loading', label: 'Checking', detail: 'Checking the API process.' },
    database: { state: 'loading', label: 'Checking', detail: 'Checking database readiness.' },
  };
}

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function displayContributor(item: Contribution) {
  return item.uploader?.name || item.uploader?.username || 'Student contributor';
}

function displayMaterial(item: Contribution) {
  return item.material?.title || item.material?.file_name || `${item.material_type || 'Material'} contribution`;
}

function loadError(value: unknown, fallback: string) {
  return value instanceof Error && value.message ? value.message : fallback;
}

function healthFailure(reason: unknown, kind: 'process' | 'database'): HealthCheck {
  if (reason instanceof ApiHttpError && reason.status === 503) {
    return kind === 'database'
      ? { state: 'unavailable', label: 'Unavailable', detail: 'The database is not ready.' }
      : { state: 'unavailable', label: 'Unavailable', detail: 'The API process is not responding normally.' };
  }
  return kind === 'database'
    ? { state: 'error', label: 'Check failed', detail: 'Database readiness could not be verified.' }
    : { state: 'error', label: 'Check failed', detail: 'API process health could not be verified.' };
}

function healthSuccess(value: unknown, kind: 'process' | 'database'): HealthCheck {
  if (!value || typeof value !== 'object') {
    return healthFailure(new Error('Unexpected health response.'), kind);
  }
  const response = value as { status?: unknown; application?: unknown; database?: unknown };
  const valid = kind === 'process'
    ? response.status === 'ok' && response.application === 'ok'
    : response.status === 'ready' && response.application === 'ok' && response.database === 'ok';
  if (!valid) {
    return healthFailure(new Error('Unexpected health response.'), kind);
  }
  return kind === 'database'
    ? { state: 'healthy', label: 'Ready', detail: 'Database connection is ready.' }
    : { state: 'healthy', label: 'Healthy', detail: 'API process is responding normally.' };
}

function healthSummary(health: ServiceHealth) {
  const states = [health.process.state, health.database.state];
  if (states.includes('loading')) return 'Checking';
  if (states.includes('unavailable')) return 'Degraded';
  if (states.includes('error')) return 'Check failed';
  return 'Operational';
}

function formatCheckedTime(value?: string | null) {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not checked yet' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export default function AdminDashboard({ go, user }: AdminDashboardProps) {
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<PanelError>({ contributions: '', feedback: '' });
  const [health, setHealth] = useState<ServiceHealth>(initialHealth);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const loadSignals = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrors({ contributions: '', feedback: '' });
    if (!isRefresh) setHealth(initialHealth());

    const [processHealthResult, databaseHealthResult, contributionResult, feedbackResult] = await Promise.allSettled([
      apiPublicGet('/health', { timeoutMs: 10_000 }),
      apiPublicGet('/health/ready', { timeoutMs: 10_000 }),
      apiGet('/collaboration/moderation/contributions?status=pending_review'),
      apiGet('/feedback/inbox'),
    ]);

    setHealth({
      process: processHealthResult.status === 'fulfilled' ? healthSuccess(processHealthResult.value, 'process') : healthFailure(processHealthResult.reason, 'process'),
      database: databaseHealthResult.status === 'fulfilled' ? healthSuccess(databaseHealthResult.value, 'database') : healthFailure(databaseHealthResult.reason, 'database'),
    });
    setLastChecked(new Date().toISOString());

    if (contributionResult.status === 'fulfilled') {
      setContributions(Array.isArray(contributionResult.value) ? contributionResult.value as Contribution[] : []);
    } else {
      setErrors(current => ({ ...current, contributions: loadError(contributionResult.reason, 'The contribution queue could not be loaded.') }));
    }

    if (feedbackResult.status === 'fulfilled') {
      setFeedback(Array.isArray(feedbackResult.value) ? feedbackResult.value as FeedbackItem[] : []);
    } else {
      setErrors(current => ({ ...current, feedback: loadError(feedbackResult.reason, 'The feedback inbox could not be loaded.') }));
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadSignals(); });
    return () => window.cancelAnimationFrame(frame);
  }, [loadSignals]);

  const feedbackBreakdown = useMemo(() => {
    const publicCount = feedback.filter(item => item.source === 'public').length;
    return { publicCount, studentCount: feedback.length - publicCount };
  }, [feedback]);

  const hasError = Boolean(errors.contributions || errors.feedback);

  return (
    <div className="admin-dashboard-page">
      <header className="admin-dashboard-heading">
        <div>
          <p className="admin-dashboard-eyebrow">Global administration / Admin desk</p>
          <h1>Keep ExamMind <em>healthy.</em></h1>
          <p className="admin-dashboard-lede">A focused view of work that needs stewardship across the platform, without exposing student study data or inventing platform-wide numbers.</p>
        </div>
        <button type="button" className="admin-dashboard-refresh" onClick={() => void loadSignals(true)} disabled={loading || refreshing}>
          <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'is-spinning' : undefined} />
          {refreshing ? 'Refreshing' : 'Refresh signals'}
        </button>
      </header>

      <div className="admin-dashboard-scope" role="note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p><strong>Global admin view.</strong> These signals come from the existing moderation and feedback endpoints. This is not a complete analytics rollup, and private learning activity is not shown here.</p>
      </div>

      <section className="admin-dashboard-health" aria-labelledby="admin-health-title">
        <div className="admin-dashboard-health-heading">
          <div>
            <p className="admin-dashboard-label">Service monitor</p>
            <h2 id="admin-health-title">API and database health</h2>
          </div>
          <span className={`admin-dashboard-health-summary is-${healthSummary(health).toLowerCase().replace(' ', '-')}`} role="status" aria-live="polite">
            {healthSummary(health)}
          </span>
        </div>
        <div className="admin-dashboard-health-grid">
          {([
            ['process', 'API process', health.process],
            ['database', 'Database readiness', health.database],
          ] as const).map(([key, title, check]) => (
            <article className="admin-dashboard-health-check" key={key} data-testid={`admin-health-${key}`}>
              <span className={`admin-dashboard-health-dot is-${check.state}`} aria-hidden="true" />
              <div>
                <span>{title}</span>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </div>
            </article>
          ))}
        </div>
        <div className="admin-dashboard-health-meta">
          <span>Last checked <time dateTime={lastChecked || undefined}>{formatCheckedTime(lastChecked)}</time></span>
          <span>Monitoring returns redacted status only. Migration details and credentials are not shown.</span>
        </div>
      </section>

      {hasError && (
        <div className="admin-dashboard-alert" role="alert">
          <strong>Some admin signals need attention.</strong>
          <span>{errors.contributions || errors.feedback}</span>
        </div>
      )}

      <section className="admin-dashboard-signals" aria-label="Admin signals">
        <article className="admin-dashboard-signal">
          <div className="admin-dashboard-signal-icon is-orange"><ListChecks size={18} aria-hidden="true" /></div>
          <div><span>Pending contributions</span><strong>{loading ? '—' : contributions.length}</strong><small>Awaiting moderation review</small></div>
        </article>
        <article className="admin-dashboard-signal">
          <div className="admin-dashboard-signal-icon is-teal"><Inbox size={18} aria-hidden="true" /></div>
          <div><span>Feedback inbox</span><strong>{loading ? '—' : feedback.length}</strong><small>Latest 200 records returned</small></div>
        </article>
        <article className="admin-dashboard-signal">
          <div className="admin-dashboard-signal-icon is-muted"><CheckCircle2 size={18} aria-hidden="true" /></div>
          <div><span>Feedback mix</span><strong>{loading ? '—' : `${feedbackBreakdown.studentCount}/${feedbackBreakdown.publicCount}`}</strong><small>Students / public visitors</small></div>
        </article>
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-dashboard-panel" aria-labelledby="admin-contributions-title">
          <div className="admin-dashboard-panel-heading">
            <div><p className="admin-dashboard-label">Stewardship queue</p><h2 id="admin-contributions-title">Contributions to review</h2></div>
            <button type="button" className="admin-dashboard-text-button" onClick={() => go('moderation')}>Open queue <ArrowUpRight size={15} aria-hidden="true" /></button>
          </div>
          {loading && <p className="admin-dashboard-state">Checking the moderation queue...</p>}
          {!loading && !errors.contributions && !contributions.length && <div className="admin-dashboard-empty"><ListChecks size={21} aria-hidden="true" /><p><strong>Nothing waiting.</strong><span>New contribution submissions will appear here.</span></p></div>}
          {!loading && !errors.contributions && contributions.length > 0 && (
            <div className="admin-dashboard-list">
              {contributions.slice(0, 5).map(item => (
                <div className="admin-dashboard-list-row" key={item.id}>
                  <span className="admin-dashboard-row-mark">{(item.material_type || 'file').slice(0, 1).toUpperCase()}</span>
                  <div><strong>{displayMaterial(item)}</strong><span>{displayContributor(item)} · {formatDate(item.submitted_at)}</span></div>
                  <span className="admin-dashboard-status">Pending</span>
                </div>
              ))}
            </div>
          )}
          {!loading && errors.contributions && <p className="admin-dashboard-inline-error">{errors.contributions}</p>}
        </section>

        <section className="admin-dashboard-panel" aria-labelledby="admin-feedback-title">
          <div className="admin-dashboard-panel-heading">
            <div><p className="admin-dashboard-label">Product signal</p><h2 id="admin-feedback-title">Recent feedback</h2></div>
            <button type="button" className="admin-dashboard-text-button" onClick={() => go('settings')}>Open inbox <ArrowUpRight size={15} aria-hidden="true" /></button>
          </div>
          {loading && <p className="admin-dashboard-state">Checking the feedback inbox...</p>}
          {!loading && !errors.feedback && !feedback.length && <div className="admin-dashboard-empty"><Inbox size={21} aria-hidden="true" /><p><strong>No feedback yet.</strong><span>Notes from students and visitors will appear here.</span></p></div>}
          {!loading && !errors.feedback && feedback.length > 0 && (
            <div className="admin-dashboard-list">
              {feedback.slice(0, 5).map(item => (
                <div className="admin-dashboard-feedback-row" key={item.id}>
                  <div className="admin-dashboard-feedback-top"><span className={item.source === 'public' ? 'is-public' : 'is-student'}>{item.identity_label || (item.source === 'public' ? 'Public visitor' : 'Verified student')}</span><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></div>
                  <strong>{item.category || 'General feedback'}</strong>
                  <p>{item.message || 'No message provided.'}</p>
                </div>
              ))}
            </div>
          )}
          {!loading && errors.feedback && <p className="admin-dashboard-inline-error">{errors.feedback}</p>}
        </section>
      </div>

      <section className="admin-dashboard-tools" aria-labelledby="admin-tools-title">
        <div><p className="admin-dashboard-label">Admin tools</p><h2 id="admin-tools-title">Move from signal to action</h2><p>Review contributions, inspect KSA access, or read the full feedback inbox using the existing permission-aware screens.</p></div>
        <div className="admin-dashboard-tool-actions">
          <button type="button" className="admin-dashboard-action is-primary" onClick={() => go('moderation')}>Review contributions <ArrowUpRight size={15} aria-hidden="true" /></button>
          <button type="button" className="admin-dashboard-action" onClick={() => go('settings')}>Open feedback inbox <ArrowUpRight size={15} aria-hidden="true" /></button>
        </div>
      </section>

      <footer className="admin-dashboard-footer"><span>Signed in as</span><strong>{user.name || user.email}</strong><span className="admin-dashboard-role">Global administrator</span></footer>
    </div>
  );
}
