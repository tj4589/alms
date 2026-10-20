import { useState } from 'react';
import { FileQuestion, FileText, MessagesSquare, UsersRound, Video } from 'lucide-react';
import type { GlobalSearchResult, PastQuestion, ScreenType, SearchActionContext, SearchCommunityKind, SearchSuggestedAction } from '../types';
import { saveStudyPack } from '../offline';

function preview(value: string | null | undefined, fallback: string, max = 132): string {
  const text = (value || fallback).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function noteSummary(topic: string): string {
  return `We’re using “${topic}” as a starting point. Explore the suggestions below, ask Maxe for context, or add a source to make this search more precise.`;
}

type Props = {
  query: string;
  result: GlobalSearchResult | null;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  onAskAI: (q: string) => void;
  onUpload: () => void;
  onOpenResource: (kind: 'lecture_note' | 'past_question', id: number) => void;
  onPractice: (topic: string, context?: SearchActionContext) => void;
  onCommunityAction?: (action: 'discussion' | 'study_group' | 'reading_room', context: SearchActionContext) => void;
  onOpenCommunity?: (kind: SearchCommunityKind, id: number) => void;
  onMaterialDeleted?: () => void;
  go: (screen: ScreenType) => void;
};

function metadataValue(meta: PastQuestion['metadata_json'], key: string): string {
  if (!meta || typeof meta !== 'object') return '';
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function materialTitle(item: PastQuestion): string {
  const meta = item.metadata_json as Record<string, unknown> | null;
  const generated = [
    metadataValue(meta, 'course_code'),
    metadataValue(meta, 'course_title'),
    metadataValue(meta, 'document_type').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    metadataValue(meta, 'academic_year'),
  ].filter(Boolean).join(' ');
  return item.title || metadataValue(meta, 'document_title') || generated || preview(item.content_text, 'Past question', 90);
}

function materialMetaLine(item: PastQuestion): string {
  const meta = item.metadata_json as Record<string, unknown> | null;
  const documentType = metadataValue(meta, 'document_type').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Past Question';
  const year = metadataValue(meta, 'academic_year') || (item.year ? String(item.year) : '');
  const semester = item.semester || metadataValue(meta, 'semester');
  const matches = item.matching_sections || item.chunk_ids?.length || 1;
  return [documentType, year, semester, `${matches} matching section${matches === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}

function SearchLoadingState({ query }: { query: string }) {
  return (
    <div className="search-page search-state-page">
      <section className="search-state-card search-state-card--loading" role="status" aria-live="polite">
        <div className="search-state-orb" aria-hidden="true"><span /></div>
        <div className="search-state-copy">
          <p className="search-page-kicker">ExamMind Search</p>
          <h1>Finding the right study context for <span>“{query}”</span></h1>
          <p>Checking your materials, past questions and study spaces.</p>
          <div className="search-state-track" aria-hidden="true"><span /></div>
        </div>
        <div className="search-state-sources" aria-hidden="true">
          <span>Materials</span><span>Questions</span><span>Study spaces</span>
        </div>
      </section>
    </div>
  );
}

function SearchErrorState({ query, message, onRetry, onAskAI, onUpload, onPractice, go }: { query: string; message: string; onRetry?: () => void; onAskAI: (question: string) => void; onUpload: () => void; onPractice: (topic: string) => void; go: (screen: ScreenType) => void }) {
  return (
    <div className="search-page search-state-page">
      <section className="search-state-card search-state-card--error" role="alert">
        <div className="search-state-icon" aria-hidden="true">!</div>
        <div className="search-state-copy">
          <p className="search-page-kicker">Your search is still useful</p>
          <h1>Let’s make “{query}” useful.</h1>
          <p>{message} Your phrase is saved; try one of these ways to keep moving while we reconnect.</p>
          <div className="search-state-actions">
            {onRetry && <button type="button" className="search-primary-btn" aria-label="Retry search" onClick={onRetry}>Try again</button>}
            <button type="button" className="search-secondary-btn" onClick={() => onAskAI(`Explain “${query}” and suggest related concepts.`)}>Ask Maxe for context</button>
            <button type="button" className="search-secondary-btn" onClick={() => onPractice(query)}>Practice this topic</button>
            <button type="button" className="search-secondary-btn" onClick={onUpload}>Add a source</button>
            <button type="button" className="search-secondary-btn" onClick={() => go('workspace')}>Back to study desk</button>
          </div>
          <small>Search again in a moment to load your saved materials and community results.</small>
        </div>
      </section>
    </div>
  );
}

export default function SearchResults({ query, result, loading, error, onRetry, onAskAI, onUpload, onOpenResource, onPractice, onCommunityAction, onOpenCommunity, go }: Props) {
  const [offlineState, setOfflineState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const topic = result?.understanding?.interpreted_topic?.trim() || query;
  const relatedTerms = result?.understanding?.related_terms || [];
  const pastQuestions = result?.past_questions || [];
  const lectureNotes = result?.lecture_notes || [];
  const threads = result?.threads || [];
  const groups = result?.study_groups || [];
  const rooms = result?.study_sessions || [];
  const relatedTopics = result?.related_topics || [];
  const hasUploaded = pastQuestions.length > 0 || lectureNotes.length > 0;
  const totalMatches = lectureNotes.length + pastQuestions.length + threads.length + groups.length + rooms.length;
  const suggestedActions = (result?.suggested_actions || []).slice(0, 4);
  const hasDirectResults = totalMatches > 0;
  const primaryMaterial = pastQuestions[0];
  const primaryContext: SearchActionContext = {
    query,
    topic,
    course_id: primaryMaterial?.course_id ?? lectureNotes[0]?.course_id ?? null,
    course_code: metadataValue(primaryMaterial?.metadata_json, 'course_code'),
    course_title: metadataValue(primaryMaterial?.metadata_json, 'course_title'),
    material_title: primaryMaterial ? materialTitle(primaryMaterial) : lectureNotes[0]?.title,
  };
  const groundedAiPrompt = primaryContext.material_title
    ? `Using uploaded ExamMind materials, explain what "${query}" relates to in ${primaryContext.material_title}. Include the key past-question topics and cite sources.`
    : `Using uploaded ExamMind materials, explain ${topic}. Include relevant sources.`;
  const goCommunity = (action: 'discussion' | 'study_group' | 'reading_room') => {
    if (onCommunityAction) onCommunityAction(action, primaryContext);
    else go(action === 'discussion' ? 'collab' : 'groups');
  };
  const openCommunity = (kind: SearchCommunityKind, id: number) => {
    if (onOpenCommunity) onOpenCommunity(kind, id);
    else go(kind === 'discussion' ? 'collab' : 'groups');
  };
  const runSuggestedAction = (action: SearchSuggestedAction) => {
    const payload = action.payload || {};
    const suggestedTopic = typeof payload.topic === 'string' && payload.topic.trim() ? payload.topic : topic;
    switch (action.action) {
      case 'ask_ai':
        onAskAI(typeof payload.question === 'string' && payload.question.trim() ? payload.question : `Explain “${suggestedTopic}” and suggest related concepts.`);
        break;
      case 'upload':
        onUpload();
        break;
      case 'practice':
        onPractice(suggestedTopic, { ...primaryContext, topic: suggestedTopic });
        break;
      case 'discussion':
      case 'study_group':
      case 'reading_room':
        goCommunity(action.action);
        break;
    }
  };
  const saveQuestionsOffline = async () => {
    if (!pastQuestions.length || offlineState === 'saving') return;
    setOfflineState('saving');
    try {
      await saveStudyPack({
        id: `search-${crypto.randomUUID()}`,
        courseCode: metadataValue(pastQuestions[0]?.metadata_json, 'course_code') || 'All',
        title: `“${query}” study pack`,
        savedAt: new Date().toISOString(),
        questions: pastQuestions.map(item => ({
          year: String(item.year || 'Unknown'),
          topic: Array.isArray((item.metadata_json as Record<string, unknown> | null)?.topics_covered)
            ? String(((item.metadata_json as Record<string, unknown>).topics_covered as unknown[])[0] || 'General')
            : 'General',
          difficulty: item.difficulty || 'Mixed',
          text: item.content_text || materialTitle(item),
        })),
      });
      window.dispatchEvent(new Event('exammind-offline-updated'));
      setOfflineState('saved');
    } catch {
      setOfflineState('error');
    }
  };
  if (loading) return <SearchLoadingState query={query} />;

  if (error) return <SearchErrorState query={query} message={error} onRetry={onRetry} onAskAI={onAskAI} onUpload={onUpload} onPractice={(nextTopic) => onPractice(nextTopic, { ...primaryContext, topic: nextTopic })} go={go} />;

  return (
    <div className="search-page search-results-page">
      <div className="search-page-head search-results-head">
        <div className="search-results-title-wrap">
          <div className="search-page-kicker"><span>ExamMind Search</span><span className="search-scope-pill">Active learning space</span></div>
          <h1 className="search-page-title">Search results for <span>"{query}"</span></h1>
          <p className="search-page-sub"><strong>{totalMatches}</strong> result{totalMatches === 1 ? '' : 's'} across your materials and study community</p>
        </div>
        <div className="search-results-head-meta" aria-label="Search coverage">
          <span className="search-head-meta-label">Search coverage</span>
          <span>Materials · Questions · Community</span>
        </div>
      </div>

      <div className="search-layout">
        <div className="search-main">
          <section className={`search-overview search-results-hero ${hasUploaded ? '' : 'is-general'}`}>
            <div className="search-overview-main">
              <div className="search-overview-topline">
                <div className="search-badge">
                  {hasUploaded ? 'Grounded in uploaded materials' : 'A useful starting point'}
                </div>
                <span className="search-overview-query">{hasUploaded ? 'Source-backed' : 'Broad search'}</span>
              </div>
              <h2>{topic}</h2>
              <p>
                {hasUploaded
                  ? `Found ${lectureNotes.length} lecture note${lectureNotes.length === 1 ? '' : 's'} and ${pastQuestions.length} past question${pastQuestions.length === 1 ? '' : 's'} connected to this search.`
                  : noteSummary(topic)}
              </p>
              {relatedTerms.length > 0 && (
                <div className="search-muted">Also considered: {relatedTerms.slice(0, 4).join(', ')}</div>
              )}
            </div>
            <div className="search-overview-stats" aria-label="Search result counts">
              <div><strong>{lectureNotes.length}</strong><span>Notes</span></div>
              <div><strong>{pastQuestions.length}</strong><span>Questions</span></div>
              <div><strong>{threads.length + groups.length + rooms.length}</strong><span>Community</span></div>
            </div>
          </section>

          {!hasDirectResults && suggestedActions.length > 0 && (
            <section className="search-card search-card--recommendations" aria-label="Recommended next steps">
              <div className="search-card-eyebrow">Keep exploring</div>
              <div className="search-card-title">Useful next steps for this search</div>
              <p className="search-recommendation-intro">We can take this phrase in a few helpful directions:</p>
              <div className="search-recommendation-grid">
                {suggestedActions.map((action, index) => (
                  <button type="button" className="search-recommendation-btn" key={`${action.action}-${index}`} onClick={() => runSuggestedAction(action)}>
                    <span className="search-recommendation-index">{String(index + 1).padStart(2, '0')}</span>
                    <span>{action.label.replace(/^Ask AI\b/, 'Ask Maxe')}</span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="search-evidence-sheet" aria-label="Searchable sources">
            <div className="search-evidence-head">
              <div>
                <div className="search-card-eyebrow">Your study sources</div>
                <h2>Open something useful</h2>
              </div>
              <span className="search-sheet-count">{lectureNotes.length + pastQuestions.length} source{lectureNotes.length + pastQuestions.length === 1 ? '' : 's'}</span>
            </div>
            <div className="search-evidence-grid">
          <section className="search-card search-card--materials">
            <div className="search-card-head">
              <div><div className="search-card-title search-card-title-with-icon"><FileText size={17} strokeWidth={1.8} aria-hidden="true" /><span>Uploaded materials</span></div><div className="search-card-caption">Lecture notes and source files</div></div>
              <span className="search-count-pill">{lectureNotes.length}</span>
            </div>
            {lectureNotes.length > 0 ? (
              <div className="search-result-list">
                {lectureNotes.slice(0, 6).map(note => (
                  <div className="search-result-row" key={note.id}>
                    <div className="search-result-leading"><span className="search-result-mark search-result-mark--note" aria-hidden="true"><FileText size={15} strokeWidth={1.8} /></span><div>
                      <div className="search-result-title">{note.title}</div>
                      <div className="search-muted">{note.topic || 'Lecture note'}{note.year ? ` · ${note.year}` : ''}</div>
                    </div></div>
                    <button type="button" className="search-link-btn" onClick={() => onOpenResource('lecture_note', note.id)} aria-label={`Open ${note.title}`}>Open</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="search-empty-row">
                <span>Build this result by adding a lecture note for “{topic}”.</span>
                <button className="search-link-btn" onClick={onUpload}>Upload notes</button>
              </div>
            )}
          </section>

          <section className="search-card search-card--questions">
            <div className="search-card-head">
              <div><div className="search-card-title search-card-title-with-icon"><FileQuestion size={17} strokeWidth={1.8} aria-hidden="true" /><span>Past questions</span></div><div className="search-card-caption">Exam archive and practice leads</div></div>
              <div className="search-card-tools"><span className="search-count-pill">{pastQuestions.length}</span>
              {pastQuestions.length > 0 && <button type="button" className="search-link-btn" onClick={() => void saveQuestionsOffline()} disabled={offlineState === 'saving' || offlineState === 'saved'}>{offlineState === 'saving' ? 'Saving…' : offlineState === 'saved' ? 'Saved offline' : 'Save offline'}</button>}
              </div>
            </div>
            {offlineState === 'saved' && <p className="search-muted" role="status">Saved for offline study.</p>}
            {offlineState === 'error' && <p className="search-muted" role="alert">This study pack could not be saved on this device. Try again.</p>}
            {pastQuestions.length > 0 ? (
              <div className="search-result-list">
                {pastQuestions.slice(0, 6).map(item => {
                  const meta = item.metadata_json as { course_code?: string; topics_covered?: string[] } | null;
                  return (
                    <div className="search-result-row" key={item.id}>
                      <div className="search-result-leading"><span className="search-result-mark search-result-mark--question" aria-hidden="true"><FileQuestion size={15} strokeWidth={1.8} /></span><div>
                        <div className="search-result-title">{materialTitle(item)}</div>
                        {(item.snippets || []).slice(0, 3).map(snippet => (
                          <div className="search-muted" key={snippet}>{preview(snippet, '', 160)}</div>
                        ))}
                        <div className="search-muted">
                          {meta?.course_code ? `${meta.course_code} · ` : ''}{materialMetaLine(item)}
                          {meta?.topics_covered?.[0] ? ` · ${meta.topics_covered[0]}` : ''}
                        </div>
                      </div></div>
                      <button type="button" className="search-link-btn" onClick={() => onOpenResource('past_question', item.id)} aria-label={`Open ${materialTitle(item)}`}>Open</button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="search-empty-row">
                <span>Grow this result with a related phrase or an uploaded past question.</span>
                <button className="search-link-btn" onClick={onUpload}>Upload past questions</button>
              </div>
            )}
          </section>
            </div>
          </section>

          <section className="search-card search-card--practice">
            <div className="search-card-head">
              <div><div className="search-card-eyebrow">Keep going</div><div className="search-card-title">Practice this topic</div></div>
              <span className="search-practice-mark" aria-hidden="true">↗</span>
            </div>
            <div className="search-practice-body">
              <span>Turn this search into a focused practice quiz.</span>
              <button className="search-link-btn" onClick={() => onPractice(topic, primaryContext)}>Create practice quiz</button>
            </div>
          </section>
        </div>

        <aside className="search-side">
          <section className="search-card search-card--actions">
            <div className="search-card-eyebrow">Next step</div>
            <div className="search-card-title">Make this useful</div>
            <p className="search-side-intro">Turn this search into a study action or ask Maxe to explain the source context.</p>
            <div className="search-action-grid">
              <button className="search-primary-btn" onClick={() => onAskAI(groundedAiPrompt)}>Ask Maxe about this</button>
              <button className="search-action-btn" onClick={() => onPractice(topic, primaryContext)}>Create practice quiz</button>
              <button className="search-action-btn" onClick={onUpload}>Upload material</button>
              <button className="search-action-btn" onClick={() => goCommunity('discussion')}>Start discussion thread</button>
            </div>
          </section>

          <section className="search-card search-card--related">
            <div className="search-card-head"><div><div className="search-card-eyebrow">Explore next</div><div className="search-card-title">Related topics</div></div><span className="search-count-pill">{relatedTopics.length}</span></div>
            {relatedTopics.length > 0 ? (
              <div className="search-related-list">
                {relatedTopics.slice(0, 10).map(item => <span key={item}>{item}</span>)}
              </div>
            ) : (
              <div className="search-empty-row">Related ideas will appear here as your library grows.</div>
            )}
          </section>

          <section className="search-community-sheet" aria-label="Study together">
            <div className="search-community-head">
              <div>
                <div className="search-card-eyebrow">Study together</div>
                <h2>Continue with people</h2>
              </div>
              <span className="search-sheet-count">{threads.length + groups.length + rooms.length} match{threads.length + groups.length + rooms.length === 1 ? '' : 'es'}</span>
            </div>
            <div className="search-community-list">
          <section className="search-community-item search-card search-card--discussion">
            <div className="search-card-title search-community-title"><MessagesSquare size={17} strokeWidth={1.8} aria-hidden="true" /><span>Discussions</span></div>
            {threads.length > 0 ? (
              threads.slice(0, 3).map(thread => (
                <button className="search-link-row" key={thread.id} onClick={() => openCommunity('discussion', thread.id)}>
                  <span>{thread.title}</span>
                  <small>{thread.created_by_username ? `@${thread.created_by_username}` : 'Discussion'}</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>Start a conversation around this search.</span>
                <button className="search-link-btn" onClick={() => goCommunity('discussion')}>Start one</button>
              </div>
            )}
          </section>

          <section className="search-community-item search-card search-card--groups">
            <div className="search-card-title search-community-title"><UsersRound size={17} strokeWidth={1.8} aria-hidden="true" /><span>Study groups</span></div>
            {groups.length > 0 ? (
              groups.slice(0, 3).map(group => (
                <button className="search-link-row" key={group.id} onClick={() => openCommunity('study_group', group.id)}>
                  <span>{group.name}</span>
                  <small>{group.topic || 'Study group'} · {group.member_count || 0} members</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>Make this a shared study topic.</span>
                <button className="search-link-btn" onClick={() => goCommunity('study_group')}>Create one</button>
              </div>
            )}
          </section>

          <section className="search-community-item search-card search-card--rooms">
            <div className="search-card-title search-community-title"><Video size={17} strokeWidth={1.8} aria-hidden="true" /><span>Reading rooms</span></div>
            {rooms.length > 0 ? (
              rooms.slice(0, 3).map(room => (
                <button className="search-link-row" key={room.id} onClick={() => openCommunity('reading_room', room.id)}>
                  <span>{room.title}</span>
                  <small>{room.topic || room.exam_goal || 'Active room'} · {room.participant_count || 0} active</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>Open a room and study this topic together.</span>
                <button className="search-link-btn" onClick={() => goCommunity('reading_room')}>Start reading room</button>
              </div>
            )}
          </section>
            </div>
          </section>

        </aside>
      </div>
    </div>
  );
}
