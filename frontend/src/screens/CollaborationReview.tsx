import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import './CollaborationReview.css';

type Kind = 'group' | 'thread' | 'room';
type ReviewItem = { content_type: Kind; id: number; title: string | null; group_id: number | null; created_at: string | null };
type Space = { id: number; name: string; slug: string };
type ReviewPage = { items: ReviewItem[]; total: number; offset: number; limit: number };

export default function CollaborationReview() {
  const [kind, setKind] = useState<Kind>('group');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [spaceId, setSpaceId] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [page, available] = await Promise.all([
        apiGet(`/collaboration/admin/quarantine?kind=${kind}&limit=100`) as Promise<ReviewPage>,
        apiGet('/collaboration/admin/spaces') as Promise<Space[]>,
      ]);
      setItems(page.items);
      setSpaces(available);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : 'The review queue is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const assign = async () => {
    if (pendingRef.current || selected === null || !spaceId || reason.trim().length < 3) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await apiPost(`/collaboration/admin/quarantine/${kind}/${selected}/assign`, {
        learning_space_id: Number(spaceId), reason: reason.trim(),
      });
      setMessage('Learning space assigned and recorded in the audit history.');
      setSelected(null);
      setReason('');
      setSpaceId('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Assignment failed. No change was made.');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return <section className="collaboration-review" aria-labelledby="collaboration-review-title">
    <p className="admin-dashboard-label">Global administration / Collaboration</p>
    <h1 id="collaboration-review-title">Unassigned collaboration</h1>
    <p>Older records remain hidden from students until an administrator verifies their learning space. A group must be assigned before its linked discussions or rooms.</p>
    <div className="collaboration-review-actions">
      <label htmlFor="collaboration-kind">Content type</label>
      <select id="collaboration-kind" value={kind} disabled={pending} onChange={event => { setKind(event.target.value as Kind); setSelected(null); setError(''); setMessage(''); }}>
        <option value="group">Groups</option><option value="thread">Discussions</option><option value="room">Reading rooms</option>
      </select>
      <button type="button" onClick={() => void load()} disabled={loading || pending}>Refresh</button>
    </div>
    {loading && <p role="status">Loading unassigned records…</p>}
    {error && <p role="alert" className="collaboration-review-error">{error}</p>}
    {message && <p role="status" className="collaboration-review-success">{message}</p>}
    {!loading && !error && items.length === 0 && <p role="status">No unassigned {kind === 'group' ? 'groups' : kind === 'thread' ? 'discussions' : 'reading rooms'} in this queue.</p>}
    {!loading && items.map(item => <article className="collaboration-review-item" key={item.id}>
      <div><strong>{item.title || `Untitled ${kind}`}</strong><small>Record #{item.id}{item.group_id ? ` · Group #${item.group_id}` : ''}</small></div>
      <button type="button" disabled={pending} onClick={() => { setSelected(item.id); setSpaceId(''); setReason(''); setError(''); setMessage(''); }}>Review assignment</button>
      {selected === item.id && <div className="collaboration-review-form">
        <label htmlFor="collaboration-space">Verified learning space</label>
        <select id="collaboration-space" value={spaceId} disabled={pending} onChange={event => setSpaceId(event.target.value)}>
          <option value="">Select a space</option>{spaces.map(space => <option value={space.id} key={space.id}>{space.name}</option>)}
        </select>
        <label htmlFor="collaboration-reason">Evidence for assignment</label>
        <textarea id="collaboration-reason" maxLength={1000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} placeholder="Explain how you verified this record belongs to the selected space." />
        <p>This assignment publishes the record to authorized members of that space. Linked records remain restricted until reviewed separately.</p>
        <div className="collaboration-review-form-actions">
          <button type="button" onClick={() => setSelected(null)} disabled={pending}>Cancel</button>
          <button type="button" onClick={() => void assign()} disabled={pending || !spaceId || reason.trim().length < 3}>{pending ? 'Assigning…' : 'Confirm assignment'}</button>
        </div>
      </div>}
    </article>)}
    {!loading && items.length === 100 && <p>Showing the first 100 records. Review these, then refresh for the next set.</p>}
  </section>;
}
