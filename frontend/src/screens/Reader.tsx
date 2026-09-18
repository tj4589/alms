import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScreenType } from '../types';
import { apiDownload, apiGet, apiPost } from '../lib/api';
import MaxeMark from '../components/Maxe/MaxeMark';
import './Reader.css';

type ReaderProps = {
  go: (s: ScreenType, arg?: string | number | null) => void;
  noteId: number | null;
};

type NoteSection = {
  id: number;
  index: number;
  heading: string | null;
  body: string;
  page_from: number | null;
  page_to: number | null;
  cut_by: string;
};

type Note = {
  id: number;
  title: string;
  topic: string | null;
  course_id: number | null;
  course_code: string | null;
  course_name: string | null;
  uploaded_by_username: string | null;
  has_file: boolean;
  file_name: string | null;
  file_size: number | null;
  sections: NoteSection[];
  content_text?: string | null;
};

type Turn = {
  id: number;
  question: string;
  context: string | null;
  answer: string | null;
  sources: string[];
  failed?: boolean;
};

/** What Maxe is being asked about. Null means the note as a whole. */
type AskContext = { label: string; text: string } | null;

const MAX_PASSAGE_CHARS = 2000;

function sectionLabel(section: NoteSection): string {
  if (section.heading) return section.heading;
  // Only claim a page number when the split actually followed pages.
  if (section.cut_by === 'page' && section.page_from) {
    return section.page_to && section.page_to !== section.page_from
      ? `Pages ${section.page_from}-${section.page_to}`
      : `Page ${section.page_from}`;
  }
  return `Part ${section.index + 1}`;
}

function readableSize(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Paragraphs, so a wall of extracted text reads as prose. */
function paragraphsOf(body: string): string[] {
  return body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

export default function Reader({ go, noteId }: ReaderProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  const [context, setContext] = useState<AskContext>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);

  const [downloadState, setDownloadState] = useState<'idle' | 'working' | 'failed'>('idle');
  const [downloadNote, setDownloadNote] = useState('');

  // Where a selection popover should sit, in page coordinates.
  const [selection, setSelection] = useState<{ x: number; y: number; text: string } | null>(null);

  const articleRef = useRef<HTMLDivElement | null>(null);
  const askBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const popoverRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (noteId === null) return;
    let cancelled = false;
    apiGet(`/materials/lecture-notes/${noteId}`)
      .then((data) => {
        if (cancelled) return;
        setNote(data as Note);
        setFailed(false);
        setLoadedFor(noteId);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoadedFor(noteId);
      });
    return () => { cancelled = true; };
  }, [noteId]);

  const state: 'loading' | 'ready' | 'error' | 'none' =
    noteId === null ? 'none'
      : loadedFor !== noteId ? 'loading'
        : failed ? 'error'
          : note ? 'ready' : 'loading';

  const sections = useMemo(() => note?.sections ?? [], [note]);

  // Notes filed before sections existed still have their text; show it whole
  // rather than an empty page.
  const fallbackBody = note && sections.length === 0 ? (note.content_text || '') : '';

  const sourceName = note
    ? [note.course_code, note.title].filter(Boolean).join(' - ')
    : '';

  /** A selection inside the article offers to carry itself to Maxe. */
  const onSelectionChange = useCallback(() => {
    const active = window.getSelection();
    const text = active?.toString().trim() ?? '';
    if (!active || active.isCollapsed || text.length < 3) {
      setSelection(null);
      return;
    }
    const anchor = active.anchorNode;
    if (!anchor || !articleRef.current?.contains(anchor)) {
      setSelection(null);
      return;
    }
    const rect = active.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setSelection(null);
      return;
    }
    setSelection({
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.top + window.scrollY,
      text,
    });
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [onSelectionChange]);

  // The popover is placed from its measured size rather than by a CSS
  // transform, so it lands above the selection and stays on screen even when
  // the highlight runs to the edge of the column. Layout effect, so the
  // correction happens before paint and nothing is seen to jump.
  useLayoutEffect(() => {
    const element = popoverRef.current;
    if (!element || !selection) return;
    const box = element.getBoundingClientRect();
    const margin = 8;
    const widest = document.documentElement.clientWidth - box.width - margin;
    element.style.left = `${Math.max(margin, Math.min(selection.x - box.width / 2, widest))}px`;
    element.style.top = `${selection.y - box.height - 10}px`;
  }, [selection]);

  const askAbout = useCallback((label: string, text: string) => {
    setContext({ label, text: text.slice(0, MAX_PASSAGE_CHARS) });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    window.requestAnimationFrame(() => askBoxRef.current?.focus());
  }, []);

  const submit = useCallback(async () => {
    const asked = question.trim();
    if (!asked || asking || !note) return;
    const id = Date.now();
    setTurns((current) => [
      ...current,
      { id, question: asked, context: context?.label ?? null, answer: null, sources: [] },
    ]);
    setQuestion('');
    setAsking(true);
    try {
      const data = await apiPost('/rag/ask', {
        question: asked,
        course_id: note.course_id,
        passage: context?.text ?? null,
        passage_source: context ? `${sourceName}, ${context.label}` : sourceName || null,
      }) as { answer: string; sources?: string[] };
      setTurns((current) => current.map((turn) => turn.id === id
        ? { ...turn, answer: data.answer, sources: data.sources ?? [] }
        : turn));
    } catch {
      setTurns((current) => current.map((turn) => turn.id === id
        ? { ...turn, answer: 'Maxe could not answer that just now. The connection may be down.', failed: true }
        : turn));
    } finally {
      setAsking(false);
    }
  }, [question, asking, note, context, sourceName]);

  const download = useCallback(async () => {
    if (!note || !note.has_file) return;
    setDownloadState('working');
    setDownloadNote('');
    try {
      const filename = await apiDownload(
        `/materials/lecture-notes/${note.id}/download`,
        note.file_name || `${note.title}.pdf`,
      );
      setDownloadState('idle');
      setDownloadNote(`Saved ${filename}`);
    } catch (error) {
      setDownloadState('failed');
      setDownloadNote(error instanceof Error ? error.message : 'That file could not be downloaded.');
    }
  }, [note]);

  return (
    <div className="page" id="s-reader">
      <button type="button" className="rd-back" onClick={() => go('dashboard')}>
        &larr; Back to my desk
      </button>

      {state === 'none' && <p className="rd-state">No material chosen. Open one from your desk.</p>}
      {state === 'loading' && <p className="rd-state">Opening...</p>}
      {state === 'error' && (
        <p className="rd-state rd-state-error" role="alert">
          That material could not be opened. It may have been removed, or the connection dropped.
        </p>
      )}

      {state === 'ready' && note && (
        <>
          <header className="rd-head">
            <p className="rd-kicker">
              {note.course_code ? <span className="rd-course">{note.course_code}</span> : null}
              {note.uploaded_by_username && (
                <button
                  type="button"
                  className="rd-filer"
                  onClick={() => go('profile', note.uploaded_by_username)}
                >
                  filed by @{note.uploaded_by_username}
                </button>
              )}
            </p>
            <h1 className="rd-title">{note.title}</h1>
            <div className="rd-actions">
              {note.has_file ? (
                <button type="button" className="rd-download" onClick={() => void download()} disabled={downloadState === 'working'}>
                  {downloadState === 'working' ? 'Preparing...' : 'Download original'}
                  {readableSize(note.file_size) && downloadState !== 'working' && (
                    <span className="rd-filesize">{readableSize(note.file_size)}</span>
                  )}
                </button>
              ) : (
                <span className="rd-nofile">
                  Filed before originals were kept, so only the text is here.
                </span>
              )}
              {downloadNote && (
                <span className={`rd-downloadnote${downloadState === 'failed' ? ' is-failed' : ''}`} role="status">
                  {downloadNote}
                </span>
              )}
            </div>
          </header>

          <div className="rd-layout">
            <article className="rd-article" ref={articleRef}>
              {sections.map((section) => (
                <section className="rd-section" id={`sec-${section.id}`} key={section.id}>
                  <div className="rd-section-head">
                    <h2 className="rd-section-title">{sectionLabel(section)}</h2>
                    <button
                      type="button"
                      className="rd-ask-section"
                      onClick={() => askAbout(sectionLabel(section), section.body)}
                    >
                      Ask Maxe about this
                    </button>
                  </div>
                  {paragraphsOf(section.body).map((para, position) => (
                    <p className="rd-para" key={position}>{para}</p>
                  ))}
                </section>
              ))}

              {fallbackBody && (
                <section className="rd-section">
                  <div className="rd-section-head">
                    <h2 className="rd-section-title">Full text</h2>
                    <button
                      type="button"
                      className="rd-ask-section"
                      onClick={() => askAbout('this note', fallbackBody)}
                    >
                      Ask Maxe about this
                    </button>
                  </div>
                  {paragraphsOf(fallbackBody).map((para, position) => (
                    <p className="rd-para" key={position}>{para}</p>
                  ))}
                </section>
              )}

              {sections.length === 0 && !fallbackBody && (
                <p className="rd-state">
                  No readable text was kept for this material. The original file is still
                  here if it was stored.
                </p>
              )}
            </article>

            <aside className="rd-aside">
              {sections.length > 1 && (
                <nav className="rd-contents" aria-label="Sections">
                  <p className="rd-aside-label">Contents</p>
                  <ol>
                    {sections.map((section) => (
                      <li key={section.id}>
                        <a href={`#sec-${section.id}`}>{sectionLabel(section)}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}

              <div className="rd-maxe">
                <div className="rd-maxe-head">
                  <span className="rd-maxe-mark" aria-hidden="true"><MaxeMark /></span>
                  <div>
                    <p className="rd-aside-label">Maxe</p>
                    <p className="rd-maxe-sub">Reads with you, from the archive</p>
                  </div>
                </div>

                <div className="rd-context" aria-live="polite">
                  {context ? (
                    <>
                      <span className="rd-context-label">Asking about {context.label}</span>
                      <button type="button" className="rd-context-clear" onClick={() => setContext(null)}>
                        Use whole note
                      </button>
                      <p className="rd-context-quote">{context.text.slice(0, 160)}{context.text.length > 160 ? '...' : ''}</p>
                    </>
                  ) : (
                    <span className="rd-context-label is-quiet">Asking about the whole note</span>
                  )}
                </div>

                <ul className="rd-turns">
                  {turns.map((turn) => (
                    <li className="rd-turn" key={turn.id}>
                      <p className="rd-turn-q">
                        {turn.question}
                        {turn.context && <span className="rd-turn-ctx">on {turn.context}</span>}
                      </p>
                      {turn.answer === null ? (
                        <p className="rd-turn-a is-waiting">Maxe is reading...</p>
                      ) : (
                        <p className={`rd-turn-a${turn.failed ? ' is-failed' : ''}`}>{turn.answer}</p>
                      )}
                      {turn.sources.length > 0 && (
                        <p className="rd-turn-src">From {turn.sources.slice(0, 3).join(', ')}</p>
                      )}
                    </li>
                  ))}
                  {turns.length === 0 && (
                    <li className="rd-turn-empty">
                      Highlight anything in the note, or pick a section, and ask.
                      Answers are grounded in what the archive holds.
                    </li>
                  )}
                </ul>

                <form
                  className="rd-askform"
                  onSubmit={(event) => { event.preventDefault(); void submit(); }}
                >
                  <label className="sr-only" htmlFor="rd-ask">Ask Maxe about this material</label>
                  <textarea
                    id="rd-ask"
                    ref={askBoxRef}
                    className="rd-askbox"
                    rows={3}
                    value={question}
                    placeholder={context ? `Ask about ${context.label}...` : 'Ask about this note...'}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void submit();
                      }
                    }}
                  />
                  <button type="submit" className="rd-asksend" disabled={!question.trim() || asking}>
                    {asking ? 'Asking...' : 'Ask Maxe'}
                  </button>
                </form>
              </div>
            </aside>
          </div>

          {selection && (
            <button
              type="button"
              className="rd-selection-ask"
              ref={popoverRef}
              style={{ left: selection.x, top: selection.y }}
              onClick={() => askAbout('the highlighted passage', selection.text)}
            >
              Ask Maxe about this
            </button>
          )}
        </>
      )}
    </div>
  );
}
