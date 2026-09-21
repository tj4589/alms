import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Share2,
  Sparkles,
  Users,
} from 'lucide-react';
import type { ScreenType, SearchActionContext, User } from '../types';
import { apiGet, apiPost } from '../lib/api';
import './Collab.css';

type Thread = {
  id: number;
  title: string;
  content?: string | null;
  created_by: number;
  created_by_username: string | null;
  created_by_name?: string | null;
  course_id: number | null;
  past_question_id: number | null;
  group_id: number | null;
  reply_count?: number;
  category?: 'academic' | 'casual' | string | null;
  mood?: string | null;
  group_name?: string | null;
  created_at: string;
};

type Course = { id: number; code: string; name: string };
type StudyGroupRef = { id: number; is_member?: boolean };
type PastQuestionRef = { id: number; title: string; course_id: number | null; year: number | null };
type ThreadMessage = {
  id: number;
  thread_id: number;
  user_id: number | null;
  user_username: string | null;
  content: string;
  is_ai_response: boolean;
  created_at: string;
};

function threadInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

async function shareThread(thread: Thread): Promise<void> {
  const url = `${window.location.origin}/?discussion=${thread.id}`;
  if (navigator.share) {
    await navigator.share({ title: thread.title, text: 'Join this ExamMind discussion', url });
    return;
  }
  await navigator.clipboard?.writeText(url);
}

export default function Collab({
  go,
  user,
  notifyUnavailable,
  initialContext = null,
}: {
  go: (s: ScreenType, username?: string | null) => void;
  user: User | null;
  notifyUnavailable: (feature: string) => void;
  initialContext?: (SearchActionContext & { action?: 'discussion' }) | null;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [myCourseIds, setMyCourseIds] = useState<number[]>([]);
  const [myGroupIds, setMyGroupIds] = useState<number[]>([]);
  const [pastQuestions, setPastQuestions] = useState<PastQuestionRef[]>([]);
  const [formCourseId, setFormCourseId] = useState<number | ''>('');
  const [formQuestionId, setFormQuestionId] = useState<number | ''>('');
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
  const [feedMode, setFeedMode] = useState<'for-you' | 'latest' | 'my-courses' | 'my-groups'>('for-you');
  const [shareNote, setShareNote] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [reportOpenId, setReportOpenId] = useState<number | null>(null);
  const [messagesError, setMessagesError] = useState('');
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError('');
    try {
      setThreads(await apiGet('/threads') as Thread[]);
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'Could not load discussions.');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  useEffect(() => {
    apiGet('/courses').then((data) => setCourses(data as Course[])).catch(() => setCourses([]));
    apiGet('/past-questions').then((data) => setPastQuestions(data as PastQuestionRef[])).catch(() => setPastQuestions([]));
    apiGet('/community/profile').then((data) => setMyCourseIds(((data as { courses?: { id: number }[] }).courses || []).map((course) => course.id))).catch(() => setMyCourseIds([]));
    apiGet('/study-groups').then((data) => setMyGroupIds((data as StudyGroupRef[]).filter((group) => group.is_member).map((group) => group.id))).catch(() => setMyGroupIds([]));
  }, []);

  useEffect(() => {
    if (!initialContext) return;
    const topic = initialContext.material_title || initialContext.course_title || initialContext.topic || initialContext.query;
    setSelectedThread(null);
    setNewTitle(`Discuss ${topic}`);
    setShowForm(true);
    setShowContext(true);
    setFormCourseId(initialContext.course_id ?? '');
    setFormError('');
  }, [initialContext]);

  useEffect(() => {
    if (showForm) composerRef.current?.focus();
  }, [showForm]);

  const openThread = async (thread: Thread) => {
    setSelectedThread(thread);
    setMessages([]);
    setMessagesError('');
    setMessagesLoading(true);
    try {
      setMessages(await apiGet(`/threads/${thread.id}/messages`) as ThreadMessage[]);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'Replies could not be loaded.');
    } finally {
      setMessagesLoading(false);
    }
  };

  useEffect(() => {
    if (selectedThread) msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedThread]);

  const postMessage = async () => {
    const content = messageInput.trim();
    if (!content || !selectedThread || posting) return;
    setPosting(true);
    setMessageInput('');
    try {
      await apiPost(`/threads/${selectedThread.id}/message`, { content });
      setMessages(await apiGet(`/threads/${selectedThread.id}/messages`) as ThreadMessage[]);
    } catch {
      setMessageInput(content);
    } finally {
      setPosting(false);
    }
  };

  const createThread = async () => {
    const content = newTitle.trim();
    if (!content) {
      setFormError('Write a question or thought to start the conversation.');
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const created = await apiPost('/threads', {
        title: content.split(/\r?\n/)[0].slice(0, 180),
        content,
        course_id: formCourseId || initialContext?.course_id || null,
        past_question_id: formQuestionId || null,
      }) as Thread;
      setNewTitle('');
      setFormQuestionId('');
      setShowForm(false);
      await loadThreads();
      await openThread({ ...created, created_by_username: user?.username ?? null });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create discussion.');
    } finally {
      setCreating(false);
    }
  };

  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course.code])), [courses]);
  const questionMap = useMemo(() => new Map(pastQuestions.map((question) => [question.id, question.year ? `${question.year} paper` : question.title])), [pastQuestions]);
  const visibleThreads = useMemo(() => {
    const filtered = threads.filter((thread) => {
      if (feedMode === 'my-courses' && (!thread.course_id || !myCourseIds.includes(thread.course_id))) return false;
      if (feedMode === 'my-groups' && (!thread.group_id || !myGroupIds.includes(thread.group_id))) return false;
      return true;
    });
    if (feedMode === 'latest') return filtered;
    return [...filtered].sort((a, b) => {
      const score = (thread: Thread) => (
        (thread.course_id && myCourseIds.includes(thread.course_id) ? 3 : 0)
        + (thread.group_id && myGroupIds.includes(thread.group_id) ? 3 : 0)
        + (thread.category === 'academic' ? 1 : 0)
      );
      return score(b) - score(a) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [feedMode, myCourseIds, myGroupIds, threads]);

  const meInitials = threadInitials(user?.name || user?.username || 'You');
  const mentionsAI = messageInput.toLowerCase().includes('@ai');

  const copyOrShare = async (thread: Thread) => {
    try {
      await shareThread(thread);
      setShareNote('Discussion link ready to share.');
    } catch {
      notifyUnavailable('Sharing');
    }
    window.setTimeout(() => setShareNote(''), 2600);
  };

  const reportThread = (thread: Thread) => {
    setReportOpenId(null);
    window.location.assign(`/feedback?from=discussion-${thread.id}`);
  };

  const communityAside = (
    <aside className="collab-aside">
      <section className="collab-aside-card collab-aside-card--accent">
        <div className="collab-aside-heading"><Sparkles size={16} aria-hidden="true" /><span>{selectedThread ? 'Thread context' : 'A useful rhythm'}</span></div>
        {selectedThread ? <>
          <h2>{selectedThread.course_id ? courseMap.get(selectedThread.course_id) || 'Course discussion' : 'Open topic'}</h2>
          <p>{selectedThread.group_name ? `Shared in ${selectedThread.group_name}.` : 'Keep replies close to the question so the next student can follow the thinking.'}</p>
        </> : <>
          <h2>Ask, then build on it.</h2>
          <p>Type <strong>@AI</strong> in a thread and the answer stays with the conversation for everyone.</p>
        </>}
      </section>
      <section className="collab-aside-card">
        <div className="collab-aside-heading"><BookOpen size={16} aria-hidden="true" /><span>Relevant courses</span></div>
        {courses.length > 0 ? <ul className="collab-course-list">{courses.filter((course) => !selectedThread || course.id === selectedThread.course_id || myCourseIds.includes(course.id)).slice(0, 4).map((course) => <li key={course.id}><span>{course.code}</span><small>{course.name}</small></li>)}</ul> : <p>Course context will appear here as the catalogue grows.</p>}
      </section>
      <section className="collab-aside-card">
        <div className="collab-aside-heading"><Users size={16} aria-hidden="true" /><span>Active study circles</span></div>
        <p>{myGroupIds.length > 0 ? `You are connected to ${myGroupIds.length} study group${myGroupIds.length === 1 ? '' : 's'}.` : 'Join a study group to bring course conversations closer together.'}</p>
        <button type="button" className="collab-aside-link" onClick={() => go('groups')}>Find a study group <ArrowUpRight size={15} aria-hidden="true" /></button>
      </section>
      <section className="collab-aside-card collab-aside-card--quiet">
        <span className="collab-aside-stat">{threads.length}</span>
        <div><strong>open conversations</strong><p>Give a question enough detail that someone else can pick it up.</p></div>
      </section>
    </aside>
  );

  if (selectedThread) {
    return (
      <div className="page" id="s-collab">
        <div className="collab-layout collab-layout--thread">
          <main className="collab-feed-column">
            <button type="button" className="collab-back" onClick={() => { setSelectedThread(null); setMessages([]); }}><ArrowLeft size={16} aria-hidden="true" /> Back to discussions</button>
            <article className="thread-view">
              <header className="thread-view-head">
                <div className="thread-view-avatar">{threadInitials(selectedThread.created_by_username || selectedThread.title)}</div>
                <div className="thread-view-heading">
                  <div className="thread-author-line"><strong>{selectedThread.created_by_name || selectedThread.created_by_username || 'Student'}</strong><span>@{selectedThread.created_by_username || 'student'}</span><span>{timeAgo(selectedThread.created_at)}</span></div>
                  <h1>{selectedThread.title}</h1>
                  <div className="thread-anchor">
                    {courseMap.get(selectedThread.course_id ?? -1) && <span className="anchor-course">{courseMap.get(selectedThread.course_id ?? -1)}</span>}
                    {questionMap.get(selectedThread.past_question_id ?? -1) && <span className="anchor-question">{questionMap.get(selectedThread.past_question_id ?? -1)}</span>}
                  </div>
                </div>
                <button type="button" className="icon-action" onClick={() => void copyOrShare(selectedThread)} aria-label="Share discussion" title="Share discussion"><Share2 size={17} aria-hidden="true" /></button>
              </header>
              <div className="thread-parent-content">{selectedThread.content || selectedThread.title}</div>
              <div className="thread-view-intro">Reply in your own words, or mention <strong>@AI</strong> when you want help grounding the question in ExamMind materials.</div>
              {messagesLoading && <div className="thread-loading"><RefreshCw size={16} className="spin" aria-hidden="true" /> Loading replies</div>}
              {messagesError && <div className="thread-error" role="alert"><strong>Replies are taking a moment.</strong><span>{messagesError}</span><button type="button" onClick={() => void openThread(selectedThread)}>Try again</button></div>}
              {!messagesLoading && !messagesError && messages.length === 0 && <div className="thread-empty"><MessageCircle size={22} aria-hidden="true" /><strong>Be the first voice here.</strong><span>Give this question a useful next step.</span></div>}
              <ul className="messages">
                {messages.map((msg) => {
                  const isAI = msg.is_ai_response;
                  const isMe = !isAI && msg.user_id === user?.id;
                  const name = isAI ? 'ExamMind AI' : isMe ? 'You' : `@${msg.user_username || 'student'}`;
                  return (
                    <li className={`message${isAI ? ' is-ai' : ''}`} key={msg.id}>
                      <span className="message-avatar" aria-hidden="true">{isAI ? 'AI' : isMe ? meInitials : threadInitials(msg.user_username || 'Student')}</span>
                      <div><p className="message-head"><span className="message-who">{name}</span><span className="message-when">{timeAgo(msg.created_at)}</span></p><p className="message-body">{msg.content}</p></div>
                    </li>
                  );
                })}
              </ul>
              <div className="reply-box">
                <span className="composer-avatar" aria-hidden="true">{meInitials}</span>
                <div className="reply-composer">
                  <label className="sr-only" htmlFor="thread-reply">Reply to this thread</label>
                  <textarea id="thread-reply" className="composer-input" rows={2} placeholder="Reply, or type @AI to ask the assistant..." value={messageInput} onChange={(e) => setMessageInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postMessage(); } }} disabled={posting} />
                  <div className="composer-foot"><span className="composer-hint">{mentionsAI ? 'ExamMind AI will answer in the thread' : 'Everyone in this conversation can build on your reply'}</span><button type="button" className="btn-post" onClick={() => void postMessage()} disabled={posting || !messageInput.trim()}>{posting ? 'Sending...' : 'Reply'} <ChevronRight size={15} aria-hidden="true" /></button></div>
                </div>
              </div>
            </article>
          </main>
          {communityAside}
        </div>
      </div>
    );
  }

  return (
    <div className="page" id="s-collab">
      <div className="collab-page-head">
        <div><div className="pg-title">Discussions</div><p className="pg-sub">Questions, explanations and useful conversations from your study world.</p></div>
        <button type="button" className="collab-new-button" onClick={() => { setShowForm(true); setFormError(''); }}><Plus size={17} aria-hidden="true" /> Start a discussion</button>
      </div>

      <div className="collab-layout">
        <main className="collab-feed-column">
          <div className="collab-feed-tabs" role="tablist" aria-label="Discussion feed view">
            {(['for-you', 'latest', 'my-courses', 'my-groups'] as const).map((mode) => <button type="button" role="tab" key={mode} aria-selected={feedMode === mode} className={feedMode === mode ? 'is-active' : ''} onClick={() => setFeedMode(mode)}>{mode === 'for-you' ? 'For You' : mode === 'latest' ? 'Latest' : mode === 'my-courses' ? 'My Courses' : 'My Groups'}</button>)}
            <span className="collab-feed-count">{threads.length} conversations</span>
          </div>

          <section className={`collab-composer${showForm || newTitle ? ' is-open' : ''}`}>
            <span className="composer-avatar" aria-hidden="true">{meInitials}</span>
            <div className="collab-composer-body">
              <label className="sr-only" htmlFor="new-thread">Start a discussion</label>
              <textarea ref={composerRef} id="new-thread" className="composer-input" rows={showForm || newTitle ? 3 : 1} maxLength={2000} placeholder="What are you working through?" value={newTitle} onFocus={() => setShowForm(true)} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void createThread(); } }} />
              {showContext && <>
                <div className="composer-anchor">
                  <select aria-label="Course this discussion is about" className="anchor-select" value={formCourseId} onChange={(e) => { setFormCourseId(e.target.value ? Number(e.target.value) : ''); setFormQuestionId(''); }}>
                    <option value="">Course not selected</option>
                    {courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}
                  </select>
                  <select aria-label="Past question this discussion is about" className="anchor-select" value={formQuestionId} disabled={!formCourseId} onChange={(e) => setFormQuestionId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">{formCourseId ? 'Link a past question (optional)' : 'Select a course first'}</option>
                    {pastQuestions.filter((question) => question.course_id === formCourseId).map((question) => <option key={question.id} value={question.id}>{question.year ? `${question.year} · ` : ''}{question.title}</option>)}
                  </select>
                </div>
                {courses.length === 0 && <p className="composer-note">Your course catalogue is empty or unavailable right now. You can still post this conversation and add context in the text.</p>}
              </>}
              {formError && <div className="upload-alert">{formError}</div>}
              <div className="composer-foot"><div className="composer-tools"><button type="button" className="btn-context" aria-expanded={showContext} onClick={() => setShowContext((current) => !current)}><BookOpen size={14} aria-hidden="true" /> {showContext ? 'Hide context' : 'Add context'}</button><span className="composer-count">{newTitle.length}/2000</span><span className="composer-hint">A clear question helps a classmate help.</span></div><div className="composer-actions">{(showForm || newTitle) && <button type="button" className="btn-quiet" onClick={() => { setShowForm(false); setShowContext(false); setNewTitle(''); setFormError(''); }}>Cancel</button>}<button type="button" className="btn-post" onClick={() => void createThread()} disabled={creating || !newTitle.trim()}>{creating ? 'Posting...' : 'Post'} <ChevronRight size={15} aria-hidden="true" /></button></div></div>
            </div>
          </section>

          {threadsLoading && <div className="feed-state feed-state--loading"><RefreshCw size={17} className="spin" aria-hidden="true" /> Finding conversations</div>}
          {threadsError && <div className="feed-error"><strong>Discussions are taking a moment.</strong><span>{threadsError}</span><button type="button" onClick={() => void loadThreads()}>Try again</button></div>}
          {!threadsLoading && !threadsError && threads.length === 0 && <div className="feed-empty"><div className="feed-empty-icon"><MessageCircle size={23} aria-hidden="true" /></div><strong>Start the first conversation.</strong><p>Ask the question you wish someone had asked before the exam.</p><button type="button" className="btn-post" onClick={() => setShowForm(true)}>Write a question <Plus size={15} aria-hidden="true" /></button></div>}
          {!threadsLoading && !threadsError && threads.length > 0 && visibleThreads.length === 0 && <div className="feed-empty"><div className="feed-empty-icon"><BookOpen size={23} aria-hidden="true" /></div><strong>Nothing here yet.</strong><p>{feedMode === 'my-courses' ? 'Choose a course during onboarding or add context to a discussion.' : 'Join a study group to bring its conversations into this feed.'}</p><button type="button" className="btn-quiet" onClick={() => setFeedMode('for-you')}>Back to For You</button></div>}

          <ul className="feed">
            {!threadsLoading && visibleThreads.map((thread) => (
              <li className="feed-post" key={thread.id}>
                <button type="button" className="feed-post-body" onClick={() => void openThread(thread)}>
                  <span className="thread-avatar" aria-hidden="true">{threadInitials(thread.created_by_username || thread.title)}</span>
                  <span className="feed-post-content">
                    <span className="feed-post-author"><strong>{thread.created_by_name || thread.created_by_username || 'Student'}</strong><span>@{thread.created_by_username || 'student'}</span><span>{timeAgo(thread.created_at)}</span><ChevronRight size={13} aria-hidden="true" /></span>
                    <span className="thread-title">{thread.title}</span>
                    {thread.content && thread.content !== thread.title && <span className="thread-preview">{thread.content}</span>}
                    <span className="thread-anchor">{courseMap.get(thread.course_id ?? -1) ? <span className="anchor-course">{courseMap.get(thread.course_id ?? -1)}</span> : <span className="anchor-none">Open topic</span>}{questionMap.get(thread.past_question_id ?? -1) && <span className="anchor-question">{questionMap.get(thread.past_question_id ?? -1)}</span>}{thread.group_name && <span className="anchor-group">{thread.group_name}</span>}{thread.category === 'academic' && <span className="anchor-study">Study</span>}{thread.category === 'casual' && <span className="anchor-lounge">Lounge</span>}{thread.mood === 'stuck' && <span className="anchor-stuck">Needs a hand</span>}</span>
                  </span>
                </button>
                <div className="feed-post-actions"><button type="button" onClick={() => void openThread(thread)}><MessageCircle size={16} aria-hidden="true" /> {thread.reply_count || 0} {thread.reply_count === 1 ? 'Reply' : 'Replies'}</button><button type="button" onClick={() => void copyOrShare(thread)}><Share2 size={15} aria-hidden="true" /> Share</button><span className="feed-post-more"><button type="button" aria-label={`More actions for ${thread.title}`} aria-expanded={reportOpenId === thread.id} onClick={() => setReportOpenId((current) => current === thread.id ? null : thread.id)}><MoreHorizontal size={16} aria-hidden="true" /></button>{reportOpenId === thread.id && <span className="feed-post-menu"><button type="button" onClick={() => reportThread(thread)}><Flag size={14} aria-hidden="true" /> Report</button></span>}</span></div>
              </li>
            ))}
          </ul>
          {shareNote && <div className="share-note" role="status">{shareNote}</div>}
        </main>
        {communityAside}
      </div>
    </div>
  );
}
