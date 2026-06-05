import { useState } from 'react';

const mockQuestions = [
  { id: 1, year: '2023', topic: 'Data Structures', difficulty: 'Hard', text: 'Explain the time complexity of QuickSort in the worst case with examples.' },
  { id: 2, year: '2022', topic: 'Algorithms', difficulty: 'Medium', text: 'Describe Dijkstra\'s algorithm and its limitations.' },
  { id: 3, year: '2021', topic: 'Data Structures', difficulty: 'Easy', text: 'What is a binary search tree?' }
];

export const PastQuestions = () => {
  const [filter, setFilter] = useState('All');

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ color: 'var(--accent-primary)', margin: 0 }}>Past Exam Questions</h2>
        <select 
          value={filter} 
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            background: 'var(--surface-color)',
            color: 'var(--text-primary)'
          }}>
          <option>All</option>
          <option>Data Structures</option>
          <option>Algorithms</option>
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {mockQuestions.map(q => (
          <div key={q.id} style={{ 
            padding: '1.5rem', 
            borderRadius: 'var(--radius-md)', 
            border: '1px solid var(--border-color)',
            background: 'var(--bg-color)',
            transition: 'transform var(--transition-fast)'
          }}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{q.year}</span>
              <span style={{ color: 'var(--text-secondary)' }}>•</span>
              <span style={{ color: 'var(--text-secondary)' }}>{q.topic}</span>
              <span style={{ color: 'var(--text-secondary)' }}>•</span>
              <span style={{ 
                color: q.difficulty === 'Hard' ? '#ef4444' : q.difficulty === 'Medium' ? '#f59e0b' : '#10b981',
                padding: '0.2rem 0.5rem',
                borderRadius: '0.25rem',
                background: 'var(--surface-color)',
                fontSize: '0.8rem'
              }}>{q.difficulty}</span>
            </div>
            <p style={{ margin: 0, fontSize: '1.1rem', lineHeight: 1.6 }}>{q.text}</p>
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
              <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>View AI Solution</button>
              <button className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', borderColor: 'transparent' }}>Discuss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
