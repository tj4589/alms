import { useEffect, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { apiGet } from '../lib/api';
import './FeedbackInbox.css';

type FeedbackInboxItem = {
  id: number;
  source: 'authenticated' | 'public';
  identity_label: 'Verified student' | 'Public visitor';
  category: string;
  message: string;
  rating: number | null;
  page_path: string;
  status: string;
  created_at: string;
  user_name?: string | null;
  user_email?: string | null;
  guest_name?: string | null;
  reply_email?: string | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function FeedbackInbox() {
  const [items, setItems] = useState<FeedbackInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await apiGet('/feedback/inbox') as FeedbackInboxItem[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The feedback inbox could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="feedback-inbox" aria-labelledby="feedback-inbox-title">
      <div className="feedback-inbox-heading">
        <div>
          <p className="notes-label">Admin inbox</p>
          <h2 className="notes-title" id="feedback-inbox-title">What students and visitors are telling us</h2>
        </div>
        <button type="button" className="feedback-inbox-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh feedback inbox" title="Refresh feedback inbox"><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
      {loading && <p className="feedback-inbox-state">Checking for new feedback...</p>}
      {error && <p className="feedback-inbox-error" role="alert">{error}</p>}
      {!loading && !error && !items.length && <div className="feedback-inbox-empty"><Inbox size={19} aria-hidden="true" /><p>No feedback yet. The inbox will show notes as they arrive.</p></div>}
      <div className="feedback-inbox-list">
        {items.map((item) => (
          <article className="feedback-inbox-item" key={item.id}>
            <div className="feedback-inbox-item-top">
              <span className={`feedback-identity ${item.source === 'public' ? 'is-public' : 'is-verified'}`}>{item.identity_label}</span>
              <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
            </div>
            <div className="feedback-inbox-meta"><strong>{item.category}</strong><span>{item.page_path}</span>{item.rating && <span>{item.rating}/5 experience</span>}</div>
            <p className="feedback-inbox-message">{item.message}</p>
            {item.source === 'public' ? (
              <div className="feedback-inbox-contact">
                {item.guest_name && <span>Name: {item.guest_name}</span>}
                {item.reply_email && <span>Reply email: {item.reply_email}</span>}
                {!item.guest_name && !item.reply_email && <span>No name or reply email provided.</span>}
              </div>
            ) : (
              <div className="feedback-inbox-contact"><span>{item.user_name || 'Verified student'}</span>{item.user_email && <span>{item.user_email}</span>}</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
