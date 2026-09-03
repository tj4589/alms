import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenType, SearchActionContext, User } from '../types';
import { apiGet, apiPost } from '../lib/api';

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

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, var(--teal), var(--gold))',
  'linear-gradient(135deg, var(--coral), var(--gold))',
  'linear-gradient(135deg, var(--gold), var(--coral))',
  'linear-gradient(135deg, var(--gold), var(--teal))',
];

function avatarGradient(id: number) {
  return AVATAR_GRADIENTS[id % AVATAR_GRADIENTS.length];
}

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

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '9px 12px',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  outline: 'none',
};

export default function Collab({
  go,
  user,
  notifyUnavailable: _notifyUnavailable,
  initialContext = null,
}: {
  go: (s: ScreenType) => void;
  user: User | null;
  notifyUnavailable: (feature: string) => void;
  initialContext?: (SearchActionContext & { action?: 'discussion' }) | null;
}) {
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
  const rightPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ background: 'linear-gradient(135deg, var(--teal2), rgba(62,207,178,0.02))', borderColor: 'rgba(62,207,178,0.18)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8 }}>AI in threads</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 5 }}>Type @AI in any thread</div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6 }}>The AI responds instantly with an answer grounded in past questions — visible to everyone in the thread. It scaffolds discussion without replacing it.</div>
      </div>
      <div className="card">
        <div className="card-hd">
          <div className="card-ttl">Study groups &amp; rooms</div>
          <button className="card-lnk as-button" style={{ cursor: 'pointer' }} onClick={() => go('groups')}>
            View all →
          </button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>
          Join a Study Group for long-term collaboration, or start a Reading Room to study live with classmates tonight.
        </div>
      </div>
    </div>
  );

  // ── Thread view ────────────────────────────────────────────
  if (selectedThread) {
    return (
      <div className="page" id="s-collab">
        <div className="pg-head">
          <button className="cta cta-ghost" style={{ marginBottom: 10, fontSize: 12 }} onClick={() => { setSelectedThread(null); setMessages([]); }}>← Back to threads</button>
          <div className="pg-title"><em>{selectedThread.title}</em></div>
          <div className="pg-sub">
            Thread · started by {selectedThread.created_by_username ? `@${selectedThread.created_by_username}` : 'someone'} · {timeAgo(selectedThread.created_at)}
          </div>
        </div>
        <div className="ai-layout">
          <div className="ai-panel">
            <div className="ai-msgs" style={{ maxHeight: 460, overflowY: 'auto' }}>
              {messagesLoading && (
                <div className="msg"><div className="msg-ava ai">AI</div><div className="bubble ai">Loading messages...</div></div>
              )}
              {!messagesLoading && messages.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>No messages yet. Start the discussion below.</div>
              )}
              {messages.map((msg) => {
                const isMe = !msg.is_ai_response && msg.user_id === user?.id;
                const isAI = msg.is_ai_response;
                const displayName = msg.user_username ? `@${msg.user_username}` : '?';
                return (
                  <div className={`msg ${isMe ? 'usr' : ''}`} key={msg.id}>
                    <div className={`msg-ava ${isAI ? 'ai' : isMe ? 'usr' : 'ai'}`} style={!isAI && !isMe ? { background: avatarGradient(msg.user_id ?? 0) } : {}}>
                      {isAI ? 'AI' : isMe ? 'You' : (msg.user_username ? msg.user_username[0].toUpperCase() : '?')}
                    </div>
                    <div className={`bubble ${isMe ? 'usr' : 'ai'}`}>
                      {isAI && <div style={{ fontSize: 10, color: 'var(--teal)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>ExamMind AI</div>}
                      {!isAI && !isMe && <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, marginBottom: 3 }}>{displayName}</div>}
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{timeAgo(msg.created_at)}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={msgsEndRef} />
            </div>

            {mentionsAI && (
              <div style={{ margin: '0 20px 8px', fontSize: 12, color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="ai-dot"></div>
                AI will respond after your message is posted
              </div>
            )}

            <div className="ai-foot">
              <input
                className="ai-inp"
                type="text"
                placeholder="Reply to thread... type @AI for an AI response"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postMessage(); } }}
                disabled={posting}
              />
              <button className="send" onClick={() => void postMessage()} disabled={posting || !messageInput.trim()}>
                {posting ? '...' : '>'}
              </button>
            </div>
          </div>
          {rightPanel}
        </div>
      </div>
    );
  }

  // ── Thread list view ───────────────────────────────────────
  return (
    <div className="page" id="s-collab">
      <div className="pg-head">
        <div className="pg-title">Study <em>Collaboration</em></div>
        <div className="pg-sub">Discussions anchored to specific past questions — @AI works in any thread</div>
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">
              Active threads
              {threads.length > 0 && <span className="ni-badge" style={{ marginLeft: 8 }}>{threads.length}</span>}
            </div>
            <button className="cta" style={{ padding: '7px 14px', fontSize: 12, marginTop: 0, minHeight: 40 }} onClick={() => { setShowForm((v) => !v); setFormError(''); }}>
              {showForm ? 'Cancel' : '+ New thread'}
            </button>
          </div>

          {showForm && (
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {formError && <div className="upload-alert" style={{ marginBottom: 4 }}>{formError}</div>}
              <input
                style={inputStyle}
                type="text"
                placeholder="Thread title (e.g. Why does quicksort degrade to O(n²)?)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createThread(); }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="cta" style={{ marginTop: 0, fontSize: 12 }} onClick={() => void createThread()} disabled={creating || !newTitle.trim()}>
                  {creating ? 'Creating...' : 'Create thread'}
                </button>
                <button className="cta cta-ghost" style={{ marginTop: 0, fontSize: 12 }} onClick={() => { setShowForm(false); setNewTitle(''); setFormError(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {threadsLoading && (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>Loading threads...</div>
          )}
          {threadsError && <div className="upload-alert">{threadsError}</div>}

          {!threadsLoading && !threadsError && threads.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>
              No threads yet. Start the first discussion.
            </div>
          )}

          {!threadsLoading && threads.map((thread) => (
            <div className="collab-item" key={thread.id} onClick={() => void openThread(thread)}>
              <div className="collab-top">
                <div className="ava" style={{ width: 26, height: 26, fontSize: 10, background: avatarGradient(thread.created_by) }}>
                  {threadInitials(thread.title)}
                </div>
                <div className="collab-name">{thread.title}</div>
                <div className="collab-time">{timeAgo(thread.created_at)}</div>
              </div>
              <div className="collab-msg" style={{ color: 'var(--text3)', fontSize: 12 }}>
                Started by {thread.created_by_username ? `@${thread.created_by_username}` : 'someone'}
              </div>
            </div>
          ))}

          {!threadsLoading && !threadsError && threads.length === 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 12 }}>Example threads (no data yet)</div>
              {[
                { initials: 'CK', msg: 'Can someone explain why Bellman-Ford handles negative weights but Dijkstra doesn\'t?', link: '📄 CSC 301 · 2021 Q3a', time: '2m ago' },
                { initials: 'NE', msg: 'For BST deletion — the tricky case is two children. Key is using the inorder successor.', link: '📄 CSC 301 · 2022 Q2b', time: '18m ago' },
              ].map((demo) => (
                <div className="collab-item" key={demo.initials} style={{ opacity: .5, cursor: 'default' }}>
                  <div className="collab-top">
                    <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{demo.initials}</div>
                    <div className="collab-name">Example student</div>
                    <div className="collab-time">{demo.time}</div>
                  </div>
                  <div className="collab-msg">{demo.msg}</div>
                  <div className="collab-link">{demo.link}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {rightPanel}
      </div>
    </div>
  );
}
