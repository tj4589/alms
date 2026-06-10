import type { GlobalSearchResult, PastQuestion, ScreenType } from '../types';

function preview(value: string | null | undefined, fallback: string, max = 132): string {
  const text = (value || fallback).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function noteSummary(query: string, topic: string): string {
  if (query.trim().toLowerCase() === 'knowledge') {
    return 'No uploaded materials match this yet. This may relate to knowledge management, learning theory, information systems, or knowledge representation depending on the course context.';
  }
  return `No uploaded materials match this yet. ${topic} may depend on the course context, so uploaded notes or past questions will make future results more precise.`;
}

type Props = {
  query: string;
  result: GlobalSearchResult | null;
  loading: boolean;
  onAskAI: (q: string) => void;
  onUpload: () => void;
  onPractice: (topic: string) => void;
  go: (screen: ScreenType) => void;
};

export default function SearchResults({ query, result, loading, onAskAI, onUpload, onPractice, go }: Props) {
  const topic = result?.understanding?.interpreted_topic?.trim() || query;
  const relatedTerms = result?.understanding?.related_terms || [];
  const pastQuestions = result?.past_questions || [];
  const lectureNotes = result?.lecture_notes || [];
  const threads = result?.threads || [];
  const groups = result?.study_groups || [];
  const rooms = result?.study_sessions || [];
  const relatedTopics = result?.related_topics || [];
  const hasUploaded = pastQuestions.length > 0 || lectureNotes.length > 0;
  const hasBestMatches = lectureNotes.length > 0 || pastQuestions.length > 0;

  if (loading) {
    return (
      <div className="search-page">
        <div className="search-loading">
          <span className="ai-dot"></span>
          Searching ExamMind for "{query}"...
        </div>
      </div>
    );
  }

  return (
    <div className="search-page">
      <div className="search-page-head">
        <div>
          <div className="search-page-kicker">ExamMind Search</div>
          <h1 className="search-page-title">Search results for "{query}"</h1>
          <p className="search-page-sub">
            Uploaded materials · Past questions · Practice · Discussions · Study groups · Reading rooms
          </p>
        </div>
      </div>

      <div className="search-layout">
        <div className="search-main">
          <section className={`search-overview ${hasUploaded ? '' : 'is-general'}`}>
            <div className="search-badge">
              {hasUploaded ? 'Grounded in uploaded materials' : 'General overview · no uploaded source found'}
            </div>
            <h2>{topic}</h2>
            <p>
              {hasUploaded
                ? `Found ${lectureNotes.length} lecture note${lectureNotes.length === 1 ? '' : 's'} and ${pastQuestions.length} past question${pastQuestions.length === 1 ? '' : 's'} connected to this search.`
                : noteSummary(query, topic)}
            </p>
            {relatedTerms.length > 0 && (
              <div className="search-muted">Also considered: {relatedTerms.slice(0, 4).join(', ')}</div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Best Matches</div>
            {hasBestMatches ? (
              <div className="search-result-list">
                {lectureNotes.slice(0, 2).map(note => (
                  <div className="search-result-row" key={`best-note-${note.id}`}>
                    <div>
                      <div className="search-result-title">{note.title}</div>
                      <div className="search-muted">{note.topic || 'Lecture note'}{note.year ? ` · ${note.year}` : ''}</div>
                    </div>
                    <span className="search-result-type">Note</span>
                  </div>
                ))}
                {pastQuestions.slice(0, 2).map((item: PastQuestion) => {
                  const meta = item.metadata_json as { course_code?: string; topics_covered?: string[] } | null;
                  return (
                    <div className="search-result-row" key={`best-pq-${item.id}`}>
                      <div>
                        <div className="search-result-title">{preview(item.content_text, 'Past question')}</div>
                        <div className="search-muted">
                          {meta?.course_code || 'Past question'}{item.year ? ` · ${item.year}` : ''}
                          {meta?.topics_covered?.[0] ? ` · ${meta.topics_covered[0]}` : ''}
                        </div>
                      </div>
                      <span className="search-result-type">Question</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="search-empty-row">No best matches yet.</div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Uploaded Materials</div>
            {lectureNotes.length > 0 ? (
              <div className="search-result-list">
                {lectureNotes.slice(0, 6).map(note => (
                  <div className="search-result-row" key={note.id}>
                    <div>
                      <div className="search-result-title">{note.title}</div>
                      <div className="search-muted">{note.topic || 'Lecture note'}{note.year ? ` · ${note.year}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="search-empty-row">
                <span>No lecture notes found for this search.</span>
                <button className="search-link-btn" onClick={onUpload}>Upload notes</button>
              </div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Past Questions</div>
            {pastQuestions.length > 0 ? (
              <div className="search-result-list">
                {pastQuestions.slice(0, 6).map(item => {
                  const meta = item.metadata_json as { course_code?: string; topics_covered?: string[] } | null;
                  return (
                    <div className="search-result-row" key={item.id}>
                      <div>
                        <div className="search-result-title">{preview(item.content_text, 'Past question')}</div>
                        <div className="search-muted">
                          {meta?.course_code || 'Past question'}{item.year ? ` · ${item.year}` : ''}
                          {meta?.topics_covered?.[0] ? ` · ${meta.topics_covered[0]}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="search-empty-row">
                <span>No past questions found yet.</span>
                <button className="search-link-btn" onClick={onUpload}>Upload past questions</button>
              </div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Practice</div>
            <div className="search-empty-row">
              <span>No shared practice sets yet.</span>
              <button className="search-link-btn" onClick={() => onPractice(topic)}>Generate practice</button>
            </div>
          </section>
        </div>

        <aside className="search-side">
          <section className="search-card">
            <div className="search-card-title">Quick Actions</div>
            <div className="search-action-grid">
              <button className="search-primary-btn" onClick={() => onAskAI(`Explain ${topic}`)}>Learn more with AI</button>
              <button className="search-action-btn" onClick={() => onPractice(topic)}>Generate practice</button>
              <button className="search-action-btn" onClick={onUpload}>Upload material</button>
              <button className="search-action-btn" onClick={() => go('collab')}>Start discussion</button>
              <button className="search-action-btn" onClick={() => go('groups')}>Create study group</button>
            </div>
          </section>

          <section className="search-card">
            <div className="search-card-title">Related Topics</div>
            {relatedTopics.length > 0 ? (
              <div className="search-chip-row">
                {relatedTopics.slice(0, 10).map(item => <span className="search-chip" key={item}>{item}</span>)}
              </div>
            ) : (
              <div className="search-empty-row">No related topics found yet.</div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Discussions</div>
            {threads.length > 0 ? (
              threads.slice(0, 3).map(thread => (
                <button className="search-link-row" key={thread.id} onClick={() => go('collab')}>
                  <span>{thread.title}</span>
                  <small>{thread.created_by_username ? `@${thread.created_by_username}` : 'Discussion'}</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>No discussions yet.</span>
                <button className="search-link-btn" onClick={() => go('collab')}>Start one</button>
              </div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Study Groups</div>
            {groups.length > 0 ? (
              groups.slice(0, 3).map(group => (
                <button className="search-link-row" key={group.id} onClick={() => go('groups')}>
                  <span>{group.name}</span>
                  <small>{group.topic || 'Study group'} · {group.member_count || 0} members</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>No groups yet.</span>
                <button className="search-link-btn" onClick={() => go('groups')}>Create one</button>
              </div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Reading Rooms</div>
            {rooms.length > 0 ? (
              rooms.slice(0, 3).map(room => (
                <button className="search-link-row" key={room.id} onClick={() => go('groups')}>
                  <span>{room.title}</span>
                  <small>{room.topic || room.exam_goal || 'Active room'} · {room.participant_count || 0} active</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>No active rooms yet.</span>
                <button className="search-link-btn" onClick={() => go('groups')}>Start room</button>
              </div>
            )}
          </section>

          <section className="search-learn-card">
            <div>
              <div className="search-card-title">Learn more with ExamMind AI</div>
              <p>Ask the AI Assistant to explain this step-by-step using uploaded materials where available.</p>
            </div>
            <button className="search-primary-btn" onClick={() => onAskAI(`Explain ${topic}`)}>Learn more with AI</button>
          </section>
        </aside>
      </div>
    </div>
  );
}
