import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenType, SearchActionContext, User } from '../types';
import { apiGet, apiPost } from '../lib/api';
import './Collab.css';

type Thread = {
  id: number;
  title: string;
  created_by: number;
  created_by_username: string | null;
  course_id: number | null;
  past_question_id: number | null;
  created_at: string;
};

type ThreadMessage = {
  id: number;
  thread_id: number;
  user_id: number | null;
  user_username: string | null;
  content: string;
  is_ai_response: boolean;
  created_at: string;
};

function threadInitials(title: string): string {
  const parts = title.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return title.slice(0, 2).toUpperCase();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}


export default function Collab({
  go,
  user,
  notifyUnavailable,
  initialContext = null,
}: {
  go: (s: ScreenType) => void;
  user: User | null;
  notifyUnavailable: (feature: string) => void;
  initialContext?: (SearchActionContext & { action?: 'discussion' }) | null;
}) {
  void notifyUnavailable;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState('');

  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [messageInput, setMessageInput] = useState('');
  const [posting, setPosting] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const msgsEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch threads ──────────────────────────────────────────
  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError('');
    try {
      const data = await apiGet('/threads') as Thread[];
      setThreads(data);
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'Could not load threads.');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (!initialContext) return;
    const topic =
      initialContext.material_title ||
      initialContext.course_title ||
      initialContext.topic ||
      initialContext.query;
    setSelectedThread(null);
    setNewTitle(`Discuss ${topic}`);
    setShowForm(true);
    setFormError('');
  }, [
    initialContext,
    initialContext?.query,
    initialContext?.topic,
    initialContext?.course_title,
    initialContext?.material_title,
    initialContext?.course_id,
  ]);

  // ── Open a thread ──────────────────────────────────────────
  const openThread = async (thread: Thread) => {
    setSelectedThread(thread);
    setMessages([]);
    setMessagesLoading(true);
    try {
      const data = await apiGet(`/threads/${thread.id}/messages`) as ThreadMessage[];
      setMessages(data);
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  // Auto-scroll messages
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Post a message ─────────────────────────────────────────
  const postMessage = async () => {
    const content = messageInput.trim();
    if (!content || !selectedThread || posting) return;
    setPosting(true);
    setMessageInput('');
    try {
      await apiPost(`/threads/${selectedThread.id}/message`, { content });
      const data = await apiGet(`/threads/${selectedThread.id}/messages`) as ThreadMessage[];
      setMessages(data);
    } catch {
      setMessageInput(content);
    } finally {
      setPosting(false);
    }
  };

  // ── Create a thread ────────────────────────────────────────
  const createThread = async () => {
    const title = newTitle.trim();
    if (!title) { setFormError('Thread title is required.'); return; }
    setCreating(true);
    setFormError('');
    try {
      await apiPost('/threads', {
        title,
        course_id: initialContext?.course_id ?? null,
      });
      setNewTitle('');
      setShowForm(false);
      await loadThreads();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create thread.');
    } finally {
      setCreating(false);
    }
  };

  const mentionsAI = messageInput.toLowerCase().includes('@ai');

  // ── Render helpers ─────────────────────────────────────────
  const meInitials = (user?.name || user?.username || 'You')
    .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  const rightPanel = (
    <aside className="collab-margin">
      <section className="margin-block">
        <p className="margin-label">AI in threads</p>
        <h2 className="margin-title">Type @AI in any thread</h2>
        <p className="margin-note">
          The assistant answers in the thread itself, grounded in past questions, where
          everyone can see it. It scaffolds the discussion rather than replacing it.
        </p>
      </section>
      <section className="margin-block margin-block--end">
        <p className="margin-label">Study together</p>
        <h2 className="margin-title">Groups and reading rooms</h2>
        <p className="margin-note">
          Join a study group for a whole course, or open a reading room to revise live tonight.
        </p>
        <button type="button" className="margin-link" onClick={() => go('groups')}>Go to study groups &rarr;</button>
      </section>
    </aside>
  );

  // ── Conversation ──────────────────────────────────────────
  if (selectedThread) {
    return (
      <div className="page" id="s-collab">
        <div className="collab-layout">
          <div>
            <div className="thread-head">
              <button type="button" className="back-link" onClick={() => { setSelectedThread(null); setMessages([]); }}>
                &larr; All discussions
              </button>
              <h1>{selectedThread.title}</h1>
              <p>
                Started by {selectedThread.created_by_username ? `@${selectedThread.created_by_username}` : 'someone'}
                {' '}&middot; {timeAgo(selectedThread.created_at)}
              </p>
            </div>

            {messagesLoading && <p className="feed-state">Loading replies...</p>}
            {!messagesLoading && messages.length === 0 && (
              <p className="feed-state">No replies yet. Answer it below, or type @AI to pull in an answer grounded in past questions.</p>
            )}

            <ul className="messages">
              {messages.map((msg) => {
                const isAI = msg.is_ai_response;
                const isMe = !isAI && msg.user_id === user?.id;
                const who = isAI ? 'ExamMind AI' : isMe ? 'You' : (msg.user_username ? `@${msg.user_username}` : 'Someone');
                const avatar = isAI ? 'AI' : isMe ? meInitials : (msg.user_username ? msg.user_username.slice(0, 2).toUpperCase() : '?');
                return (
                  <li className={`message${isAI ? ' is-ai' : ''}`} key={msg.id}>
                    <span className="message-avatar" aria-hidden="true">{avatar}</span>
                    <div>
                      <p className="message-head">
                        <span className="message-who">{who}</span>
                        <span className="message-when">{timeAgo(msg.created_at)}</span>
                      </p>
                      <p className="message-body">{msg.content}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="reply-box">
              <span className="composer-avatar" aria-hidden="true">{meInitials}</span>
              <div>
                <label className="sr-only" htmlFor="thread-reply">Reply to this thread</label>
                <textarea
                  id="thread-reply"
                  className="composer-input"
                  rows={2}
                  placeholder="Reply, or type @AI to ask the assistant..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postMessage(); } }}
                  disabled={posting}
                />
                <div className="composer-foot">
                  <span className="composer-hint">
                    {mentionsAI ? 'ExamMind AI will answer this, in the thread' : '@AI answers in the thread, for everyone'}
                  </span>
                  <button type="button" className="btn-post" onClick={() => void postMessage()} disabled={posting || !messageInput.trim()}>
                    {posting ? 'Sending...' : 'Reply'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {rightPanel}
        </div>
      </div>
    );
  }

  // ── Feed ───────────────────────────────────────────────────
  return (
    <div className="page" id="s-collab">
      <div className="pg-head">
        <div className="pg-title">Study <em>Collaboration</em></div>
        <div className="pg-sub">Discussions anchored to specific past questions. Type @AI in any thread.</div>
      </div>

      <div className="collab-layout">
        <div>
          <div className="composer">
            <span className="composer-avatar" aria-hidden="true">{meInitials}</span>
            <div>
              <label className="sr-only" htmlFor="new-thread">Start a discussion</label>
              <textarea
                id="new-thread"
                className="composer-input"
                rows={showForm || newTitle ? 3 : 1}
                placeholder="Ask the year above you something..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onFocus={() => setShowForm(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void createThread(); } }}
              />
              {formError && <div className="upload-alert" style={{ marginTop: 8 }}>{formError}</div>}
              {(showForm || newTitle) && (
                <div className="composer-foot">
                  <span className="composer-hint">Enter to post &middot; Shift+Enter for a new line</span>
                  <div className="composer-actions">
                    <button type="button" className="btn-quiet" onClick={() => { setShowForm(false); setNewTitle(''); setFormError(''); }}>Cancel</button>
                    <button type="button" className="btn-post" onClick={() => void createThread()} disabled={creating || !newTitle.trim()}>
                      {creating ? 'Posting...' : 'Post'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {threadsLoading && <p className="feed-state">Loading discussions...</p>}
          {threadsError && <div className="upload-alert">{threadsError}</div>}
          {!threadsLoading && !threadsError && threads.length === 0 && (
            <p className="feed-state">No discussions yet. Ask the first question above and your coursemates will see it.</p>
          )}

          <ul className="feed">
            {!threadsLoading && threads.map((thread) => (
              <li key={thread.id}>
                <button type="button" className="thread-row" onClick={() => void openThread(thread)}>
                  <span className="thread-avatar" aria-hidden="true">{threadInitials(thread.created_by_username || thread.title)}</span>
                  <span>
                    <span className="thread-title">{thread.title}</span>
                    <span className="thread-meta">
                      <span className="handle">{thread.created_by_username ? `@${thread.created_by_username}` : 'someone'}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{timeAgo(thread.created_at)}</span>
                    </span>
                    <span className="thread-replies">Open thread &rarr;</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {rightPanel}
      </div>
    </div>
  );
}
