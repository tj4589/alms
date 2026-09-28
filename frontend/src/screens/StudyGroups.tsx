import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, Clock3, Link2, MessageCircle, Plus, Search, Share2, Sparkles, Users, Video } from 'lucide-react';
import type { ScreenType, SearchActionContext, User } from '../types';
import { apiGet, apiPost } from '../lib/api';
import './StudyGroups.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type Course = {
  id: number;
  code: string;
  name: string;
};

function groupInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

function tintClass(id: number): string {
  return `t${id % 4}`;
}

type StudyGroup = {
  id: number;
  name: string;
  description: string | null;
  course_id: number | null;
  topic: string | null;
  created_by_username: string | null;
  created_at: string;
  member_count: number;
  is_member: boolean;
  visibility?: 'public' | 'unlisted' | 'private';
  status?: string;
  welcome_message?: string | null;
};

type GroupMember = {
  user_id: number;
  username: string | null;
  name: string;
  role?: string;
  joined_at: string;
};

type GroupPost = {
  id: number;
  username: string | null;
  content: string;
  post_type: 'discussion' | 'announcement' | 'lounge' | string;
  created_at: string;
};

type StudySession = {
  id: number;
  title: string;
  description: string | null;
  course_id: number | null;
  topic: string | null;
  exam_goal: string | null;
  group_id: number | null;
  creator_username: string | null;
  school_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  created_at: string;
  participant_count: number;
  studying_count: number;
  on_break_count: number;
  my_status: string | null;
  participants?: SessionParticipant[];
};

type SessionParticipant = {
  user_id: number;
  username: string | null;
  joined_at: string;
  last_seen_at: string;
  status: string;
  break_until?: string | null;
  is_active: boolean;
};

type RoomMessage = {
  id: number;
  session_id: number;
  user_id: number | null;
  username: string | null;
  content: string;
  message_type: string;
  created_at: string;
};

type AICard = {
  id: number;
  session_id: number;
  asked_by: number;
  asked_by_username: string | null;
  question: string;
  answer: string;
  sources: string[];
  past_question_sources: string[];
  lecture_note_sources: string[];
  no_past_questions_found: boolean;
  no_lecture_notes_found: boolean;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}




// ── Room Detail ───────────────────────────────────────────────────────────────

function RoomDetail({
  session,
  user,
  onBack,
  go,
}: {
  session: StudySession;
  user: User | null;
  onBack: () => void;
  go: (s: ScreenType, username?: string | null) => void;
}) {
  const [roomTab, setRoomTab] = useState<'focus' | 'board' | 'chat' | 'people'>('focus');
  const [detail, setDetail] = useState<StudySession>(session);
  const [msgs, setMsgs] = useState<RoomMessage[]>([]);
  const [board, setBoard] = useState<AICard[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [sending, setSending] = useState(false);
  const [aiAsking, setAiAsking] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [breakMenuOpen, setBreakMenuOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [aiError, setAiError] = useState('');
  const [roomShareNote, setRoomShareNote] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());

  const msgsEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, m, b] = await Promise.all([
        apiGet(`/study-sessions/${session.id}`) as Promise<StudySession>,
        apiGet(`/study-sessions/${session.id}/messages`) as Promise<RoomMessage[]>,
        apiGet(`/study-sessions/${session.id}/ai-board`) as Promise<AICard[]>,
      ]);
      setDetail(d as StudySession);
      setMsgs(m as RoomMessage[]);
      setBoard(b as AICard[]);
      apiPost(`/study-sessions/${session.id}/heartbeat`, {}).catch(() => {});
    } catch {
      // silent — stale data is fine
    }
  }, [session.id]);

  useEffect(() => {
    setLoadError('');
    if (session.status === 'scheduled') {
      void refresh();
    } else {
      apiPost(`/study-sessions/${session.id}/join`, {})
        .then(() => refresh())
        .catch(() => refresh());
    }

    const interval = setInterval(() => void refresh(), 10000);
    return () => clearInterval(interval);
  }, [session.id, session.status, refresh]);

  useEffect(() => {
    if (roomTab === 'chat') {
      msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs, roomTab]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const takeBreak = async (duration = 5) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await apiPost(`/study-sessions/${session.id}/break`, { duration_minutes: duration });
      setDetail((d) => ({ ...d, my_status: 'on_break' }));
      setBreakMenuOpen(false);
      void refresh();
    } finally { setActionLoading(false); }
  };

  const backToStudy = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await apiPost(`/study-sessions/${session.id}/back`, {});
      setDetail((d) => ({ ...d, my_status: 'studying' }));
      void refresh();
    } finally { setActionLoading(false); }
  };

  const leaveRoom = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try { await apiPost(`/study-sessions/${session.id}/leave`, {}); }
    finally { setActionLoading(false); }
    onBack();
  };

  const shareRoom = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: detail.title, text: 'Join this ExamMind reading room', url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setRoomShareNote('Room link copied.');
    } catch {
      // A cancelled native share is not an error worth surfacing.
    }
    window.setTimeout(() => setRoomShareNote(''), 2400);
  };

  const sendChat = async () => {
    const content = chatInput.trim();
    if (!content || sending) return;
    setSending(true);
    setChatInput('');
    try {
      await apiPost(`/study-sessions/${session.id}/messages`, { content });
      const newMsgs = await apiGet(`/study-sessions/${session.id}/messages`) as RoomMessage[];
      setMsgs(newMsgs);
    } catch { setChatInput(content); }
    finally { setSending(false); }
  };

  const askAI = async () => {
    const question = aiInput.trim();
    if (!question || aiAsking) return;
    setAiAsking(true);
    setAiInput('');
    setAiError('');
    try {
      const card = await apiPost(`/study-sessions/${session.id}/ask-ai`, { question }) as AICard;
      setBoard((prev) => [...prev, card]);
      const newMsgs = await apiGet(`/study-sessions/${session.id}/messages`) as RoomMessage[];
      setMsgs(newMsgs);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI question failed. Is AI configured?');
      setAiInput(question);
    } finally { setAiAsking(false); }
  };

  const myStatus = detail.my_status;
  const isOnBreak = myStatus === 'on_break';
  const startsAt = detail.starts_at ? new Date(detail.starts_at).getTime() : clockNow;
  const endsAt = detail.ends_at ? new Date(detail.ends_at).getTime() : startsAt + 25 * 60000;
  const totalSeconds = Math.max(1, Math.round((endsAt - startsAt) / 1000));
  const elapsedSeconds = Math.min(totalSeconds, Math.max(0, Math.round((clockNow - startsAt) / 1000)));
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  const progress = Math.min(100, Math.max(0, (elapsedSeconds / totalSeconds) * 100));
  const myParticipant = detail.participants?.find((participant) => participant.user_id === user?.id);
  const breakUntil = myParticipant?.break_until ? new Date(myParticipant.break_until).getTime() : null;
  const breakRemainingSeconds = breakUntil ? Math.max(0, Math.round((breakUntil - clockNow) / 1000)) : 0;

  // ── Room header ──────────────────────────────────────────────────────────

  const roomHeader = (
    <div className="card room-header-card" style={{ marginBottom: 16 }}>
      <div className="room-header-inner" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{detail.title}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
            {[detail.topic, detail.exam_goal].filter(Boolean).join(' · ')}
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>
              {detail.studying_count} studying
            </span>
            {detail.on_break_count > 0 && (
              <span style={{ fontSize: 12, color: 'var(--gold)' }}>
                {detail.on_break_count} on break
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {detail.participant_count} in room · by @{detail.creator_username ?? 'someone'}
            </span>
            {myStatus && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: isOnBreak ? 'rgba(232,162,58,0.12)' : 'rgba(62,207,178,0.12)',
                color: isOnBreak ? 'var(--gold)' : 'var(--teal)',
                border: `1px solid ${isOnBreak ? 'rgba(232,162,58,0.3)' : 'rgba(62,207,178,0.3)'}`,
              }}>
                {isOnBreak ? '☕ On break' : '📖 Studying'}
              </span>
            )}
            {detail.status === 'scheduled' && detail.starts_at && (
              <span style={{ fontSize: 11, color: 'var(--gold)' }}>
                Starts {new Date(detail.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </div>
        </div>
        <div className="room-header-actions" style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {detail.status === 'scheduled' ? null : isOnBreak ? (
            <button
              className="cta"
              style={{ marginTop: 0, fontSize: 12, padding: '7px 14px', minHeight: 40 }}
              onClick={() => void backToStudy()}
              disabled={actionLoading}
            >
              Back to Study
            </button>
          ) : (
            <div className="room-break-control">
            <button
              className="cta cta-ghost"
              style={{ marginTop: 0, fontSize: 12, padding: '7px 14px' }}
              onClick={() => setBreakMenuOpen((current) => !current)}
              disabled={actionLoading}
            >
              Take Break
            </button>
            {breakMenuOpen && <div className="room-break-menu" role="menu" aria-label="Choose break duration"><span>Take a break for</span>{[5, 10, 15].map((minutes) => <button type="button" role="menuitem" key={minutes} onClick={() => void takeBreak(minutes)}>{minutes} min</button>)}</div>}
            </div>
          )}
          <button
            className="cta cta-ghost"
            style={{ marginTop: 0, fontSize: 12, padding: '7px 14px' }}
            onClick={() => void shareRoom()}
          >
            <Share2 size={14} aria-hidden="true" /> Share room
          </button>
          <button
            className="cta cta-ghost"
            style={{ marginTop: 0, fontSize: 12, padding: '7px 14px', color: 'var(--text3)' }}
            onClick={() => void leaveRoom()}
            disabled={actionLoading}
          >
            Leave Room
          </button>
        </div>
      </div>
      {roomShareNote && <div className="room-share-note" role="status">{roomShareNote}</div>}
    </div>
  );

  // ── AI Board ─────────────────────────────────────────────────────────────

  const focusPanel = (
    <div className="room-focus-layout">
      <section className="card room-focus-card" aria-labelledby="room-focus-title">
        <div className="room-focus-kicker">Focus window</div>
        <h2 id="room-focus-title">Keep the next 25 minutes simple.</h2>
        <p className="room-focus-copy">The room timer follows the server session. Your break time is kept separate from study time.</p>
        <div className={`room-timer${isOnBreak ? ' is-break' : ''}`} aria-live="polite">
          <span>{isOnBreak ? 'Break remaining' : detail.status === 'scheduled' ? 'Starts in' : 'Time left'}</span>
          <strong>{formatDuration(isOnBreak ? breakRemainingSeconds : detail.status === 'scheduled' ? Math.max(0, Math.round((startsAt - clockNow) / 1000)) : remainingSeconds)}</strong>
        </div>
        <div className="room-progress" aria-label={`${Math.round(progress)} percent of the room elapsed`}><span style={{ width: `${progress}%` }} /></div>
        <div className="room-focus-meta">
          <span>{detail.topic || 'Open study session'}</span>
          <span>{detail.participant_count} present</span>
        </div>
        {isOnBreak && <p className="room-break-note">Take the pause. Resume when you are ready to get back in.</p>}
      </section>
      <section className="card room-activity-card" aria-labelledby="room-activity-title">
        <div className="card-hd"><div id="room-activity-title" className="card-ttl">Room pulse</div><Clock3 size={16} aria-hidden="true" /></div>
        <div className="room-pulse-row"><strong>{detail.studying_count}</strong><span>studying now</span></div>
        <div className="room-pulse-row"><strong>{detail.on_break_count}</strong><span>on a short break</span></div>
        <div className="room-pulse-row"><strong>{msgs.filter((message) => message.message_type === 'chat').length}</strong><span>messages shared</span></div>
      </section>
    </div>
  );

  const aiBoard = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Ask AI input */}
      <div className="card room-ai-card" style={{ background: 'linear-gradient(135deg, var(--bg2), rgba(62,207,178,0.025))', borderColor: 'rgba(62,207,178,0.18)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, color: 'var(--teal)', marginBottom: 8 }}>
          Ask ExamMind AI
        </div>
        <div className="room-ai-row" style={{ display: 'flex', gap: 8 }}>
          <input
            className="ai-inp"
            type="text"
            placeholder="Ask a question — answer appears as a study card for everyone"
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void askAI(); } }}
            disabled={aiAsking}
            style={{ flex: 1 }}
          />
          <button
            className="cta"
            style={{ marginTop: 0, flexShrink: 0, fontSize: 12, padding: '0 16px', height: 40 }}
            onClick={() => void askAI()}
            disabled={aiAsking || !aiInput.trim()}
          >
            {aiAsking ? '…' : 'Ask AI'}
          </button>
        </div>
        {aiAsking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--teal)' }}>
            <div className="ai-dot" />&nbsp;Generating answer from knowledge base…
          </div>
        )}
        {aiError && (
          <div className="upload-alert" style={{ marginTop: 8, fontSize: 12 }}>{aiError}</div>
        )}
      </div>

      {board.length === 0 && !aiAsking && (
        <div className="empty-state" style={{ padding: '20px 0' }}>
          <div className="empty-title">No AI questions yet</div>
          <div className="empty-body">Ask the first question above. Every answer becomes a shared study card for this room.</div>
        </div>
      )}

      {board.map((card) => (
        <div
          key={card.id}
          className="card"
          style={{ borderLeft: '3px solid rgba(62,207,178,0.4)', padding: '16px 18px' }}
        >
          {/* Card header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div
              className="msg-ava ai"
              style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}
            >
              {(card.asked_by_username || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                @{card.asked_by_username ?? 'student'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 6 }}>
                asked ExamMind AI · {timeAgo(card.created_at)}
              </span>
            </div>
          </div>

          {/* Question */}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, padding: '6px 10px', background: 'var(--bg3)', borderRadius: 6 }}>
            Q: {card.question}
          </div>

          {/* Answer */}
          <div style={{ fontSize: 13.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', color: 'var(--text)', marginBottom: 10 }}>
            {card.answer}
          </div>

          {/* Sources */}
          {(card.past_question_sources.length > 0 || card.lecture_note_sources.length > 0) && (
            <div style={{ marginBottom: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>Sources</div>
              {card.past_question_sources.map((s, i) => (
                <div key={`pq-${i}`} style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 2 }}>· {s}</div>
              ))}
              {card.lecture_note_sources.map((s, i) => (
                <div key={`ln-${i}`} style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 2 }}>· {s}</div>
              ))}
            </div>
          )}

          {/* Flags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {!card.no_past_questions_found && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(232,162,58,0.12)', color: 'var(--gold)', border: '1px solid rgba(232,162,58,0.25)' }}>
                Found in past questions
              </span>
            )}
            {!card.no_lecture_notes_found && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(62,207,178,0.1)', color: 'var(--teal)', border: '1px solid rgba(62,207,178,0.25)' }}>
                Found in lecture notes
              </span>
            )}
            {card.no_past_questions_found && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}>
                No past question found
              </span>
            )}
            {card.no_lecture_notes_found && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}>
                No lecture note found
              </span>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="cta cta-ghost"
              style={{ marginTop: 0, fontSize: 11, padding: '4px 11px' }}
              onClick={() => setAiInput(`Follow up on: ${card.question.slice(0, 60)}`)}
            >
              Ask follow-up
            </button>
            <button
              className="cta cta-ghost"
              style={{ marginTop: 0, fontSize: 11, padding: '4px 11px' }}
              onClick={() => go('practice')}
            >
              Generate practice
            </button>
            <button
              className="cta cta-ghost"
              style={{ marginTop: 0, fontSize: 11, padding: '4px 11px' }}
              onClick={() => { setChatInput(`Let's discuss: ${card.question.slice(0, 60)}`); setRoomTab('chat'); }}
            >
              Discuss this
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  // ── Discussion Chat ──────────────────────────────────────────────────────

  const chatPanel = (
    <div className="room-chat-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: 480, paddingBottom: 4 }}>
        {msgs.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>
            No messages yet. Say hello to your study group!
          </div>
        )}
        {msgs.map((msg) => {
          const isMe = msg.user_id === user?.id;
          const isEvent = msg.message_type === 'ai_event';
          if (isEvent) {
            return (
              <div key={msg.id} style={{ textAlign: 'center', padding: '6px 0', margin: '4px 0' }}>
                <span style={{ fontSize: 11.5, color: 'var(--teal)', background: 'rgba(62,207,178,0.08)', padding: '3px 10px', borderRadius: 20 }}>
                  @{msg.username ?? 'someone'} {msg.content} ·{' '}
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'var(--font)', padding: 0 }}
                    onClick={() => setRoomTab('board')}
                  >
                    View answer →
                  </button>
                </span>
              </div>
            );
          }
          return (
            <div className={`msg ${isMe ? 'usr' : ''}`} key={msg.id} style={{ marginBottom: 6 }}>
              <div className={`msg-ava ${isMe ? 'usr' : 'ai'}`}>
                {(msg.username || '?')[0].toUpperCase()}
              </div>
              <div className={`bubble ${isMe ? 'usr' : 'ai'}`}>
                {!isMe && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, marginBottom: 2 }}>
                    @{msg.username ?? 'someone'}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{timeAgo(msg.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={msgsEndRef} />
      </div>

      <div className="ai-foot room-chat-composer" style={{ marginTop: 10 }}>
        <input
          className="ai-inp"
          type="text"
          placeholder="Send a message to the room…"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
          disabled={sending}
        />
        <button
          className="send"
          onClick={() => void sendChat()}
          disabled={sending || !chatInput.trim()}
        >
          {sending ? '...' : '>'}
        </button>
      </div>
    </div>
  );

  // ── People ───────────────────────────────────────────────────────────────

  const peoplePanel = (
    <div className="room-people-list">
      {detail.participant_count === 0 && (!detail.participants || detail.participants.length === 0) && (
        <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
          No active participants right now.
        </div>
      )}
      {detail.participant_count > 0 && (!detail.participants || detail.participants.length === 0) && <div className="room-people-sync-note">{detail.participant_count} participant{detail.participant_count === 1 ? '' : 's'} active. Refreshing the people list…</div>}
      {detail.participants?.map((p) => (
        <div className="room-person" key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div
            className="ava"
            style={{
              width: 30,
              height: 30,
              fontSize: 12,
              background: p.status === 'on_break' ? 'rgba(232,162,58,0.15)' : 'var(--teal2)',
              border: `1px solid ${p.status === 'on_break' ? 'rgba(232,162,58,0.3)' : 'rgba(62,207,178,0.3)'}`,
              color: p.status === 'on_break' ? 'var(--gold)' : 'var(--teal)',
            }}
          >
            {(p.username || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>@{p.username ?? 'student'}</div>
          </div>
          <span style={{
            fontSize: 11,
            padding: '2px 7px',
            borderRadius: 4,
            background: p.status === 'on_break' ? 'rgba(232,162,58,0.1)' : 'rgba(62,207,178,0.1)',
            color: p.status === 'on_break' ? 'var(--gold)' : 'var(--teal)',
          }}>
            {p.status === 'on_break' ? '☕ break' : '📖 studying'}
          </span>
        </div>
      ))}
    </div>
  );

  // ── Room layout ──────────────────────────────────────────────────────────

  return (
    <div className="page" id="s-room">
      <div className="room-back-row" style={{ marginBottom: 12 }}>
        <button
          className="cta cta-ghost room-back-button"
          style={{ fontSize: 12, padding: '6px 12px', marginTop: 0 }}
          onClick={onBack}
        >
          ← Back to Reading Rooms
        </button>
      </div>

      {loadError && <div className="upload-alert" style={{ marginBottom: 12 }}>{loadError}</div>}

      {roomHeader}

      {/* Tabs */}
      <div className="gs-tabs room-tabs" role="tablist" aria-label="Reading room workspace">
        <button className={`gs-tab${roomTab === 'focus' ? ' is-on' : ''}`} aria-current={roomTab === 'focus' ? 'page' : undefined} onClick={() => setRoomTab('focus')}>
          <Clock3 size={15} aria-hidden="true" /> Focus
        </button>
        <button className={`gs-tab${roomTab === 'board' ? ' is-on' : ''}`} aria-current={roomTab === 'board' ? 'page' : undefined} onClick={() => setRoomTab('board')}>
          <Sparkles size={15} aria-hidden="true" /> AI Board {board.length > 0 ? `(${board.length})` : ''}
        </button>
        <button className={`gs-tab${roomTab === 'chat' ? ' is-on' : ''}`} aria-current={roomTab === 'chat' ? 'page' : undefined} onClick={() => setRoomTab('chat')}>
          <MessageCircle size={15} aria-hidden="true" /> Discussion {msgs.filter(m => m.message_type === 'chat').length > 0 ? `(${msgs.filter(m => m.message_type === 'chat').length})` : ''}
        </button>
        <button className={`gs-tab${roomTab === 'people' ? ' is-on' : ''}`} aria-current={roomTab === 'people' ? 'page' : undefined} onClick={() => setRoomTab('people')}>
          <Users size={15} aria-hidden="true" /> People ({detail.participant_count})
        </button>
      </div>

      {/* Desktop two-col for board tab; full width for others */}
      {roomTab === 'focus' ? (
        focusPanel
      ) : roomTab === 'board' ? (
        <div className="two-col" style={{ alignItems: 'flex-start' }}>
          <div>{aiBoard}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Participants */}
            <div className="card">
              <div className="card-hd">
                <div className="card-ttl">In this room</div>
                <span className="ni-badge">{detail.participant_count}</span>
              </div>
              {peoplePanel}
            </div>
            {/* Mini chat */}
            <div className="card">
              <div className="card-hd">
                <div className="card-ttl">Discussion</div>
                <button className="card-lnk as-button" style={{ cursor: 'pointer' }} onClick={() => setRoomTab('chat')}>
                  Open →
                </button>
              </div>
              {msgs.filter(m => m.message_type === 'chat').slice(-3).map((msg) => (
                <div key={msg.id} style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text3)' }}>@{msg.username ?? 'student'}</span>{' '}{msg.content}
                </div>
              ))}
              {msgs.filter(m => m.message_type === 'chat').length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>No chat messages yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : roomTab === 'chat' ? (
        <div className="two-col" style={{ alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: 2 }}>{chatPanel}</div>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">In this room</div><span className="ni-badge">{detail.participant_count}</span></div>
            {peoplePanel}
          </div>
        </div>
      ) : (
        <div className="card">{peoplePanel}</div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function StudyGroups({
  go,
  notifyUnavailable,
  user,
  initialContext = null,
}: {
  go: (s: ScreenType, username?: string | null) => void;
  notifyUnavailable: (feature: string) => void;
  user: User | null;
  initialContext?: (SearchActionContext & { action?: 'study_group' | 'reading_room' }) | null;
}) {
  void notifyUnavailable;
  const [mainTab, setMainTab] = useState<'groups' | 'rooms'>('groups');
  const [selectedSession, setSelectedSession] = useState<StudySession | null>(null);

  // ── Study Groups state ────────────────────────────────────────────────────
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseState, setCourseState] = useState<'loading' | 'ready' | 'empty' | 'unavailable'>('loading');
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const [groupView, setGroupView] = useState<'discover' | 'mine' | 'recommended'>('discover');
  const [groupCourseFilter, setGroupCourseFilter] = useState<number | ''>('');
  const [groupSearch, setGroupSearch] = useState('');
  const [showJoinLink, setShowJoinLink] = useState(false);
  const [joinLinkValue, setJoinLinkValue] = useState('');
  const [joinLinkError, setJoinLinkError] = useState('');
  const [joiningLink, setJoiningLink] = useState(false);
  const [profileCourseIds, setProfileCourseIds] = useState<number[]>([]);
  const [shareNote, setShareNote] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [groupActionPending, setGroupActionPending] = useState<number | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  const [openGroup, setOpenGroup] = useState<StudyGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<number, GroupMember[]>>({});
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTopic, setFormTopic] = useState('');
  const [formCourseId, setFormCourseId] = useState<number | ''>('');
  const [formVisibility, setFormVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupFormError, setGroupFormError] = useState('');
  const [groupTab, setGroupTab] = useState<'home' | 'discussions' | 'rooms' | 'materials' | 'members' | 'lounge'>('home');
  const [groupHome, setGroupHome] = useState<{ group: StudyGroup & { welcome_message?: string | null }; tabs: Record<string, number>; checklist: Record<string, boolean>; my_role?: string | null } | null>(null);
  const [groupPosts, setGroupPosts] = useState<GroupPost[]>([]);
  const [groupPostInput, setGroupPostInput] = useState('');
  const [groupPostType, setGroupPostType] = useState<'discussion' | 'lounge'>('discussion');
  const [groupPosting, setGroupPosting] = useState(false);

  // ── Reading Rooms state ───────────────────────────────────────────────────
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomTitle, setRoomTitle] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomPurpose, setRoomPurpose] = useState('');
  const [roomGoal, setRoomGoal] = useState('');
  const [roomStartsAt, setRoomStartsAt] = useState('');
  const [roomEndsAt, setRoomEndsAt] = useState('');
  const [roomStartMode, setRoomStartMode] = useState<'now' | 'scheduled'>('now');
  const [roomDuration, setRoomDuration] = useState('25');
  const [roomCourseId, setRoomCourseId] = useState<number | ''>('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomFormError, setRoomFormError] = useState('');
  const [roomGroupId, setRoomGroupId] = useState<number | null>(null);

  // ── Load groups ───────────────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError('');
    try {
      const data = await apiGet('/study-groups') as StudyGroup[];
      setGroups(data);
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : 'Could not load study groups.');
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  // ── Load sessions ─────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError('');
    try {
      const data = await apiGet('/study-sessions') as StudySession[];
      setSessions(data);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not load reading rooms.');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
    setCourseState('loading');
    apiGet('/courses')
      .then((data) => {
        const rows = data as Course[];
        setCourses(rows);
        setCourseState(rows.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => setCourseState('unavailable'));
    apiGet('/community/profile')
      .then((data) => setProfileCourseIds(((data as { courses?: Course[] }).courses || []).map((course) => course.id)))
      .catch(() => setProfileCourseIds([]));
  }, [loadGroups]);

  useEffect(() => {
    // Also needed when a group is opened: its detail lists that group's rooms,
    // so waiting for the rooms tab would show an empty section.
    if (mainTab === 'rooms' || openGroup) void loadSessions();
  }, [mainTab, openGroup, loadSessions]);

  useEffect(() => {
    if (!showRoomForm || roomStartMode !== 'now' || roomDuration === 'custom') return;
    const start = new Date();
    const end = new Date(start.getTime() + Number(roomDuration || 25) * 60000);
    setRoomStartsAt(localDateTimeValue(start));
    setRoomEndsAt(localDateTimeValue(end));
  }, [roomDuration, roomStartMode, showRoomForm]);

  useEffect(() => {
    if (!openGroup) return;
    setGroupTab('home');
    Promise.all([
      apiGet(`/community/groups/${openGroup.id}/home`).then((data) => setGroupHome(data as typeof groupHome)),
      apiGet(`/community/groups/${openGroup.id}/posts`).then((data) => setGroupPosts(data as GroupPost[])),
      apiGet(`/study-groups/${openGroup.id}/members`).then((data) => setGroupMembers((current) => ({ ...current, [openGroup.id]: data as GroupMember[] }))),
    ]).catch(() => {
      setGroupHome(null);
      setGroupPosts([]);
    });
  }, [openGroup]);

  useEffect(() => {
    if (!initialContext) return;
    const topic = initialContext.topic || initialContext.query;
    const courseId = initialContext.course_id ?? '';
    const coursePrefix = initialContext.course_code ? `${initialContext.course_code} ` : '';

    setSelectedSession(null);
    if (initialContext.action === 'reading_room') {
      setMainTab('rooms');
      setRoomGroupId(null);
      setShowRoomForm(true);
      setRoomTitle(`${coursePrefix}${topic} Reading Room`);
      setRoomTopic(topic);
      setRoomPurpose(`Work through ${initialContext.material_title || topic} together.`);
      setRoomGoal(`Study ${initialContext.material_title || topic} using uploaded ExamMind materials.`);
      setRoomCourseId(courseId);
      setRoomFormError('');
    } else {
      setMainTab('groups');
      setShowGroupForm(true);
      setFormName(`${coursePrefix}${topic} Study Group`);
      setFormTopic(topic);
      setFormDesc(`Group for discussing ${initialContext.material_title || topic}.`);
      setFormCourseId(courseId);
      setGroupFormError('');
    }
  }, [
    initialContext,
    initialContext?.action,
    initialContext?.query,
    initialContext?.topic,
    initialContext?.course_id,
    initialContext?.course_code,
    initialContext?.material_title,
  ]);

  // ── Group actions ─────────────────────────────────────────────────────────
  const joinGroup = async (groupId: number) => {
    if (groupActionPending !== null) return;
    setGroupActionPending(groupId);
    try {
      const res = await apiPost(`/study-groups/${groupId}/join`, {}) as { member_count: number };
      const joined = groups.find((group) => group.id === groupId);
      setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, is_member: true, member_count: res.member_count } : g));
      if (joined) setOpenGroup({ ...joined, is_member: true, member_count: res.member_count });
    } catch { /* Keep the current membership state when the service is unavailable. */ }
    finally { setGroupActionPending(null); }
  };

  const leaveGroup = async (groupId: number) => {
    if (groupActionPending !== null) return;
    setGroupActionPending(groupId);
    try {
      const res = await apiPost(`/study-groups/${groupId}/leave`, {}) as { member_count: number };
      setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, is_member: false, member_count: res.member_count } : g));
    } catch { /* Keep the current membership state when the service is unavailable. */ }
    finally { setGroupActionPending(null); }
  };

  const createGroup = async () => {
    const name = formName.trim();
    if (!name) { setGroupFormError('Group name is required.'); return; }
    setCreatingGroup(true);
    setGroupFormError('');
    try {
      const newGroup = await apiPost('/study-groups', {
        name,
        description: formDesc.trim() || null,
        course_id: formCourseId || null,
        topic: formTopic.trim() || null,
        visibility: formVisibility,
      }) as StudyGroup;
      setGroups((prev) => [newGroup, ...prev]);
      setShowGroupForm(false);
      setFormName(''); setFormDesc(''); setFormTopic(''); setFormCourseId(''); setFormVisibility('public');
      setOpenGroup(newGroup);
    } catch (err) {
      setGroupFormError(err instanceof Error ? err.message : 'Could not create group.');
    } finally { setCreatingGroup(false); }
  };

  // ── Room actions ──────────────────────────────────────────────────────────
  const createRoom = async () => {
    const title = roomTitle.trim();
    if (!title) { setRoomFormError('Room title is required.'); return; }
    if (!roomStartsAt || !roomEndsAt) { setRoomFormError('Choose when the room starts and ends so everyone knows what to expect.'); return; }
    const start = new Date(roomStartsAt);
    const end = new Date(roomEndsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) { setRoomFormError('The end time must be after the start time.'); return; }
    setCreatingRoom(true);
    setRoomFormError('');
    try {
      const newRoom = await apiPost('/study-sessions', {
        title,
        topic: roomTopic.trim() || null,
        purpose: roomPurpose.trim() || null,
        exam_goal: roomGoal.trim() || null,
        course_id: roomCourseId || null,
        group_id: roomGroupId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
      }) as StudySession;
      setSessions((prev) => [newRoom, ...prev]);
      setShowRoomForm(false);
      setRoomTitle(''); setRoomTopic(''); setRoomPurpose(''); setRoomGoal(''); setRoomCourseId(''); setRoomStartsAt(''); setRoomEndsAt(''); setRoomStartMode('now'); setRoomDuration('25');
      setRoomGroupId(null);
      if (newRoom.status === 'active') setSelectedSession(newRoom);
    } catch (err) {
      setRoomFormError(err instanceof Error ? err.message : 'Could not create room.');
    } finally { setCreatingRoom(false); }
  };

  const joinWithLink = async () => {
    const value = joinLinkValue.trim();
    const token = value.match(/\/groups\/invite\/([^/?#]+)/)?.[1] || value;
    if (!token) { setJoinLinkError('Paste an ExamMind invitation link or token.'); return; }
    setJoiningLink(true);
    setJoinLinkError('');
    try {
      await apiPost(`/community/group-invites/${encodeURIComponent(token)}/accept`, {});
      setJoinLinkValue('');
      setShowJoinLink(false);
      setShareNote('You joined the study group.');
      await loadGroups();
    } catch (err) {
      setJoinLinkError(err instanceof Error ? err.message : 'That invitation could not be accepted.');
    } finally {
      setJoiningLink(false);
    }
  };

  const createGroupPost = async () => {
    if (!openGroup || !groupPostInput.trim() || groupPosting) return;
    setGroupPosting(true);
    try {
      const post = await apiPost(`/community/groups/${openGroup.id}/posts`, {
        content: groupPostInput.trim(),
        post_type: groupPostType,
      }) as GroupPost;
      setGroupPosts((current) => [post, ...current]);
      setGroupPostInput('');
    } catch {
      // Keep the draft visible so a transient connection problem is recoverable.
    } finally {
      setGroupPosting(false);
    }
  };

  const toggleGroupDetail = async (groupId: number) => {
    if (expandedGroupId === groupId) { setExpandedGroupId(null); return; }
    setExpandedGroupId(groupId);
    if (!groupMembers[groupId]) {
      try {
        const members = await apiGet(`/study-groups/${groupId}/members`) as GroupMember[];
        setGroupMembers(prev => ({ ...prev, [groupId]: members }));
      } catch { setGroupMembers(prev => ({ ...prev, [groupId]: [] })); }
    }
  };

  const myGroups = groups.filter((g) => g.is_member);
  const liveRooms = sessions.filter((room) => room.status === 'active');
  const visibleGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    return [...groups]
      .filter((group) => groupView === 'discover' || (groupView === 'mine' ? group.is_member : (!group.is_member && group.course_id !== null && (profileCourseIds.length === 0 || profileCourseIds.includes(group.course_id)))))
      .filter((group) => !groupCourseFilter || group.course_id === groupCourseFilter)
      .filter((group) => !query || [group.name, group.topic, group.description].filter(Boolean).join(' ').toLowerCase().includes(query))
      .sort((a, b) => Number(b.is_member) - Number(a.is_member));
  }, [groupCourseFilter, groupSearch, groupView, groups, profileCourseIds]);

  const shareGroup = async (group: StudyGroup) => {
    try {
      const invite = await apiPost(`/community/groups/${group.id}/invites`, { expires_in_days: 30 }) as { token: string };
      const url = `${window.location.origin}/groups/invite/${invite.token}`;
      setShareUrl(url);
      if (navigator.share) {
        await navigator.share({ title: group.name, text: 'Join this ExamMind study group', url });
      } else {
        await navigator.clipboard?.writeText(url);
      }
      setShareNote('Group link copied — send it to a classmate.');
    } catch {
      notifyUnavailable('Sharing');
    }
    window.setTimeout(() => setShareNote(''), 2600);
  };

  const revokeShare = async () => {
    const token = shareUrl.split('/').pop();
    if (!token) return;
    try {
      await apiPost(`/community/group-invites/${encodeURIComponent(token)}/revoke`, {});
      setShareUrl('');
      setShareNote('Invite revoked.');
    } catch {
      setShareNote('We could not revoke that invite. Try again.');
    }
  };

  // ── If room is selected, show detail ─────────────────────────────────────
  if (selectedSession) {
    return (
      <RoomDetail
        session={selectedSession}
        user={user}
        onBack={() => { setSelectedSession(null); void loadSessions(); }}
        go={go}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page" id="s-groups">
      <div className="gs-page-head">
        <div><div className="pg-title">Study <em>Community</em></div><div className="pg-sub">Find your people, make a plan, and keep the hard parts moving.</div></div>
        <div className="gs-head-actions"><span className="gs-head-stat"><strong>{myGroups.length}</strong> joined</span><span className="gs-head-stat"><strong>{liveRooms.length}</strong> live now</span></div>
      </div>

      {/* Tabs */}
      <div className="gs-tabs gs-main-tabs">
        <button
          className={`gs-tab${mainTab === 'groups' ? ' is-on' : ''}`}
          aria-current={mainTab === 'groups' ? 'page' : undefined}
          onClick={() => { setMainTab('groups'); setOpenGroup(null); }}
        >
          <Users size={16} aria-hidden="true" /> Study Groups {groups.length > 0 ? `(${groups.length})` : ''}
        </button>
        <button
          className={`gs-tab${mainTab === 'rooms' ? ' is-on' : ''}`}
          aria-current={mainTab === 'rooms' ? 'page' : undefined}
          onClick={() => setMainTab('rooms')}
        >
          <Video size={16} aria-hidden="true" /> Reading Rooms {liveRooms.length > 0 ? `(${liveRooms.length} live)` : ''}
        </button>
      </div>

      {/* ── Study Groups panel ─────────────────────────────── */}
      {mainTab === 'groups' && !openGroup && (
        <div className="gs-layout gs-layout--browse">
          <div>
            <div className="gs-bar">
              <div>
                <p className="gs-bar-label">Your circles</p>
                <p className="gs-bar-caption">
                {groups.length === 0
                  ? 'Study groups'
                  : myGroups.length > 0
                    ? `${groups.length} groups - you are in ${myGroups.length}`
                    : `${groups.length} group${groups.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="gs-bar-actions"><label className="gs-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search groups</span><input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="Search groups" /></label><button className="gs-ghost gs-join-link-button" onClick={() => { setShowJoinLink((value) => !value); setJoinLinkError(''); }}><Link2 size={15} aria-hidden="true" /> Join with link</button><button className="gs-primary" onClick={() => { setShowGroupForm((v) => !v); setGroupFormError(''); }}><Plus size={16} aria-hidden="true" /> {showGroupForm ? 'Cancel' : 'New group'}</button></div>
            </div>

            {showJoinLink && <div className="gs-join-link-panel"><div><strong>Have an invitation?</strong><p>Paste the secure link your classmate shared with you.</p></div><div className="gs-join-link-form"><input aria-label="Study group invitation link" value={joinLinkValue} onChange={(event) => setJoinLinkValue(event.target.value)} placeholder="https://.../groups/invite/..." onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void joinWithLink(); } }} /><button type="button" className="gs-primary" onClick={() => void joinWithLink()} disabled={joiningLink}>{joiningLink ? 'Joining...' : 'Join group'}</button></div>{joinLinkError && <p className="gs-field-note gs-join-link-error" role="alert">{joinLinkError}</p>}</div>}

            {showGroupForm && (
              <div className="gs-form gs-create-panel">
                <div className="gs-form-heading"><div><p className="gs-form-title">New study group</p><h2>Make a place to keep showing up.</h2><p>Give classmates enough context to know if this is their kind of study space.</p></div><span className="gs-form-art"><Users size={22} aria-hidden="true" /></span></div>
                {groupFormError && <div className="upload-alert">{groupFormError}</div>}
                <div className="gs-form-grid"><div className="gs-field"><label htmlFor="group-name">Group name</label><input id="group-name" type="text" placeholder="CSC 301 Finals Squad" value={formName} onChange={(e) => setFormName(e.target.value)} autoFocus /></div><div className="gs-field"><label htmlFor="group-course">Course <span>optional</span></label><select id="group-course" value={formCourseId} onChange={(e) => setFormCourseId(e.target.value ? Number(e.target.value) : '')}><option value="">No specific course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>{courseState === 'empty' && <small className="gs-field-note">No course catalogue is set up yet. Topic-based groups still work.</small>}{courseState === 'unavailable' && <small className="gs-field-note">Course list is unavailable while offline. You can still create the group.</small>}</div></div>
                <div className="gs-field"><label htmlFor="group-topic">What are you working through? <span>optional</span></label><input id="group-topic" type="text" placeholder="Dynamic programming, MIS 415, exam prep" value={formTopic} onChange={(e) => setFormTopic(e.target.value)} /></div>
                <div className="gs-field"><label htmlFor="group-desc">A short description <span>optional</span></label><textarea id="group-desc" placeholder="What should a new member know before joining?" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void createGroup(); } }} rows={2} /></div>
                <div className="gs-field gs-visibility-field"><label htmlFor="group-visibility">Who can join?</label><select id="group-visibility" value={formVisibility} onChange={(event) => setFormVisibility(event.target.value as 'public' | 'unlisted' | 'private')}><option value="public">Public — discoverable and open</option><option value="unlisted">Unlisted — invite link only</option><option value="private">Private — invite or approval required</option></select><small className="gs-field-note">{formVisibility === 'public' ? 'Classmates can discover this group.' : formVisibility === 'unlisted' ? 'Only people with the secure link can find it.' : 'Keep the group closed and share invitations selectively.'}</small></div>
                <div className="gs-form-actions">
                  <button className="gs-primary" onClick={() => void createGroup()} disabled={creatingGroup || !formName.trim()}>{creatingGroup ? 'Creating...' : 'Create group'} <ChevronRight size={15} aria-hidden="true" /></button>
                  <button className="gs-ghost" onClick={() => { setShowGroupForm(false); setGroupFormError(''); }}>Cancel</button>
                </div>
              </div>
            )}

            {groupsLoading && <p className="gs-state">Loading groups...</p>}
            {groupsError && <div className="upload-alert">{groupsError}</div>}
            {!groupsLoading && !groupsError && groups.length === 0 && (
              <p className="gs-state">No study groups yet. Create one for a course and your coursemates can join it.</p>
            )}

            <div className="gs-discovery-controls" aria-label="Group discovery filters">
              <div className="gs-discovery-tabs" role="tablist" aria-label="Group view">
                {([['discover', 'Discover'], ['mine', 'My groups'], ['recommended', 'Recommended']] as const).map(([value, label]) => (
                  <button type="button" role="tab" aria-selected={groupView === value} className={groupView === value ? 'is-active' : ''} key={value} onClick={() => setGroupView(value)}>{label}</button>
                ))}
              </div>
              <label className="gs-course-filter"><span className="sr-only">Filter groups by course</span><select value={groupCourseFilter} onChange={(event) => setGroupCourseFilter(event.target.value ? Number(event.target.value) : '')}><option value="">All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}</select></label>
            </div>
            {!groupsLoading && !groupsError && groups.length > 0 && visibleGroups.length === 0 && <p className="gs-state">Nothing in this view yet. Try Discover or clear the course filter.</p>}

            <ul className="gs-list">
              {!groupsLoading && visibleGroups.map((group) => {
                const course = group.course_id ? courseMap.get(group.course_id) : null;
                return (
                  <li key={group.id}>
                    <button type="button" className="gs-row" onClick={() => { setOpenGroup(group); void toggleGroupDetail(group.id); }}>
                      <span className={`gs-avatar ${tintClass(group.id)}`} aria-hidden="true">{groupInitials(group.name)}</span>
                      <span>
                        <span className="gs-name">{group.name}</span>
                        <span className="gs-sub">
                          {course ? `${course.code} · ` : ''}
                          {group.member_count} member{group.member_count === 1 ? '' : 's'}
                          {liveRooms.some((room) => room.group_id === group.id) && <span className="gs-live-note">Live room</span>}
                          {group.topic ? ` · ${group.topic}` : ''}
                        </span>
                      </span>
                      <span className="gs-right">
                        <span className="gs-when">{timeAgo(group.created_at)}</span>
                        {group.is_member && <span className="gs-in">Joined</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="gs-margin gs-side-rail">
            <section className="gs-side-card gs-side-card--accent"><Sparkles size={17} aria-hidden="true" /><h2>Groups last. Rooms are for tonight.</h2><p>A group is your standing course community. A reading room is the focused session you open inside it.</p></section>
            <section className="gs-side-card"><div className="gs-side-card-title"><Users size={16} aria-hidden="true" /> Make it easy to join</div><p>Use the share button inside a group to send its link to a classmate.</p></section>
          </aside>
        </div>
      )}

      {mainTab === 'groups' && openGroup && (
        <div className="gs-layout">
          <div>
            <button className="gs-back" onClick={() => setOpenGroup(null)}>&larr; All groups</button>

            <header className="gs-detail-head">
              <span className={`gs-avatar ${tintClass(openGroup.id)}`} aria-hidden="true">{groupInitials(openGroup.name)}</span>
              <div>
                <h1>{openGroup.name}</h1>
                <p>
                  {openGroup.course_id && courseMap.get(openGroup.course_id) ? `${courseMap.get(openGroup.course_id)!.code} - ` : ''}
                  {openGroup.member_count} member{openGroup.member_count === 1 ? '' : 's'}
                  {openGroup.created_by_username ? ` - started by @${openGroup.created_by_username}` : ''}
                </p>
              </div>
            </header>

            <div className="gs-detail-actions">
              {openGroup.is_member ? (
                <button className="gs-ghost" onClick={() => void leaveGroup(openGroup.id)} disabled={groupActionPending === openGroup.id}>
                  {groupActionPending === openGroup.id ? '...' : 'Leave group'}
                </button>
              ) : (
                <button className="gs-primary" onClick={() => void joinGroup(openGroup.id)} disabled={groupActionPending === openGroup.id}>
                  {groupActionPending === openGroup.id ? '...' : 'Join group'}
                </button>
              )}
              <button className="gs-ghost" onClick={() => { setRoomGroupId(openGroup.id); setMainTab('rooms'); setOpenGroup(null); setShowRoomForm(true); }}><Video size={16} aria-hidden="true" /> Start a reading room</button>
              {groupHome?.my_role && ['owner', 'admin'].includes(groupHome.my_role) && <button className="gs-ghost" onClick={() => void shareGroup(openGroup)}><Share2 size={16} aria-hidden="true" /> Invite classmates</button>}
            </div>
            {shareNote && <div className="gs-share-note" role="status"><Link2 size={15} aria-hidden="true" /> {shareNote}</div>}
            {shareUrl && <div className="gs-share-actions" aria-label="Share invite link"><a href={`https://wa.me/?text=${encodeURIComponent(`Join ${openGroup.name} on ExamMind: ${shareUrl}`)}`} target="_blank" rel="noreferrer">WhatsApp</a><a href={`mailto:?subject=${encodeURIComponent(`Join ${openGroup.name} on ExamMind`)}&body=${encodeURIComponent(shareUrl)}`}>Email</a><button type="button" onClick={() => { void navigator.clipboard?.writeText(shareUrl); setShareNote('Invite link copied.'); }}>Copy again</button><button type="button" onClick={() => void revokeShare()}>Revoke</button></div>}

            <div className="group-home-tabs" role="tablist" aria-label="Group home">
              {(['home', 'discussions', 'rooms', 'materials', 'members', 'lounge'] as const).map((tab) => (
                <button type="button" role="tab" aria-selected={groupTab === tab} className={groupTab === tab ? 'is-active' : ''} key={tab} onClick={() => { setGroupTab(tab); if (tab === 'lounge' || tab === 'discussions') setGroupPostType(tab === 'lounge' ? 'lounge' : 'discussion'); }}>
                  {tab === 'home' ? 'Home' : tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {groupTab === 'home' && (
              <section className="group-welcome">
                <p className="gs-section-label">Start here</p>
                <p>{groupHome?.group.welcome_message || openGroup.welcome_message || 'Welcome. Make the next question easier for someone else.'}</p>
                <div className="group-checklist">
                  <span className={groupHome?.checklist.joined ? 'is-done' : ''}>Joined</span>
                  <span className={groupHome?.checklist.introduced ? 'is-done' : ''}>Say hello</span>
                  <span className={groupHome?.checklist.opened_room ? 'is-done' : ''}>Open a room</span>
                </div>
              </section>
            )}

            {groupTab === 'home' && openGroup.description && (
              <section className="gs-section">
                <p className="gs-section-label">About</p>
                <p className="margin-note">{openGroup.description}</p>
              </section>
            )}

            {groupTab === 'home' && <section className="gs-section">
              <p className="gs-section-label">Members</p>
              {groupMembers[openGroup.id] === undefined ? (
                <p className="margin-note">Loading members...</p>
              ) : groupMembers[openGroup.id].length === 0 ? (
                <p className="margin-note">No members listed yet.</p>
              ) : (
                <ul className="gs-members">
                  {groupMembers[openGroup.id].map((member) => (
                    <li className="gs-member" key={member.user_id}>
                      {member.username ? (
                        <button type="button" className="gs-member-open" onClick={() => go('profile', member.username)}>
                          <span className={`gs-avatar ${tintClass(member.user_id)}`} aria-hidden="true">
                            {member.username.slice(0, 2).toUpperCase()}
                          </span>
                          @{member.username}
                        </button>
                      ) : (
                        <span className="gs-member-open">
                          <span className={`gs-avatar ${tintClass(member.user_id)}`} aria-hidden="true">?</span>
                          Student
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>}

            {groupTab === 'home' && <section className="gs-section">
              <p className="gs-section-label">Reading rooms</p>
              {sessions.filter((room) => room.group_id === openGroup.id).length === 0 ? (
                <p className="margin-note">No reading rooms in this group yet. Start one to revise live with the group.</p>
              ) : (
                <ul className="gs-list">
                  {sessions.filter((room) => room.group_id === openGroup.id).map((room) => (
                    <li key={room.id}>
                      <button type="button" className="gs-row" onClick={() => setSelectedSession(room)}>
                        <span className={`gs-avatar ${tintClass(room.id)}`} aria-hidden="true">{groupInitials(room.title)}</span>
                        <span>
                          <span className="gs-name">{room.title}</span>
                          <span className="gs-sub">
                            {room.participant_count} in the room
                            {room.topic ? ` - ${room.topic}` : ''}
                          </span>
                        </span>
                        <span className="gs-right">
                          {room.status === 'active'
                            ? <span className="gs-live">Live</span>
                            : <span className="gs-when">{room.status}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>}

            {(groupTab === 'discussions' || groupTab === 'lounge') && (
              <section className="group-community-panel">
                <div className="group-post-compose">
                  <textarea value={groupPostInput} onChange={(event) => setGroupPostInput(event.target.value)} placeholder={groupTab === 'lounge' ? 'Say something to the lounge…' : 'Start the group discussion…'} rows={3} />
                  <div className="group-post-actions">
                    <span>{groupPosts.filter((post) => post.post_type === groupTab || (groupTab === 'discussions' && post.post_type === 'announcement')).length} posts</span>
                    <button type="button" className="gs-primary" onClick={() => void createGroupPost()} disabled={groupPosting || !groupPostInput.trim()}>{groupPosting ? 'Posting…' : 'Post'}</button>
                  </div>
                </div>
                <ul className="group-posts">
                  {groupPosts.filter((post) => groupTab === 'lounge' ? post.post_type === 'lounge' : post.post_type !== 'lounge').map((post) => (
                    <li key={post.id}><div><strong>@{post.username || 'student'}</strong><span>{timeAgo(post.created_at)}</span></div><p>{post.content}</p></li>
                  ))}
                  {groupPosts.filter((post) => groupTab === 'lounge' ? post.post_type === 'lounge' : post.post_type !== 'lounge').length === 0 && <li className="group-post-empty">Nothing here yet. Start the first thread.</li>}
                </ul>
              </section>
            )}

            {groupTab === 'materials' && (
              <section className="gs-section"><p className="gs-section-label">Course materials</p><p className="margin-note">{groupHome?.tabs.materials ?? 0} materials are anchored to this group’s course. Open My Materials to read and practice from them.</p><button type="button" className="gs-link" onClick={() => go('questions')}>Open course materials <span>→</span></button></section>
            )}

            {groupTab === 'rooms' && (
              <section className="gs-section"><p className="gs-section-label">Reading rooms</p><p className="margin-note">{groupHome?.tabs.rooms ?? sessions.filter((room) => room.group_id === openGroup.id).length} rooms have been opened for this group.</p><button type="button" className="gs-primary" onClick={() => { setRoomGroupId(openGroup.id); setMainTab('rooms'); setOpenGroup(null); setShowRoomForm(true); }}>Start a group room</button></section>
            )}

            {groupTab === 'members' && (
              <section className="gs-section"><p className="gs-section-label">Members</p><p className="margin-note">{openGroup.member_count} people are part of this group. Choose a name to view a public profile.</p><ul className="gs-members">{(groupMembers[openGroup.id] || []).map((member) => <li className="gs-member" key={member.user_id}><span className="gs-member-open">{member.username ? `@${member.username}` : 'Student'}{member.role === 'owner' && <small> owner</small>}</span></li>)}</ul></section>
            )}
          </div>

          <aside className="gs-margin">
            <section className="margin-block margin-block--end">
              <p className="margin-label">Reading rooms</p>
              <h2 className="margin-title">One session, not a channel</h2>
              <p className="margin-note">
                A room is a single live revision session with a shared AI board. It ends when
                the group stops studying; the group itself stays.
              </p>
            </section>
          </aside>
        </div>
      )}

      {mainTab === 'rooms' && (
        <div className="gs-layout gs-layout--rooms">
          <div>
            <div className="gs-bar">
              <div><p className="gs-bar-label">Reading rooms</p><p className="gs-bar-caption">{liveRooms.length > 0 ? `${liveRooms.length} live now` : sessions.length > 0 ? `${sessions.length} room${sessions.length === 1 ? '' : 's'}` : 'One focused session at a time'}</p></div>
              <button className="gs-primary" onClick={() => { setShowRoomForm((v) => !v); setRoomFormError(''); }}><Plus size={16} aria-hidden="true" /> {showRoomForm ? 'Cancel' : 'Start a room'}</button>
            </div>

            {showRoomForm && (
              <div className="gs-form gs-create-panel gs-room-form">
                <div className="gs-form-heading"><div><p className="gs-form-title">Start a reading room</p><h2>Give tonight a shape.</h2><p>Every room has a clear start and finish, so joining never feels awkward.</p></div><span className="gs-form-art gs-form-art--teal"><Clock3 size={22} aria-hidden="true" /></span></div>
                {roomFormError && <div className="upload-alert">{roomFormError}</div>}
                <div className="gs-form-grid"><div className="gs-field"><label htmlFor="room-title">Room name</label><input id="room-title" type="text" placeholder="MIS 415 project management revision" value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} autoFocus /></div><div className="gs-field"><label htmlFor="room-course">Course <span>optional</span></label><select id="room-course" value={roomCourseId} onChange={(e) => setRoomCourseId(e.target.value ? Number(e.target.value) : '')}><option value="">No specific course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>{courseState === 'empty' && <small className="gs-field-note">No course catalogue is set up yet. A topic-based room is still okay.</small>}{courseState === 'unavailable' && <small className="gs-field-note">Course list is unavailable while offline. You can still start by topic.</small>}</div></div>
                <div className="gs-field"><label htmlFor="room-topic">What are you working through? <span>optional</span></label><input id="room-topic" type="text" placeholder="Critical path, cost variance" value={roomTopic} onChange={(e) => setRoomTopic(e.target.value)} /></div>
                <div className="gs-schedule-block"><div className="gs-schedule-title"><CalendarDays size={16} aria-hidden="true" /><div><strong>When should people arrive?</strong><span>Start and end time are required for every room.</span></div></div><div className="room-start-modes" role="group" aria-label="Room start mode"><button type="button" className={roomStartMode === 'now' ? 'is-active' : ''} onClick={() => setRoomStartMode('now')}>Start now</button><button type="button" className={roomStartMode === 'scheduled' ? 'is-active' : ''} onClick={() => setRoomStartMode('scheduled')}>Schedule it</button></div>{roomStartMode === 'now' && <div className="room-duration-chips" role="group" aria-label="Room duration"><span>How long?</span>{['25', '50', '90', 'custom'].map((duration) => <button type="button" key={duration} className={roomDuration === duration ? 'is-active' : ''} onClick={() => setRoomDuration(duration)}>{duration === 'custom' ? 'Custom' : `${duration} min`}</button>)}</div>}<div className="gs-form-grid"><div className="gs-field"><label htmlFor="room-starts">Starts</label><input id="room-starts" type="datetime-local" value={roomStartsAt} onChange={(e) => { setRoomStartMode('scheduled'); setRoomStartsAt(e.target.value); }} required /></div><div className="gs-field"><label htmlFor="room-ends">Ends</label><input id="room-ends" type="datetime-local" value={roomEndsAt} onChange={(e) => { setRoomStartMode('scheduled'); setRoomEndsAt(e.target.value); }} required /></div></div></div>
                <details className="gs-form-optional"><summary>Add a little context <span>optional</span></summary><div className="gs-form-grid"><div className="gs-field"><label htmlFor="room-purpose">What is the purpose?</label><input id="room-purpose" type="text" placeholder="Work through the paper together" value={roomPurpose} onChange={(e) => setRoomPurpose(e.target.value)} /></div><div className="gs-field"><label htmlFor="room-goal">A small goal for tonight</label><input id="room-goal" type="text" placeholder="Get through the 2023 paper" value={roomGoal} onChange={(e) => setRoomGoal(e.target.value)} /></div></div></details>
                {roomGroupId && <p className="gs-form-context">This room will open inside {groups.find((group) => group.id === roomGroupId)?.name || 'your group'}.</p>}
                <div className="gs-form-actions">
                  <button className="gs-primary" onClick={() => void createRoom()} disabled={creatingRoom || !roomTitle.trim() || !roomStartsAt || !roomEndsAt}>{creatingRoom ? 'Starting...' : 'Start room'} <ChevronRight size={15} aria-hidden="true" /></button>
                  <button className="gs-ghost" onClick={() => { setShowRoomForm(false); setRoomFormError(''); }}>Cancel</button>
                </div>
              </div>
            )}

            {sessionsLoading && <p className="gs-state">Loading rooms...</p>}
            {sessionsError && <div className="upload-alert">{sessionsError}</div>}
            {!sessionsLoading && !sessionsError && sessions.length === 0 && (
              <p className="gs-state">No reading rooms yet. Start one for tonight and anyone on the course can sit in it with you.</p>
            )}

            <ul className="gs-list">
              {!sessionsLoading && sessions.map((room) => {
                const course = room.course_id ? courseMap.get(room.course_id) : null;
                const live = room.status === 'active';
                const scheduled = room.status === 'scheduled';
                const inRoom = room.my_status && room.my_status !== 'left';
                return (
                  <li key={room.id}>
                    <button
                      type="button"
                      className="gs-row"
                      onClick={() => { if (live) setSelectedSession(room); }}
                      disabled={!live}
                      aria-label={live ? `${inRoom ? 'Re-enter' : 'Join'} ${room.title}` : scheduled ? `${room.title}, scheduled` : `${room.title}, ended`}
                    >
                      <span className={`gs-avatar ${tintClass(room.id)}`} aria-hidden="true">{groupInitials(room.title)}</span>
                      <span>
                        <span className="gs-name">{room.title}</span>
                        <span className="gs-sub">
                          {course ? `${course.code} - ` : ''}
                          {live ? `${room.studying_count} studying, ${room.on_break_count} on break` : 'Ended'}
                          {room.topic ? ` - ${room.topic}` : ''}
                        </span>
                        {room.exam_goal && <span className="gs-goal">Goal: {room.exam_goal}</span>}
                      </span>
                      <span className="gs-right">
                        {live
                          ? <span className="gs-live">{inRoom ? 'You are in' : 'Live'}</span>
                          : scheduled
                            ? <span className="gs-when">Scheduled</span>
                          : <span className="gs-when">{timeAgo(room.created_at)}</span>}
                        {live && <span className="gs-enter">{inRoom ? 'Re-enter' : 'Join'}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="gs-margin">
            {liveRooms.filter((room) => room.my_status && room.my_status !== 'left').length > 0 && (
              <section className="margin-block">
                <p className="margin-label">You are in</p>
                <ul className="gs-mine">
                  {liveRooms
                    .filter((room) => room.my_status && room.my_status !== 'left')
                    .map((room) => (
                      <li key={room.id}>
                        <button type="button" className="gs-link" onClick={() => setSelectedSession(room)}>
                          <span>{room.title}</span>
                          <span className={room.my_status === 'on_break' ? 'gs-tag-break' : 'gs-tag-studying'}>
                            {room.my_status === 'on_break' ? 'On break' : 'Studying'}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            <section className="margin-block margin-block--end">
              <p className="margin-label">Reading rooms</p>
              <h2 className="margin-title">Study live together</h2>
              <p className="margin-note">
                A room is tonight's session. Inside it you can see who is actually studying,
                talk normally, and ask the assistant questions that land on a board everyone
                shares.
              </p>
              <dl className="gs-explainer">
                <div><dt>AI study board</dt><dd>Shared answers, with their sources</dd></div>
                <div><dt>Discussion</dt><dd>Ordinary room chat</dd></div>
                <div><dt>People</dt><dd>Who is studying, who is on a break</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      )}

    </div>
  );
}
