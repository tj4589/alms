import { useState } from 'react';
import type { GlobalSearchResult, PastQuestion, ScreenType, SearchActionContext, SearchCommunityKind } from '../types';
import { saveStudyPack } from '../offline';

function preview(value: string | null | undefined, fallback: string, max = 132): string {
  const text = (value || fallback).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function noteSummary(topic: string): string {
  return `No uploaded materials match this yet. ${topic} may depend on the course context, so uploaded notes or past questions will make future results more precise.`;
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

  if (error) {
    return <div className="search-page">
      <h1 className="search-page-title">Search could not be completed</h1>
      <p role="alert">{error}</p>
      {onRetry && <button type="button" className="search-primary-btn" onClick={onRetry}>Retry search</button>}
    </div>;
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
                : noteSummary(topic)}
            </p>
            {relatedTerms.length > 0 && (
              <div className="search-muted">Also considered: {relatedTerms.slice(0, 4).join(', ')}</div>
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
                    <button type="button" className="search-link-btn" onClick={() => onOpenResource('lecture_note', note.id)} aria-label={`Open ${note.title}`}>Open</button>
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
            <div className="search-card-head">
              <div className="search-card-title">Past Questions</div>
              {pastQuestions.length > 0 && <button type="button" className="search-link-btn" onClick={() => void saveQuestionsOffline()} disabled={offlineState === 'saving' || offlineState === 'saved'}>{offlineState === 'saving' ? 'Saving…' : offlineState === 'saved' ? 'Saved offline' : 'Save offline'}</button>}
            </div>
            {offlineState === 'saved' && <p className="search-muted" role="status">Saved for offline study.</p>}
            {offlineState === 'error' && <p className="search-muted" role="alert">This study pack could not be saved on this device. Try again.</p>}
            {pastQuestions.length > 0 ? (
              <div className="search-result-list">
                {pastQuestions.slice(0, 6).map(item => {
                  const meta = item.metadata_json as { course_code?: string; topics_covered?: string[] } | null;
                  return (
                    <div className="search-result-row" key={item.id}>
                      <div>
                        <div className="search-result-title">{materialTitle(item)}</div>
                        {(item.snippets || []).slice(0, 3).map(snippet => (
                          <div className="search-muted" key={snippet}>{preview(snippet, '', 160)}</div>
                        ))}
                        <div className="search-muted">
                          {meta?.course_code ? `${meta.course_code} · ` : ''}{materialMetaLine(item)}
                          {meta?.topics_covered?.[0] ? ` · ${meta.topics_covered[0]}` : ''}
                        </div>
                      </div>
                      <button type="button" className="search-link-btn" onClick={() => onOpenResource('past_question', item.id)} aria-label={`Open ${materialTitle(item)}`}>Open</button>
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
              <span>No practice quiz has been created from this search yet.</span>
              <button className="search-link-btn" onClick={() => onPractice(topic, primaryContext)}>Create practice quiz</button>
            </div>
          </section>
        </div>

        <aside className="search-side">
          <section className="search-card">
            <div className="search-card-title">Quick Actions</div>
            <div className="search-action-grid">
              <button className="search-primary-btn" onClick={() => onAskAI(groundedAiPrompt)}>Ask Maxe about this</button>
              <button className="search-action-btn" onClick={() => onPractice(topic, primaryContext)}>Create practice quiz</button>
              <button className="search-action-btn" onClick={onUpload}>Upload material</button>
              <button className="search-action-btn" onClick={() => goCommunity('discussion')}>Start discussion thread</button>
            </div>
          </section>

          <section className="search-card">
            <div className="search-card-title">Related Topics</div>
            {relatedTopics.length > 0 ? (
              <div className="search-related-list">
                {relatedTopics.slice(0, 10).map(item => <span key={item}>{item}</span>)}
              </div>
            ) : (
              <div className="search-empty-row">No related topics found yet.</div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Discussions</div>
            {threads.length > 0 ? (
              threads.slice(0, 3).map(thread => (
                <button className="search-link-row" key={thread.id} onClick={() => openCommunity('discussion', thread.id)}>
                  <span>{thread.title}</span>
                  <small>{thread.created_by_username ? `@${thread.created_by_username}` : 'Discussion'}</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>No discussions yet.</span>
                <button className="search-link-btn" onClick={() => goCommunity('discussion')}>Start one</button>
              </div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Study Groups</div>
            {groups.length > 0 ? (
              groups.slice(0, 3).map(group => (
                <button className="search-link-row" key={group.id} onClick={() => openCommunity('study_group', group.id)}>
                  <span>{group.name}</span>
                  <small>{group.topic || 'Study group'} · {group.member_count || 0} members</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>No groups yet.</span>
                <button className="search-link-btn" onClick={() => goCommunity('study_group')}>Create one</button>
              </div>
            )}
          </section>

          <section className="search-card">
            <div className="search-card-title">Reading Rooms</div>
            {rooms.length > 0 ? (
              rooms.slice(0, 3).map(room => (
                <button className="search-link-row" key={room.id} onClick={() => openCommunity('reading_room', room.id)}>
                  <span>{room.title}</span>
                  <small>{room.topic || room.exam_goal || 'Active room'} · {room.participant_count || 0} active</small>
                </button>
              ))
            ) : (
              <div className="search-empty-row">
                <span>No active rooms yet.</span>
                <button className="search-link-btn" onClick={() => goCommunity('reading_room')}>Start reading room</button>
              </div>
            )}
          </section>

        </aside>
      </div>
    </div>
  );
}
