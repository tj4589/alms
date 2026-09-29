import { useEffect, useState } from 'react';
import { Check, ClipboardCheck, FileText, ShieldAlert, X } from 'lucide-react';
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

export default function Moderation({ go }: { go: (screen: ScreenType) => void }) {
  const [queue, setQueue] = useState<Contribution[]>([]);
  const [selected, setSelected] = useState<Contribution | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadQueue = async () => {
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
  };

  useEffect(() => { void loadQueue(); }, []);

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

  return (
    <div className="page moderation-page">
      <div className="moderation-heading">
        <div>
          <p className="eyebrow">KSA / contribution review</p>
          <h1>Review shared material</h1>
          <p>Approve useful resources for the academy archive while keeping personal study data private.</p>
        </div>
        <button type="button" className="text-button" onClick={() => go('upload')}>Back to uploads</button>
      </div>

      {notice && <div className="moderation-notice" role="status">{notice}</div>}
      {error && <div className="moderation-error" role="alert"><ShieldAlert size={16} /> {error}</div>}

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
    </div>
  );
}
