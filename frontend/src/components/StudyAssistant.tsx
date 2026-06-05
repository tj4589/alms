import React, { useState } from 'react';

export const StudyAssistant = () => {
  const [query, setQuery] = useState('');
  const [chat, setChat] = useState<{role: 'user'|'ai', text: string}[]>([
    { role: 'ai', text: 'Hello! I am your AI tutor. Ask me any question, and I will answer based on past exam patterns.' }
  ]);

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setChat([...chat, { role: 'user', text: query }, { role: 'ai', text: "Thinking... (This would connect to our FastAPI RAG endpoint via POST /rag/ask)" }]);
    setQuery('');
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '600px', padding: '1.5rem' }}>
      <h2 style={{ marginBottom: '1rem', color: 'var(--accent-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        AI Study Assistant
      </h2>
      
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
        {chat.map((msg, idx) => (
          <div key={idx} style={{ 
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            backgroundColor: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--surface-color)',
            color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
            padding: '1rem',
            borderRadius: 'var(--radius-lg)',
            borderBottomRightRadius: msg.role === 'user' ? 0 : 'var(--radius-lg)',
            borderBottomLeftRadius: msg.role === 'ai' ? 0 : 'var(--radius-lg)',
            maxWidth: '80%',
            boxShadow: 'var(--shadow-sm)',
            border: msg.role === 'ai' ? '1px solid var(--border-color)' : 'none'
          }}>
            {msg.text}
          </div>
        ))}
      </div>

      <form onSubmit={handleAsk} style={{ display: 'flex', gap: '0.5rem' }}>
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question..."
          style={{
            flex: 1,
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            background: 'var(--surface-color)',
            color: 'var(--text-primary)'
          }}
        />
        <button type="submit" className="btn-primary" style={{ padding: '0 2rem' }}>Send</button>
      </form>
    </div>
  );
};
