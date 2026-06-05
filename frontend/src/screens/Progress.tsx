import type { ScreenType } from '../types';

export default function Progress({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-progress">
      <div className="pg-head">
        <div className="pg-title">My <em>Progress</em></div>
        <div className="pg-sub">Personalized learning journey and performance metrics.</div>
      </div>

      <div className="ana-stats">
        <div className="ana-card">
          <div className="ana-num">84%</div>
          <div className="ana-lbl">Overall Mastery</div>
          <div className="ana-delta up">+4% this month</div>
        </div>
        <div className="ana-card">
          <div className="ana-num">12</div>
          <div className="ana-lbl">Study Streak (Days)</div>
          <div className="ana-delta up">New personal record!</div>
        </div>
        <div className="ana-card">
          <div className="ana-num">142</div>
          <div className="ana-lbl">Concept Badges</div>
          <div className="ana-delta up">+3 recently</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Topic Breakdown</div>
          </div>
          <div className="prog-list">
            {[
              { name: 'Data Structures', pct: 92, color: 'var(--teal)' },
              { name: 'Algorithms', pct: 78, color: 'var(--gold)' },
              { name: 'Operating Systems', pct: 64, color: 'var(--purple)' },
              { name: 'Database Systems', pct: 88, color: 'var(--teal)' },
              { name: 'Computer Networks', pct: 52, color: 'var(--coral)' },
            ].map((topic, i) => (
              <div key={i} className="prog-item">
                <div className="prog-top">
                  <span className="prog-nm">{topic.name}</span>
                  <span className="prog-pct">{topic.pct}%</span>
                </div>
                <div className="prog-track">
                  <div className="prog-fill" style={{ width: `${topic.pct}%`, background: topic.color }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Weekly Activity</div>
          </div>
          <div className="bar-chart">
            {[40, 65, 30, 85, 55, 95, 70].map((h, i) => (
              <div key={i} className="bc-col">
                <div className="bc-bar" style={{ height: `${h}%` }}></div>
                <div className="bc-lbl">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text2)' }}>
            You're most productive on <strong>Thursdays</strong> and <strong>Saturdays</strong>. Keep it up!
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div className="card-ttl">Upcoming Goals</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="qd" style={{ cursor: 'default' }}>
            <div className="qd-text" style={{ marginBottom: 0 }}>Complete 5 practice tests on <em>Graph Theory</em> before Friday.</div>
            <div className="qd-meta" style={{ marginTop: 8 }}>
              <span className="tag tag-m">Priority: High</span>
              <span style={{ fontSize: 11, color: 'var(--text3)', cursor: 'pointer' }} onClick={() => go('practice')}>Progress: 2/5</span>
            </div>
          </div>
          <div className="qd" style={{ cursor: 'default' }}>
            <div className="qd-text" style={{ marginBottom: 0 }}>Review 2022 Operating Systems past questions.</div>
            <div className="qd-meta" style={{ marginTop: 8 }}>
              <span className="tag tag-e">Priority: Medium</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Progress: 0/1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
