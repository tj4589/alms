import type { ScreenType } from '../types';

export default function Analytics({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-analytics">
      <div className="pg-head" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'}}>
        <div>
          <div className="pg-title">Exam <em>Intelligence</em></div>
          <div className="pg-sub">10 years of past question pattern analysis</div>
        </div>
        <select style={{background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 12px', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, outline: 'none', marginBottom: 5}}>
          <option>CSC 301 — Data Structures</option>
          <option>CSC 205 — OOP</option>
          <option>CSC 312 — Operating Systems</option>
        </select>
      </div>
      <div className="ana-stats">
        <div className="ana-card"><div className="ana-num" style={{color: 'var(--gold)'}}>847</div><div className="ana-lbl">Questions indexed</div><div className="ana-delta up">↑ 120 this semester</div></div>
        <div className="ana-card"><div className="ana-num" style={{color: 'var(--teal)'}}>12</div><div className="ana-lbl">Courses covered</div><div className="ana-delta" style={{color: 'var(--text3)'}}>3 departments</div></div>
        <div className="ana-card"><div className="ana-num" style={{color: 'var(--coral)'}}>38%</div><div className="ana-lbl">From graphs + trees</div><div className="ana-delta up">Highest-yield cluster</div></div>
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-hd"><div className="card-ttl">Topic frequency — CSC 301 (2014–2023)</div></div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 11}}>
            <div><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}><span style={{fontSize: 13}}>Sorting algorithms</span><span style={{fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)'}}>43</span></div><div className="prog-track"><div className="prog-fill" style={{width: '100%', background: 'var(--gold)'}}></div></div></div>
            <div><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}><span style={{fontSize: 13}}>Graph algorithms</span><span style={{fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)'}}>38</span></div><div className="prog-track"><div className="prog-fill" style={{width: '88%', background: 'var(--gold)'}}></div></div></div>
            <div><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}><span style={{fontSize: 13}}>Tree structures</span><span style={{fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--teal)'}}>31</span></div><div className="prog-track"><div className="prog-fill" style={{width: '72%', background: 'var(--teal)'}}></div></div></div>
            <div><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}><span style={{fontSize: 13}}>Hashing</span><span style={{fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--teal)'}}>27</span></div><div className="prog-track"><div className="prog-fill" style={{width: '63%', background: 'var(--teal)'}}></div></div></div>
            <div><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}><span style={{fontSize: 13}}>Recursion</span><span style={{fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--purple)'}}>22</span></div><div className="prog-track"><div className="prog-fill" style={{width: '51%', background: 'var(--purple)'}}></div></div></div>
            <div><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}><span style={{fontSize: 13}}>Dynamic programming</span><span style={{fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--coral)'}}>19</span></div><div className="prog-track"><div className="prog-fill" style={{width: '44%', background: 'var(--coral)'}}></div></div></div>
          </div>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">Difficulty split</div></div>
            <div style={{display: 'flex', gap: 8, alignItems: 'flex-end', height: 72, marginBottom: 6}}>
              <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5}}><div style={{fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--coral)'}}>48%</div><div style={{width: '100%', height: 52, background: 'var(--coral2)', border: '1px solid rgba(240,115,90,0.2)', borderRadius: '5px 5px 0 0'}}></div><div style={{fontSize: 10, color: 'var(--text3)'}}>Hard</div></div>
              <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5}}><div style={{fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--gold)'}}>35%</div><div style={{width: '100%', height: 38, background: 'var(--gold2)', border: '1px solid rgba(232,162,58,0.2)', borderRadius: '5px 5px 0 0'}}></div><div style={{fontSize: 10, color: 'var(--text3)'}}>Med</div></div>
              <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5}}><div style={{fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--teal)'}}>17%</div><div style={{width: '100%', height: 18, background: 'var(--teal2)', border: '1px solid rgba(62,207,178,0.2)', borderRadius: '5px 5px 0 0'}}></div><div style={{fontSize: 10, color: 'var(--text3)'}}>Easy</div></div>
            </div>
            <div style={{fontSize: 11.5, color: 'var(--text3)'}}>CSC 301 skews hard — go deep, not broad.</div>
          </div>
          <div className="pred-card">
            <div className="pred-lbl">AI prediction</div>
            <div className="pred-title">Graph algorithms are <em style={{color: 'var(--gold)'}}>very likely</em> in 2024</div>
            <div className="pred-body">Appeared in 8 of the last 10 exams. Dynamic Programming has not appeared since 2021 — high probability of reappearance.</div>
            <button className="cta" onClick={() => go('practice')}>Practice these topics →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
