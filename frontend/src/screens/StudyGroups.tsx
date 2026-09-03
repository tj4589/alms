import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenType, SearchActionContext, User } from '../types';
import { apiGet, apiPost } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type Course = {
  id: number;
  code: string;
  name: string;
};

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
};

type GroupMember = {
  user_id: number;
  username: string | null;
  name: string;
  joined_at: string;
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

const IS: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '9px 12px',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  outline: 'none',
};

const SS: React.CSSProperties = { ...IS, cursor: 'pointer' };

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '7px 18px',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  background: active ? 'var(--bg3)' : 'transparent',
  border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
  borderRadius: 8,
  color: active ? 'var(--text)' : 'var(--text3)',
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  transition: 'all .15s',
});

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
  go: (s: ScreenType) => void;
}) {
  const [roomTab, setRoomTab] = useState<'board' | 'chat' | 'people'>('board');
  const [detail, setDetail] = useState<StudySession>(session);
  const [msgs, setMsgs] = useState<RoomMessage[]>([]);
  const [board, setBoard] = useState<AICard[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [sending, setSending] = useState(false);
  const [aiAsking, setAiAsking] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [aiError, setAiError] = useState('');

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
    apiPost(`/study-sessions/${session.id}/join`, {})
      .then(() => refresh())
      .catch(() => refresh());

    const interval = setInterval(() => void refresh(), 10000);
    return () => clearInterval(interval);
  }, [session.id, refresh]);

  useEffect(() => {
    if (roomTab === 'chat') {
      msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs, roomTab]);

  const takeBreak = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await apiPost(`/study-sessions/${session.id}/break`, {});
      setDetail((d) => ({ ...d, my_status: 'on_break' }));
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

  // ── Room header ──────────────────────────────────────────────────────────

  const roomHeader = (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {isOnBreak ? (
            <button
              className="cta"
              style={{ marginTop: 0, fontSize: 12, padding: '7px 14px' }}
              onClick={() => void backToStudy()}
              disabled={actionLoading}
            >
              Back to Study
            </button>
          ) : (
            <button
              className="cta cta-ghost"
              style={{ marginTop: 0, fontSize: 12, padding: '7px 14px' }}
              onClick={() => void takeBreak()}
              disabled={actionLoading}
            >
              Take Break
            </button>
          )}
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
    </div>
  );

  // ── AI Board ─────────────────────────────────────────────────────────────

  const aiBoard = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Ask AI input */}
      <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg2), rgba(62,207,178,0.025))', borderColor: 'rgba(62,207,178,0.18)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, color: 'var(--teal)', marginBottom: 8 }}>
          Ask ExamMind AI
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      <div className="ai-foot" style={{ marginTop: 10 }}>
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
    <div>
      {(!detail.participants || detail.participants.length === 0) && (
        <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
          No active participants right now.
        </div>
      )}
      {detail.participants?.map((p) => (
        <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
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
      <div style={{ marginBottom: 12 }}>
        <button
          className="cta cta-ghost"
          style={{ fontSize: 12, padding: '6px 12px', marginTop: 0 }}
          onClick={onBack}
        >
          ← Back to Reading Rooms
        </button>
      </div>

      {loadError && <div className="upload-alert" style={{ marginBottom: 12 }}>{loadError}</div>}

      {roomHeader}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button style={tabBtn(roomTab === 'board')} onClick={() => setRoomTab('board')}>
          AI Study Board {board.length > 0 ? `(${board.length})` : ''}
        </button>
        <button style={tabBtn(roomTab === 'chat')} onClick={() => setRoomTab('chat')}>
          Discussion {msgs.filter(m => m.message_type === 'chat').length > 0 ? `(${msgs.filter(m => m.message_type === 'chat').length})` : ''}
        </button>
        <button style={tabBtn(roomTab === 'people')} onClick={() => setRoomTab('people')}>
          People ({detail.participant_count})
        </button>
      </div>

      {/* Desktop two-col for board tab; full width for others */}
      {roomTab === 'board' ? (
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
  notifyUnavailable: _notifyUnavailable,
  user,
  initialContext = null,
}: {
  go: (s: ScreenType) => void;
  notifyUnavailable: (feature: string) => void;
  user: User | null;
  initialContext?: (SearchActionContext & { action?: 'study_group' | 'reading_room' }) | null;
}) {
  const [mainTab, setMainTab] = useState<'groups' | 'rooms'>('groups');
  const [selectedSession, setSelectedSession] = useState<StudySession | null>(null);

  // ── Study Groups state ────────────────────────────────────────────────────
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const [groupActionPending, setGroupActionPending] = useState<number | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<number, GroupMember[]>>({});
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTopic, setFormTopic] = useState('');
  const [formCourseId, setFormCourseId] = useState<number | ''>('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupFormError, setGroupFormError] = useState('');

  // ── Reading Rooms state ───────────────────────────────────────────────────
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomTitle, setRoomTitle] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomGoal, setRoomGoal] = useState('');
  const [roomCourseId, setRoomCourseId] = useState<number | ''>('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomFormError, setRoomFormError] = useState('');

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
    apiGet('/courses')
      .then((data) => setCourses(data as Course[]))
      .catch(() => {});
  }, [loadGroups]);

  useEffect(() => {
    if (mainTab === 'rooms') void loadSessions();
  }, [mainTab, loadSessions]);

  useEffect(() => {
    if (!initialContext) return;
    const topic = initialContext.topic || initialContext.query;
    const courseId = initialContext.course_id ?? '';
    const coursePrefix = initialContext.course_code ? `${initialContext.course_code} ` : '';

    setSelectedSession(null);
    if (initialContext.action === 'reading_room') {
      setMainTab('rooms');
      setShowRoomForm(true);
      setRoomTitle(`${coursePrefix}${topic} Reading Room`);
      setRoomTopic(topic);
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
      setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, is_member: true, member_count: res.member_count } : g));
    } catch { }
    finally { setGroupActionPending(null); }
  };

  const leaveGroup = async (groupId: number) => {
    if (groupActionPending !== null) return;
    setGroupActionPending(groupId);
    try {
      const res = await apiPost(`/study-groups/${groupId}/leave`, {}) as { member_count: number };
      setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, is_member: false, member_count: res.member_count } : g));
    } catch { }
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
      }) as StudyGroup;
      setGroups((prev) => [newGroup, ...prev]);
      setShowGroupForm(false);
      setFormName(''); setFormDesc(''); setFormTopic(''); setFormCourseId('');
    } catch (err) {
      setGroupFormError(err instanceof Error ? err.message : 'Could not create group.');
    } finally { setCreatingGroup(false); }
  };

  // ── Room actions ──────────────────────────────────────────────────────────
  const createRoom = async () => {
    const title = roomTitle.trim();
    if (!title) { setRoomFormError('Room title is required.'); return; }
    setCreatingRoom(true);
    setRoomFormError('');
    try {
      const newRoom = await apiPost('/study-sessions', {
        title,
        topic: roomTopic.trim() || null,
        exam_goal: roomGoal.trim() || null,
        course_id: roomCourseId || null,
      }) as StudySession;
      setSessions((prev) => [newRoom, ...prev]);
      setShowRoomForm(false);
      setRoomTitle(''); setRoomTopic(''); setRoomGoal(''); setRoomCourseId('');
      setSelectedSession(newRoom);
    } catch (err) {
      setRoomFormError(err instanceof Error ? err.message : 'Could not create room.');
    } finally { setCreatingRoom(false); }
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
      <div className="pg-head">
        <div className="pg-title">Study <em>Community</em></div>
        <div className="pg-sub">Study Groups are long-term course communities. Reading Rooms are live revision sessions for a course or topic.</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
        <button style={tabBtn(mainTab === 'groups')} onClick={() => setMainTab('groups')}>
          Study Groups {groups.length > 0 ? `(${groups.length})` : ''}
        </button>
        <button style={tabBtn(mainTab === 'rooms')} onClick={() => setMainTab('rooms')}>
          Reading Rooms {sessions.filter(s => s.status === 'active').length > 0 ? `(${sessions.filter(s => s.status === 'active').length} live)` : ''}
        </button>
      </div>

      {/* ── Study Groups panel ─────────────────────────────── */}
      {mainTab === 'groups' && (
        <div className="two-col">
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Study Groups
                {groups.length > 0 && <span className="ni-badge" style={{ marginLeft: 7 }}>{groups.length}</span>}
              </div>
              <button
                className="cta"
                style={{ marginTop: 0, padding: '6px 14px', fontSize: 12 }}
                onClick={() => { setShowGroupForm((v) => !v); setGroupFormError(''); }}
              >
                {showGroupForm ? 'Cancel' : '+ Create Group'}
              </button>
            </div>

            {showGroupForm && (
              <div style={{ marginBottom: 18, padding: 14, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10 }}>New study group</div>
                {groupFormError && <div className="upload-alert" style={{ marginBottom: 8 }}>{groupFormError}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input style={IS} type="text" placeholder="Group name (e.g. CSC 301 Finals Squad)" value={formName} onChange={(e) => setFormName(e.target.value)} autoFocus />
                  <input style={IS} type="text" placeholder="Topic focus (optional)" value={formTopic} onChange={(e) => setFormTopic(e.target.value)} />
                  <select style={SS} value={formCourseId} onChange={(e) => setFormCourseId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">No specific course</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                  <input style={IS} type="text" placeholder="Description (optional)" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createGroup(); }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="cta" style={{ marginTop: 0, fontSize: 12 }} onClick={() => void createGroup()} disabled={creatingGroup || !formName.trim()}>
                      {creatingGroup ? 'Creating…' : 'Create Group'}
                    </button>
                    <button className="cta cta-ghost" style={{ marginTop: 0, fontSize: 12 }} onClick={() => { setShowGroupForm(false); setGroupFormError(''); }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {groupsLoading && <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>Loading groups…</div>}
            {groupsError && <div className="upload-alert">{groupsError}</div>}

            {!groupsLoading && !groupsError && groups.length === 0 && (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div className="empty-title">No study groups yet</div>
                <div className="empty-body">Create a long-term group for a real course or topic from uploaded ExamMind materials.</div>
              </div>
            )}

            {!groupsLoading && groups.map((group) => {
              const course = group.course_id ? courseMap.get(group.course_id) : null;
              const pending = groupActionPending === group.id;
              const expanded = expandedGroupId === group.id;
              const members = groupMembers[group.id];
              return (
                <div className="qd" style={{ cursor: 'default' }} key={group.id}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{group.name}</div>
                    <button
                      onClick={() => void toggleGroupDetail(group.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, padding: '2px 6px', flexShrink: 0, fontFamily: 'var(--font)' }}
                    >
                      {expanded ? 'Hide ▲' : `Members (${group.member_count}) ▼`}
                    </button>
                  </div>
                  {group.description && (
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.55 }}>{group.description}</div>
                  )}
                  <div className="qd-meta">
                    {course && <span className="qi-course">{course.code}</span>}
                    {group.topic && <span className="tag tag-m">{group.topic}</span>}
                    <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
                      {timeAgo(group.created_at)}
                    </span>
                    {group.created_by_username && (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>by @{group.created_by_username}</span>
                    )}
                    {group.is_member ? (
                      <button className="cta cta-ghost" style={{ marginTop: 0, fontSize: 11, padding: '3px 10px', color: 'var(--text3)' }} onClick={() => void leaveGroup(group.id)} disabled={pending}>
                        {pending ? '…' : 'Leave'}
                      </button>
                    ) : (
                      <button className="cta" style={{ marginTop: 0, fontSize: 11, padding: '3px 12px' }} onClick={() => void joinGroup(group.id)} disabled={pending}>
                        {pending ? '…' : 'Join'}
                      </button>
                    )}
                  </div>

                  {/* Expandable member list + actions */}
                  {expanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      {!members && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading members…</div>}
                      {members?.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>No members yet.</div>}
                      {members && members.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                          {members.map(m => (
                            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px 3px 4px' }}>
                              <div className="ava" style={{ width: 20, height: 20, fontSize: 9 }}>
                                {(m.username || m.name || '?')[0].toUpperCase()}
                              </div>
                              <span style={{ fontSize: 12 }}>@{m.username ?? m.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="cta cta-ghost"
                          style={{ marginTop: 0, fontSize: 11, padding: '4px 11px' }}
                          onClick={() => { setMainTab('rooms'); setShowRoomForm(true); setRoomTitle(`${group.name} — Study Session`); }}
                        >
                          Start a Reading Room
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: My Groups + info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-hd">
                <div className="card-ttl">My Groups</div>
                {myGroups.length > 0 && <span className="ni-badge">{myGroups.length}</span>}
              </div>
              {groupsLoading && <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>Loading…</div>}
              {!groupsLoading && myGroups.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>
                  You have not joined any groups yet. Browse and hit Join.
                </div>
              )}
              {!groupsLoading && myGroups.map((group) => {
                const course = group.course_id ? courseMap.get(group.course_id) : null;
                return (
                  <div className="collab-item" key={group.id} style={{ cursor: 'default' }}>
                    <div className="collab-top">
                      <div className="collab-name">{group.name}</div>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{group.member_count} members</span>
                    </div>
                    <div className="collab-msg" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {course ? course.code : (group.topic || 'General')}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg2), rgba(232,162,58,0.03))', borderColor: 'rgba(232,162,58,0.18)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8 }}>How it works</div>
              <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>Study together, learn faster</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.65 }}>
                Create a group for your course or topic. Use the <strong>Reading Rooms</strong> tab to start live study sessions with AI-powered study cards that everyone in the room can see.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reading Rooms panel ────────────────────────────── */}
      {mainTab === 'rooms' && (
        <div className="two-col">
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">
                Live Reading Rooms
                {sessions.filter(s => s.status === 'active').length > 0 && (
                  <span className="ni-badge" style={{ marginLeft: 7 }}>{sessions.filter(s => s.status === 'active').length}</span>
                )}
              </div>
              <button
                className="cta"
                style={{ marginTop: 0, padding: '6px 14px', fontSize: 12 }}
                onClick={() => { setShowRoomForm((v) => !v); setRoomFormError(''); }}
              >
                {showRoomForm ? 'Cancel' : '+ Start Reading Room'}
              </button>
            </div>

            {showRoomForm && (
              <div style={{ marginBottom: 18, padding: 14, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10 }}>Start a Reading Room</div>
                {roomFormError && <div className="upload-alert" style={{ marginBottom: 8 }}>{roomFormError}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input style={IS} type="text" placeholder="Room title (e.g. MIS415 Project Management Revision)" value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} autoFocus />
                  <input style={IS} type="text" placeholder="Topic focus (e.g. critical path or cost variance)" value={roomTopic} onChange={(e) => setRoomTopic(e.target.value)} />
                  <input style={IS} type="text" placeholder="Exam goal (e.g. revise uploaded past-question topics tonight)" value={roomGoal} onChange={(e) => setRoomGoal(e.target.value)} />
                  <select style={SS} value={roomCourseId} onChange={(e) => setRoomCourseId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">No specific course</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="cta" style={{ marginTop: 0, fontSize: 12 }} onClick={() => void createRoom()} disabled={creatingRoom || !roomTitle.trim()}>
                      {creatingRoom ? 'Creating…' : 'Start Reading Room'}
                    </button>
                    <button className="cta cta-ghost" style={{ marginTop: 0, fontSize: 12 }} onClick={() => { setShowRoomForm(false); setRoomFormError(''); }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {sessionsLoading && <div style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 0' }}>Loading rooms…</div>}
            {sessionsError && <div className="upload-alert">{sessionsError}</div>}

            {!sessionsLoading && !sessionsError && sessions.length === 0 && (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div className="empty-title">No active reading rooms</div>
                <div className="empty-body">Start a live revision room for a course/topic. Everyone can discuss and turn AI answers into shared study cards.</div>
              </div>
            )}

            {!sessionsLoading && sessions.map((room) => {
              const course = room.course_id ? courseMap.get(room.course_id) : null;
              return (
              <div className="qd" style={{ cursor: 'default' }} key={room.id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>{room.title}</div>
                    {course && (
                      <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 5 }}>{course.code} — {course.name}</div>
                    )}
                    {room.exam_goal && (
                      <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 5 }}>Goal: {room.exam_goal}</div>
                    )}
                    <div className="qd-meta" style={{ flexWrap: 'wrap' }}>
                      {room.topic && <span className="tag tag-m">{room.topic}</span>}
                      <span style={{ fontSize: 11, color: room.status === 'active' ? 'var(--teal)' : 'var(--text3)', fontWeight: 600 }}>
                        {room.status === 'active' ? `${room.studying_count} studying · ${room.on_break_count} on break` : 'Ended'}
                      </span>
                      {room.creator_username && (
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>by @{room.creator_username}</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{timeAgo(room.created_at)}</span>
                    </div>
                  </div>
                  {room.status === 'active' && (
                    <button
                      className="cta"
                      style={{ marginTop: 0, fontSize: 12, padding: '6px 16px', flexShrink: 0 }}
                      onClick={() => setSelectedSession(room)}
                    >
                      {room.my_status && room.my_status !== 'left' ? 'Re-enter →' : 'Join Room →'}
                    </button>
                  )}
                </div>
              </div>
            )})}
          </div>

          {/* Right: info card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg2), rgba(62,207,178,0.03))', borderColor: 'rgba(62,207,178,0.18)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8 }}>Reading Rooms</div>
              <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>Study live together</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.65, marginBottom: 12 }}>
                Start a room for tonight's session. Inside the room, everyone can see who's studying, chat normally, and ask AI questions that appear as shared study cards.
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.65 }}>
                <div style={{ marginBottom: 4 }}>📖 <strong>AI Study Board</strong> — shared AI answers with sources</div>
                <div style={{ marginBottom: 4 }}>💬 <strong>Discussion</strong> — normal room chat</div>
                <div>👥 <strong>People</strong> — see who's studying vs. on break</div>
              </div>
            </div>

            {sessions.filter(s => s.my_status && s.my_status !== 'left' && s.status === 'active').length > 0 && (
              <div className="card">
                <div className="card-hd"><div className="card-ttl">My Active Rooms</div></div>
                {sessions
                  .filter(s => s.my_status && s.my_status !== 'left' && s.status === 'active')
                  .map((room) => (
                    <div className="collab-item" key={room.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedSession(room)}>
                      <div className="collab-top">
                        <div className="collab-name">{room.title}</div>
                        <span style={{
                          fontSize: 11,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: room.my_status === 'on_break' ? 'rgba(232,162,58,0.1)' : 'rgba(62,207,178,0.1)',
                          color: room.my_status === 'on_break' ? 'var(--gold)' : 'var(--teal)',
                        }}>
                          {room.my_status === 'on_break' ? '☕ break' : '📖 studying'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
