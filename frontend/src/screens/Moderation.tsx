import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Check, ClipboardCheck, FileText, Search, ShieldAlert, X } from 'lucide-react';
import type { ScreenType } from '../types';
import { apiGet, apiPost } from '../lib/api';
import './Moderation.css';

type Contribution = {
  id: number;
  contribution_id?: number;
  material_type: string;
  material_id: number;
  moderation_status: string;
  requested_visibility?: string | null;
  review_reason?: string | null;
  submitted_at?: string | null;
  uploader?: { name?: string | null; username?: string | null } | null;
  learning_space?: { name?: string | null } | null;
  material?: { title?: string | null; file_name?: string | null; preview?: string; metadata?: Record<string, unknown> } | null;
};

type KsaAuditEvent = {
  id: number;
  action: string;
  previous_user_id?: number | null;
  current_user_id?: number | null;
  performed_by_user_id?: number | null;
  reason?: string | null;
  created_at?: string | null;
};

type KsaClaimInspection = {
  ksa_id: string;
  claimed: boolean;
  claim_status?: string | null;
  claimed_at?: string | null;
  claimant?: { id: number; name?: string | null; username?: string | null; email?: string | null } | null;
  membership?: { status?: string | null; role?: string | null; onboarding_state?: string | null; external_member_id?: string | null } | null;
  active_space?: { slug: string; name: string } | null;
  audit_history: KsaAuditEvent[];
};

type ModerationProps = { go: (screen: ScreenType) => void; isGlobalAdmin: boolean };

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function displayName(claimant: KsaClaimInspection['claimant']) {
  return claimant?.name || claimant?.username || claimant?.email || 'Student account';
}

function supportError(error: unknown, action: 'search' | 'release') {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('403') || message.includes('permission') || message.includes('admin')) return 'You do not have permission to manage KSA access.';
  if (message.includes('404') || message.includes('not found')) return 'No KSA claim was found for this ID.';
  if (message.includes('409') && (message.includes('not currently') || message.includes('owned'))) return 'This academy ID is not currently claimed.';
  if (message.includes('inconsistent')) return 'Claim records are inconsistent. No changes were made.';
  if (message.includes('422') || message.includes('invalid') || message.includes('reason')) return 'Check the academy ID or release reason.';
  return action === 'search' ? 'The KSA access record could not be loaded.' : 'Something went wrong. No changes were confirmed.';
}

export default function Moderation({ go, isGlobalAdmin }: ModerationProps) {
  const [view, setView] = useState<'contributions' | 'ksa'>('contributions');
  const [queue, setQueue] = useState<Contribution[]>([]);
  const [selected, setSelected] = useState<Contribution | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ksaId, setKsaId] = useState('');
  const [claim, setClaim] = useState<KsaClaimInspection | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<KsaClaimInspection | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/collaboration/moderation/contributions?status=pending_review');
      const next = Array.isArray(data) ? data as Contribution[] : [];
      setQueue(next);
      setSelected(current => current ? next.find(item => item.id === current.id) || null : next[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The moderation queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'contributions') void loadQueue();
  }, [loadQueue, view]);

  useEffect(() => {
    if (!releaseTarget) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => reasonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [releaseTarget]);

  const decide = async (status: 'approved' | 'rejected' | 'changes_requested', markOfficial = false) => {
    if (!selected) return;
    if (status !== 'approved' && !reason.trim()) {
      setError('Add a short reason so the contributor knows what to change.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiPost(`/collaboration/moderation/contributions/${selected.id}/decision`, {
        status,
        reason: reason.trim() || undefined,
        mark_official: markOfficial,
      });
      setNotice(status === 'approved' ? (markOfficial ? 'Material marked official.' : 'Material approved for the KSA archive.') : 'Contributor feedback saved.');
      setReason('');
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That moderation decision could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const closeReleaseDialog = () => {
    setReleaseTarget(null);
    setReleaseReason('');
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  };

  const searchClaim = async (event: FormEvent) => {
    event.preventDefault();
    const canonical = ksaId.trim().toUpperCase();
    if (!/^KSA-\d{2}$/.test(canonical)) {
      setError('Enter a valid academy ID such as KSA-78.');
      setClaim(null);
      return;
    }
    setKsaId(canonical);
    setClaimLoading(true);
    setError('');
    setNotice('');
    setClaim(null);
    setHistoryOpen(false);
    try {
      const data = await apiGet(`/learning-spaces/ksa/admin/claims/${canonical}`);
      setClaim(data as KsaClaimInspection);
    } catch (err) {
      setError(supportError(err, 'search'));
    } finally {
      setClaimLoading(false);
    }
  };

  const releaseClaim = async (event: FormEvent) => {
    event.preventDefault();
    if (!releaseTarget || !releaseReason.trim()) return;
    setReleaseBusy(true);
    setError('');
    setNotice('');
    try {
      await apiPost(`/learning-spaces/ksa/admin/claims/${releaseTarget.ksa_id}/release`, { reason: releaseReason.trim() });
      const releasedId = releaseTarget.ksa_id;
      closeReleaseDialog();
      const refreshed = await apiGet(`/learning-spaces/ksa/admin/claims/${releasedId}`);
      setClaim(refreshed as KsaClaimInspection);
      setHistoryOpen(true);
      setNotice(`${releasedId} has been released and can now be claimed again.`);
    } catch (err) {
      setError(supportError(err, 'release'));
    } finally {
      setReleaseBusy(false);
    }
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReleaseDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, textarea')).filter(element => !element.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="page moderation-page">
      <div className="moderation-heading">
        <div>
          <p className="eyebrow">KSA / stewardship</p>
          <h1>Review and support access</h1>
          <p>Approve useful resources for the academy archive and resolve academy-ID access issues without changing student ownership directly.</p>
        </div>
        <button type="button" className="text-button" onClick={() => go('upload')}>Back to uploads</button>
      </div>

      <div className="moderation-tabs" role="tablist" aria-label="Stewardship tools">
        <button type="button" role="tab" aria-selected={view === 'contributions'} className={view === 'contributions' ? 'is-active' : ''} onClick={() => { setView('contributions'); setError(''); setNotice(''); }}>Contributions</button>
        {isGlobalAdmin && <button type="button" role="tab" data-testid="ksa-access-tab" aria-selected={view === 'ksa'} className={view === 'ksa' ? 'is-active' : ''} onClick={() => { setView('ksa'); setError(''); setNotice(''); }}>KSA Access</button>}
      </div>

      {notice && <div className="moderation-notice" role="status">{notice}</div>}
      {error && <div className="moderation-error" role="alert"><ShieldAlert size={16} /> <span>{error}</span></div>}

      {view === 'ksa' && isGlobalAdmin ? (
        <section className="moderation-support" aria-label="KSA access support">
          <div className="moderation-support-head">
            <div>
              <p className="eyebrow">Global administrator support</p>
              <h2>Inspect academy access</h2>
              <p>Search a canonical KSA ID to inspect its claim, membership state and immutable audit history.</p>
            </div>
            <span className="moderation-support-note">No direct reassignment</span>
          </div>
          <form className="moderation-search" onSubmit={searchClaim}>
            <label htmlFor="ksa-search">Search academy ID</label>
            <div className="moderation-search-row">
              <input id="ksa-search" value={ksaId} onChange={event => setKsaId(event.target.value)} placeholder="KSA-78" autoComplete="off" />
              <button type="submit" className="moderation-button moderation-button--primary" disabled={claimLoading}><Search size={16} /> {claimLoading ? 'Searching…' : 'Search'}</button>
            </div>
            <span className="moderation-help">Use the format KSA-78. Inspection shows only support-safe account and membership details.</span>
          </form>

          {claim && (
            <div className="moderation-claim-result" data-testid="ksa-claim-result">
              <div className="moderation-claim-head">
                <div><p className="eyebrow">{claim.ksa_id}</p><h2>{claim.claimed ? 'Claimed access' : claim.claim_status === 'released' ? 'Released access' : 'Unclaimed access'}</h2></div>
                <span className={`moderation-state moderation-state--${claim.claimed ? 'active' : claim.claim_status === 'released' ? 'released' : 'available'}`}>{claim.claimed ? 'Claimed' : claim.claim_status === 'released' ? 'Released / Available' : 'Unclaimed'}</span>
              </div>
              <div className="moderation-facts moderation-facts--claim">
                <div><span>Claimed by</span><strong>{claim.claimed ? displayName(claim.claimant) : 'No current claimant'}</strong>{claim.claimed && claim.claimant?.email && <small>{claim.claimant.email}</small>}</div>
                <div><span>Membership</span><strong>{claim.membership?.status === 'active' ? 'Active' : claim.membership?.status === 'inactive' ? 'Inactive' : 'Not created'}</strong><small>{claim.membership?.role || '—'} · {claim.membership?.onboarding_state || '—'}</small></div>
                <div><span>Active space</span><strong>{claim.active_space?.name || 'None selected'}</strong><small>{claim.active_space?.slug || 'No active context'}</small></div>
                <div><span>Claimed at</span><strong>{formatDate(claim.claimed_at)}</strong></div>
              </div>
              <div className="moderation-claim-actions">
                <button type="button" className="moderation-button moderation-button--quiet" data-testid="history-toggle" onClick={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen}>{historyOpen ? 'Hide history' : 'View history'}</button>
                {claim.claimed && <button type="button" className="moderation-button moderation-button--danger" data-testid="release-claim-button" onClick={() => { setReleaseTarget(claim); setReleaseReason(''); }} disabled={releaseBusy}>Release claim</button>}
              </div>
              {historyOpen && <div className="moderation-timeline" aria-label="KSA claim history">
                {claim.audit_history.length === 0 ? <p>No audit events recorded.</p> : [...claim.audit_history].reverse().map(event => (
                  <div className="moderation-timeline-event" key={event.id}>
                    <span className="moderation-timeline-dot" aria-hidden="true" />
                    <div><strong>{event.action === 'RELEASED' ? 'Claim released' : 'Claim recorded'}</strong><span>{formatDate(event.created_at)} · Performed by account {event.performed_by_user_id ?? 'not recorded'}</span>{event.reason && <p>{event.reason}</p>}</div>
                  </div>
                ))}
              </div>}
            </div>
          )}
        </section>
      ) : (
        <div className="moderation-layout">
          <section className="moderation-queue" aria-label="Pending contributions">
            <div className="moderation-panel-head"><span>Pending review</span><strong>{queue.length}</strong></div>
            {loading && <div className="moderation-empty">Loading the review queue…</div>}
            {!loading && queue.length === 0 && <div className="moderation-empty"><ClipboardCheck size={28} /><strong>Nothing waiting</strong><span>New KSA contributions will appear here after explicit consent.</span></div>}
            {!loading && queue.map(item => (
              <button type="button" className={`moderation-row${selected?.id === item.id ? ' is-selected' : ''}`} key={item.id} onClick={() => { setSelected(item); setReason(''); setError(''); }}>
                <span className="moderation-row-icon"><FileText size={16} /></span>
                <span className="moderation-row-copy"><strong>{item.material?.title || 'Untitled material'}</strong><span>{item.uploader?.name || item.uploader?.username || 'Student contributor'} · {item.material_type}</span></span>
                <span className="moderation-status">Pending</span>
              </button>
            ))}
          </section>

          <section className="moderation-review" aria-label="Contribution details">
            {!selected ? <div className="moderation-empty moderation-empty--detail"><FileText size={30} /><strong>Select a contribution</strong><span>Inspect metadata and the readable preview before deciding.</span></div> : (
              <>
                <div className="moderation-review-head">
                  <div><p className="eyebrow">{selected.learning_space?.name || 'KSA learning space'}</p><h2>{selected.material?.title || 'Untitled material'}</h2><p>Submitted by {selected.uploader?.name || selected.uploader?.username || 'a student contributor'}.</p></div>
                  <span className="moderation-pill">Pending review</span>
                </div>
                <div className="moderation-facts">
                  <div><span>File</span><strong>{selected.material?.file_name || 'Stored resource'}</strong></div>
                  <div><span>Requested access</span><strong>Verified KSA students</strong></div>
                  <div><span>Ownership</span><strong>Preserved with contributor</strong></div>
                </div>
                <div className="moderation-preview"><div className="eyebrow">Readable preview</div><p>{selected.material?.preview || 'No text preview is available. Use the authorized resource reader or download controls to inspect the original.'}</p></div>
                <label className="moderation-reason"><span>Decision note {selected && '(required for changes or rejection)'}</span><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain anything the contributor should correct or verify." rows={4} /></label>
                <div className="moderation-actions">
                  <button type="button" className="moderation-button moderation-button--quiet" onClick={() => void decide('changes_requested')} disabled={busy}><X size={16} /> Request changes</button>
                  <button type="button" className="moderation-button moderation-button--danger" onClick={() => void decide('rejected')} disabled={busy}>Reject</button>
                  <button type="button" className="moderation-button moderation-button--primary" onClick={() => void decide('approved')} disabled={busy}><Check size={16} /> Approve archive</button>
                </div>
                <button type="button" className="moderation-official" onClick={() => void decide('approved', true)} disabled={busy}>Approve and mark official</button>
              </>
            )}
          </section>
        </div>
      )}

      {releaseTarget && <div className="moderation-dialog-backdrop" role="presentation">
        <div className="moderation-dialog" role="dialog" aria-modal="true" aria-labelledby="release-dialog-title" aria-describedby="release-dialog-description" onKeyDown={onDialogKeyDown}>
          <div className="moderation-dialog-head"><div><p className="eyebrow">Confirm support action</p><h2 id="release-dialog-title">Release {releaseTarget.ksa_id}?</h2></div><button type="button" className="moderation-dialog-close" onClick={closeReleaseDialog} aria-label="Close release dialog"><X size={18} /></button></div>
          <p id="release-dialog-description">This will remove this user’s KSA access and make {releaseTarget.ksa_id} available for another user to claim. Their uploaded resources and learning history will not be deleted.</p>
          <form onSubmit={releaseClaim}>
            <label className="moderation-reason"><span>Reason <strong aria-hidden="true">*</strong></span><textarea ref={reasonRef} value={releaseReason} onChange={event => setReleaseReason(event.target.value)} placeholder="Explain why this claim is being released." rows={4} required /></label>
            <div className="moderation-dialog-actions"><button type="button" className="moderation-button moderation-button--quiet" onClick={closeReleaseDialog}>Cancel</button><button type="submit" className="moderation-button moderation-button--danger" disabled={releaseBusy || !releaseReason.trim()}>{releaseBusy ? 'Releasing…' : 'Release claim'}</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
