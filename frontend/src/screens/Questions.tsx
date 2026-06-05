import { useState } from 'react';
import type { ScreenType } from '../types';
import { saveStudyPack } from '../offline';

const questionBank = [
  {
    year: '2023',
    topic: 'Sorting',
    difficulty: 'Hard',
    text: 'Explain the time complexity of QuickSort in the best, average and worst cases. Give a practical example of when QuickSort degrades to O(n^2) and how this can be mitigated.',
    appearances: 9,
  },
  {
    year: '2022',
    topic: 'Trees',
    difficulty: 'Medium',
    text: 'With the aid of a diagram, describe the process by which a node is deleted from a Binary Search Tree. Consider all three cases: leaf node, one child, and two children.',
    appearances: 7,
  },
  {
    year: '2021',
    topic: 'Graphs',
    difficulty: 'Hard',
    text: "Compare and contrast Dijkstra's algorithm and the Bellman-Ford algorithm for shortest path computation. Under what conditions would you prefer one over the other?",
    appearances: 6,
  },
  {
    year: '2023',
    topic: 'Hashing',
    difficulty: 'Easy',
    text: 'Define hashing. With examples, explain any three collision resolution strategies used in hash tables.',
    appearances: 5,
  },
];

export default function Questions({ go }: { go: (s: ScreenType) => void }) {
  const [filter, setFilter] = useState('');
  const [offlineMessage, setOfflineMessage] = useState('');

  const filterTopic = (topic: string) => {
    setFilter((current) => current === topic ? '' : topic);
    setOfflineMessage('');
  };

  const saveOfflinePack = async () => {
    const questions = filter ? questionBank.filter((question) => question.topic === filter) : questionBank;
    await saveStudyPack({
      id: `csc301-${filter || 'all'}-${Date.now()}`,
      courseCode: 'CSC 301',
      title: filter ? `CSC 301 ${filter} pack` : 'CSC 301 past-question pack',
      savedAt: new Date().toISOString(),
      questions,
    });
    setOfflineMessage(`${questions.length} questions saved for offline study.`);
    window.dispatchEvent(new Event('exammind-offline-updated'));
  };

  const visibleQuestions = filter ? questionBank.filter((question) => question.topic === filter) : questionBank;

  return (
    <div className="page" id="s-questions">
      <div className="pg-head">
        <div className="pg-title">Past <em>Questions</em></div>
        <div className="pg-sub">847 questions · 12 courses · click a topic to filter instantly</div>
      </div>

      <div className="heatmap-hero">
        <div className="heatmap-hero-hd">
          <div className="card-ttl">Topic frequency map - click to filter</div>
          <div className="card-lnk" onClick={() => go('analytics')}>Full analytics →</div>
        </div>
        <div className="heatmap-grid">
          {[
            ['Sorting', '43', 'v5'],
            ['Graphs', '38', 'v5'],
            ['Trees', '31', 'v4'],
            ['Hashing', '27', 'v4'],
            ['Recursion', '22', 'v3'],
            ['Dynamic Prog.', '19', 'v3'],
            ['Queues', '14', 'v2'],
            ['Stacks', '11', 'v2'],
          ].map(([topic, count, intensity]) => (
            <div className={`hm ${intensity}`} style={filter === topic ? {outline: '2px solid var(--gold)'} : {}} onClick={() => filterTopic(topic)} key={topic}>
              <div className="hm-name">{topic}</div>
              <div className="hm-count">{count}</div>
              <div className="hm-sub">questions</div>
            </div>
          ))}
        </div>
      </div>

      <div className="pills">
        <div className="pill on">All courses</div>
        <div className="pill">CSC 301 - DSA</div>
        <div className="pill">CSC 205 - OOP</div>
        <div className="pill">CSC 312 - OS</div>
        <div className="pill">CSC 401 - Networks</div>
      </div>

      {filter && <div style={{fontSize: 12, color: 'var(--gold)', marginBottom: 12}}>Showing: {filter} questions - click topic again to clear</div>}

      <div className="offline-actions">
        <button className="cta cta-ghost" onClick={saveOfflinePack}>Save current pack offline</button>
        {offlineMessage && <span>{offlineMessage}</span>}
      </div>

      {visibleQuestions.map((question) => (
        <div className="qd" onClick={() => go('assistant')} key={`${question.year}-${question.topic}`}>
          <div className="qd-text">{question.text}</div>
          <div className="qd-meta">
            <span className={`tag ${question.difficulty === 'Hard' ? 'tag-h' : question.difficulty === 'Medium' ? 'tag-m' : 'tag-e'}`}>{question.difficulty}</span>
            <div className="qi-yr">{question.year}</div>
            <span className="qi-course" style={{fontSize: 12, color: 'var(--text3)'}}>CSC 301 · {question.appearances} appearances</span>
            <button className="ask-ai-btn">Ask AI →</button>
          </div>
        </div>
      ))}
    </div>
  );
}
