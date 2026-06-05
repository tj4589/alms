import { useState } from 'react';
import { StudyAssistant } from './StudyAssistant';
import { PastQuestions } from './PastQuestions';
import { Analytics } from './Analytics';
import { PracticeTest } from './PracticeTest';

export const Dashboard = ({ onLogout }: { onLogout: () => void }) => {
  const [activeTab, setActiveTab] = useState<'home'|'assistant'|'browser'|'analytics'|'practice'>('home');

  const renderContent = () => {
    switch(activeTab) {
      case 'assistant': return <StudyAssistant />;
      case 'browser': return <PastQuestions />;
      case 'analytics': return <Analytics />;
      case 'practice': return <PracticeTest />;
      default:
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Study Assistant</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Ask questions to the AI trained on past exams.</p>
              <button className="btn-primary" style={{ width: '100%' }} onClick={() => setActiveTab('assistant')}>Open Chat</button>
            </div>

            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Past Questions</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Browse and filter historical exam questions.</p>
              <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setActiveTab('browser')}>Browse Exams</button>
            </div>
            
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Practice Tests</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Generate AI practice tests from historical data.</p>
              <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setActiveTab('practice')}>Generate Test</button>
            </div>

            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Analytics</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>View your progress and master topic heatmaps.</p>
              <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setActiveTab('analytics')}>View Dashboard</button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="container animate-fade-in" style={{ padding: '2rem 1.5rem', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <h1 
          style={{ color: 'var(--accent-primary)', fontSize: '1.5rem', margin: 0, cursor: 'pointer' }}
          onClick={() => setActiveTab('home')}
        >
          AI-LMS Platform
        </h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="btn-secondary" onClick={onLogout} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>Logout</button>
        </div>
      </header>

      {renderContent()}
    </div>
  );
};
