import type { ScreenType } from '../types';

export default function Collab({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-collab">
      <div className="pg-head">
        <div className="pg-title">Study <em>Collaboration</em></div>
        <div className="pg-sub">Discussions anchored to specific past questions — @AI works in any thread</div>
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-hd"><div className="card-ttl">Active threads</div><button className="cta" style={{padding: '7px 14px', fontSize: 12}} onClick={() => go('assistant')}>+ New thread</button></div>
          <div className="collab-item">
            <div className="collab-top">
              <div className="ava" style={{width: 26, height: 26, fontSize: 10}}>CK</div>
              <div className="collab-name">Chidi Kalu</div>
              <div className="collab-time">2 min ago</div>
            </div>
            <div className="collab-msg">Can someone explain why Bellman-Ford handles negative weights but Dijkstra doesn't? Is it just the relaxation order?</div>
            <div className="collab-link">📄 CSC 301 · 2021 Q3a — Graph algorithms</div>
          </div>
          <div className="collab-item">
            <div className="collab-top">
              <div className="ava" style={{width: 26, height: 26, fontSize: 10, background: 'linear-gradient(135deg, var(--coral), var(--purple))'}}>NE</div>
              <div className="collab-name">Ngozi Eze</div>
              <div className="collab-time">18 min ago</div>
            </div>
            <div className="collab-msg">For BST deletion — the tricky case is two children. Key is using the inorder successor. Here's how I think about it...</div>
            <div className="collab-link">📄 CSC 301 · 2022 Q2b — Tree structures</div>
          </div>
          <div className="collab-item">
            <div className="collab-top">
              <div className="ava" style={{width: 26, height: 26, fontSize: 10, background: 'linear-gradient(135deg, var(--teal), var(--purple))'}}>TA</div>
              <div className="collab-name">Tunde Adeyemi</div>
              <div className="collab-time">1 hr ago</div>
            </div>
            <div className="collab-msg">Group study session tomorrow 4pm for DSA finals. We'll go through the 2019–2023 paper patterns. Drop your name below!</div>
            <div className="collab-link">📌 Study group · CSC 301 Final prep</div>
          </div>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card" style={{background: 'linear-gradient(135deg, var(--teal2), rgba(62,207,178,0.02))', borderColor: 'rgba(62,207,178,0.18)'}}>
            <div style={{fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8}}>AI in threads</div>
            <div style={{fontSize: 13.5, fontWeight: 500, marginBottom: 5}}>Type @AI in any thread</div>
            <div style={{fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6}}>The AI responds instantly with an answer grounded in past questions — visible to everyone in the thread. It scaffolds discussion without replacing it.</div>
          </div>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">Study groups</div></div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 9}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)'}}>
                <div style={{width: 34, height: 34, background: 'var(--teal2)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, border: '1px solid rgba(62,207,178,0.2)'}}>◈</div>
                <div style={{flex: 1}}><div style={{fontSize: 13, fontWeight: 500}}>CSC 301 finals squad</div><div style={{fontSize: 11, color: 'var(--text3)'}}>14 members · Active now</div></div>
                <button className="cta cta-ghost" style={{padding: '5px 10px', fontSize: 11}}>Join</button>
              </div>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)'}}>
                <div style={{width: 34, height: 34, background: 'var(--purple2)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, border: '1px solid rgba(155,135,245,0.2)'}}>◉</div>
                <div style={{flex: 1}}><div style={{fontSize: 13, fontWeight: 500}}>Algorithms study circle</div><div style={{fontSize: 11, color: 'var(--text3)'}}>8 members · Tomorrow 4pm</div></div>
                <button className="cta cta-ghost" style={{padding: '5px 10px', fontSize: 11}}>Join</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
