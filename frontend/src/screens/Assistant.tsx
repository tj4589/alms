import { useMemo, useState } from 'react';
import type { ScreenType } from '../types';
import { apiPost } from '../lib/api';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  sources?: string[];
  noPastQuestionsFound?: boolean;
  noLectureNotesFound?: boolean;
};

type AskResponse = {
  answer: string;
  sources: string[];
  past_question_sources: string[];
  lecture_note_sources: string[];
  no_past_questions_found: boolean;
  no_lecture_notes_found: boolean;
};

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: "Ask me anything about your uploaded past questions and lecture notes. I will answer from the knowledge base, cite sources when available, and tell you clearly when something is missing.",
  },
];

function friendlyError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'The assistant could not answer right now.';
  }

  const message = error.message;
  const lowered = message.toLowerCase();
  if (lowered.includes('not authenticated') || lowered.includes('401') || lowered.includes('could not validate credentials')) {
    return 'Your session is not authenticated. Please log out, sign in again, and retry your question.';
  }
  if (lowered.includes('ai models not configured') || lowered.includes('openai') || lowered.includes('api key')) {
    return 'AI is not configured yet. Set OPENAI_API_KEY on the backend, restart FastAPI, and try again.';
  }
  return message;
}

export default function Assistant({ go }: { go: (s: ScreenType) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages],
  );

  const sendQuestion = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError('');
    setLoading(true);

    const requestBody = { question };

    try {
      const data = await apiPost('/rag/ask', requestBody) as AskResponse;
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        sources: data.sources || [],
        noPastQuestionsFound: data.no_past_questions_found,
        noLectureNotesFound: data.no_lecture_notes_found,
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (err) {
      const message = friendlyError(err);
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: message,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendQuestion();
    }
  };

  return (
    <div className="page" id="s-assistant">
      <div className="pg-head">
        <div className="pg-title">AI <em>Assistant</em></div>
        <div className="pg-sub">Every answer is grounded in your past questions and lecture notes, not the internet</div>
      </div>
      <div className="ai-layout">
        <div className="ai-panel">
          <div className="ai-hd">
            <div className="ai-dot"></div>
            <div className="ai-hd-title">ExamMind AI</div>
            <div className="ai-hd-sub">{loading ? 'Searching knowledge base...' : 'Ready for grounded questions'}</div>
          </div>

          <div className="ai-msgs">
            {messages.map((message) => (
              <div className={`msg ${message.role === 'user' ? 'usr' : ''}`} key={message.id}>
                <div className={`msg-ava ${message.role === 'user' ? 'usr' : 'ai'}`}>{message.role === 'user' ? 'You' : 'AI'}</div>
                <div className={`bubble ${message.role === 'user' ? 'usr' : 'ai'}`}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                  {message.sources && message.sources.length > 0 && (
                    <div className="pq-ref-row">
                      {message.sources.map((source) => (
                        <div className="pq-ref" key={source}>
                          <div className="pq-ref-yr">Source</div>
                          <div className="pq-ref-q">{source}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="msg">
                <div className="msg-ava ai">AI</div>
                <div className="bubble ai">Searching uploaded past questions and lecture notes...</div>
              </div>
            )}
          </div>

          {error && <div className="upload-alert" style={{ margin: '0 20px 12px' }}>{error}</div>}

          <div className="ai-foot">
            <input
              className="ai-inp"
              type="text"
              placeholder="Ask about a topic, past question, or request practice..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button className="send" onClick={sendQuestion} disabled={loading || !input.trim()}>
              {loading ? '...' : '>'}
            </button>
          </div>
        </div>

        <div className="related-panel">
          {latestAssistant?.noLectureNotesFound && (
            <div className="note-absent">
              <div className="note-absent-lbl">No lecture notes found</div>
              <div className="note-absent-msg">The assistant did not find lecture notes for this question. Uploading notes will help future answers become more complete.</div>
              <div className="upload-prompt" onClick={() => go('upload')}>+ Upload lecture notes</div>
            </div>
          )}

          {latestAssistant?.noPastQuestionsFound && (
            <div className="note-absent">
              <div className="note-absent-lbl">No past questions found</div>
              <div className="note-absent-msg">This topic has not appeared in the uploaded past questions yet, or no matching paper has been indexed.</div>
              <div className="upload-prompt" onClick={() => go('upload')}>+ Upload past question</div>
            </div>
          )}

          <div className="card">
            <div className="card-hd"><div className="card-ttl">Sources</div></div>
            {latestAssistant?.sources && latestAssistant.sources.length > 0 ? (
              <div className="prog-list">
                {latestAssistant.sources.map((source) => (
                  <div className="qi" key={source}>
                    <div className="qi-body">
                      <div className="qi-title">{source}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="note-absent-msg">Sources will appear here after the assistant finds matching uploaded material.</div>
            )}
            <div style={{marginTop: 12}}>
              <button className="cta cta-ghost" style={{width: '100%', justifyContent: 'center', fontSize: 12}} disabled>
                View related questions
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
