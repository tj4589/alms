import { useState } from 'react';

export const PracticeTest = () => {
  const [topic, setTopic] = useState('Data Structures');
  const [isGenerating, setIsGenerating] = useState(false);
  const [test, setTest] = useState<any>(null);

  const generateTest = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setTest([
        { id: 1, text: 'Compare and contrast BFS and DFS with respect to memory usage.', type: 'essay', marks: 10 },
        { id: 2, text: 'Given a binary tree, write an algorithm to find the lowest common ancestor of two nodes.', type: 'code', marks: 15 }
      ]);
      setIsGenerating(false);
    }, 1500);
  };

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h2 style={{ color: 'var(--accent-primary)', marginBottom: '1.5rem' }}>Practice Test Generator</h2>
      
      {!test ? (
        <div style={{ maxWidth: '500px' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Generate a custom practice paper modelled after real past exams.
          </p>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Select Topic</label>
            <select 
              value={topic} 
              onChange={e => setTopic(e.target.value)}
              style={{ padding: '0.75rem', width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
            >
              <option>Data Structures</option>
              <option>Algorithms</option>
              <option>Operating Systems</option>
            </select>
          </div>
          <button className="btn-primary" onClick={generateTest} disabled={isGenerating}>
            {isGenerating ? 'Analyzing Past Exams...' : 'Generate New Test'}
          </button>
        </div>
      ) : (
        <div className="animate-fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
            <h3 style={{ margin: 0 }}>Generated Practice Paper: {topic}</h3>
            <span style={{ background: 'var(--surface-color)', padding: '0.3rem 0.8rem', borderRadius: 'var(--radius-md)', fontSize: '0.9rem' }}>Time: 45 mins</span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {test.map((q: any, i: number) => (
              <div key={q.id}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', marginBottom: '1rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>Q{i+1}.</span>
                  <div style={{ flex: 1 }}>{q.text}</div>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>[{q.marks} marks]</span>
                </div>
                <textarea 
                  placeholder="Draft your answer here..."
                  style={{ width: '100%', minHeight: '120px', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>
            ))}
          </div>
          
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button className="btn-secondary" onClick={() => setTest(null)}>Discard</button>
            <button className="btn-primary">Submit for AI Grading</button>
          </div>
        </div>
      )}
    </div>
  );
};
