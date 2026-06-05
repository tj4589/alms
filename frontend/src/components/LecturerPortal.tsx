export const LecturerPortal = () => {
  return (
    <div className="page" id="s-lecturer">
      <div className="pg-head">
        <div className="pg-title">Lecturer <em>Analytics</em></div>
        <div className="pg-sub">Overview of your students' performance and engagement across modules.</div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--teal)' }}></div>
          <div className="stat-lbl">Active Students</div>
          <div className="stat-val">248</div>
          <div className="stat-delta">+12 this week</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--gold)' }}></div>
          <div className="stat-lbl">Avg. Practice Score</div>
          <div className="stat-val">68%</div>
          <div className="stat-delta" style={{ color: 'var(--coral)' }}>-2% from last week</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--purple)' }}></div>
          <div className="stat-lbl">Questions Attempted</div>
          <div className="stat-val">3,492</div>
          <div className="stat-delta">Top topic: SDLC</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{ background: 'var(--teal)' }}></div>
          <div className="stat-lbl">Notes Uploaded</div>
          <div className="stat-val">42</div>
          <div className="stat-delta">+5 recent uploads</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Students at Risk (Low Engagement)</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { name: 'Michael Osei', course: 'CSC 204', score: '42%', lastActive: '5 days ago' },
              { name: 'Sarah Mensah', course: 'CSC 204', score: '38%', lastActive: '1 week ago' },
              { name: 'David Okafor', course: 'CSC 204', score: '45%', lastActive: '3 days ago' },
            ].map((student, i) => (
              <div key={i} className="qi" style={{ alignItems: 'center' }}>
                <div className="ava" style={{ width: 28, height: 28, fontSize: 10 }}>{student.name.split(' ').map(n=>n[0]).join('')}</div>
                <div className="qi-body">
                  <div className="qi-title" style={{ margin: 0 }}>{student.name}</div>
                  <div className="qi-meta" style={{ marginTop: 2 }}>
                    <span className="qi-course">{student.course}</span>
                    <span style={{ color: 'var(--text3)', fontSize: 10 }}>· Last active: {student.lastActive}</span>
                  </div>
                </div>
                <div style={{ color: 'var(--coral)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--mono)' }}>
                  {student.score}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Most Challenging Topics</div>
          </div>
          <div className="prog-list">
            <div className="prog-item">
              <div className="prog-top">
                <span className="prog-nm">Agile Methodologies</span>
                <span className="prog-pct" style={{ color: 'var(--coral)' }}>41% Accuracy</span>
              </div>
              <div className="prog-track">
                <div className="prog-fill" style={{ width: '41%', background: 'var(--coral)' }}></div>
              </div>
            </div>
            <div className="prog-item">
              <div className="prog-top">
                <span className="prog-nm">Database Normalization</span>
                <span className="prog-pct" style={{ color: 'var(--gold)' }}>58% Accuracy</span>
              </div>
              <div className="prog-track">
                <div className="prog-fill" style={{ width: '58%', background: 'var(--gold)' }}></div>
              </div>
            </div>
            <div className="prog-item">
              <div className="prog-top">
                <span className="prog-nm">System Architecture</span>
                <span className="prog-pct" style={{ color: 'var(--teal)' }}>72% Accuracy</span>
              </div>
              <div className="prog-track">
                <div className="prog-fill" style={{ width: '72%', background: 'var(--teal)' }}></div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text)' }}>Action needed:</strong> Agile methodology appears heavily in past questions but students show poor accuracy. Consider releasing targeted notes or practice questions.
          </div>
        </div>
      </div>
    </div>
  );
};
