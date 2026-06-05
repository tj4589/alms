import type { ScreenType } from '../types';

export default function StudyGroups({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-groups">
      <div className="pg-head">
        <div className="pg-title">Study <em>Groups</em></div>
        <div className="pg-sub">Connect with classmates and study together in real-time.</div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Active Sessions</div>
            <button className="cta" style={{ marginTop: 0, padding: '6px 12px', fontSize: 11 }} onClick={() => go('collab')}>+ Create Group</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { title: 'Algorithms Final Review', course: 'CSC 301', members: 14, status: 'Live' },
              { title: 'OS Midterm Prep', course: 'CSC 312', members: 8, status: 'Starting in 5m' },
              { title: 'Database Normalization', course: 'CSC 201', members: 22, status: 'Live' },
            ].map((group, i) => (
              <div key={i} className="qd">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="tag tag-e" style={{ background: group.status === 'Live' ? 'var(--teal2)' : 'var(--gold2)', color: group.status === 'Live' ? 'var(--teal)' : 'var(--gold)' }}>
                    {group.status}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{group.members} members</div>
                </div>
                <div className="qd-text" style={{ fontWeight: 600, fontSize: 14 }}>{group.title}</div>
                <div className="qd-meta">
                  <span className="qi-course">{group.course}</span>
                  <button className="ask-ai-btn" style={{ marginLeft: 'auto' }}>Join Session →</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <div className="card-hd">
              <div className="card-ttl">My Groups</div>
            </div>
            <div className="prog-list">
              {[
                { name: 'CSC Year 3 Elite', members: 12, new: 5 },
                { name: 'Algorithms Study Squad', members: 8, new: 0 },
                { name: 'OS Night Owls', members: 15, new: 2 },
              ].map((myg, i) => (
                <div key={i} className="collab-item">
                  <div className="collab-top">
                    <div className="collab-name">{myg.name}</div>
                    {myg.new > 0 && <span className="ni-badge">{myg.new}</span>}
                  </div>
                  <div className="collab-msg" style={{ fontSize: 11 }}>{myg.members} members</div>
                </div>
              ))}
            </div>
          </div>

          <div className="pred-card" style={{ background: 'var(--purple2)', borderColor: 'rgba(155,135,245,0.2)' }}>
            <div className="pred-lbl" style={{ color: 'var(--purple)' }}>Study match</div>
            <div className="pred-title">Join <em style={{ color: 'var(--purple)' }}>Sarah's Study Group</em></div>
            <div className="pred-body">Sarah and 3 others are currently reviewing <em>Heap Sort</em>, which you struggled with yesterday.</div>
            <button className="cta" style={{ background: 'var(--purple)' }}>Join Group →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
