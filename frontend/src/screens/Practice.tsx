import { useState } from 'react';
import type { ScreenType } from '../types';

export default function Practice({ go }: { go: (s: ScreenType) => void }) {
  const [qCount, setQCount] = useState<number>(10);

  return (
    <div className="page" id="s-practice">
      <div className="pg-head">
        <div className="pg-title">Practice <em>Tests</em></div>
        <div className="pg-sub">AI-generated in real exam style · Timed · Full debrief after</div>
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-hd"><div className="card-ttl">Generate a practice test</div></div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
            <div><div style={{fontSize: 11, color: 'var(--text3)', marginBottom: 5, fontWeight: 500}}>Course</div><select style={{width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, outline: 'none'}}><option>CSC 301 — Data Structures &amp; Algorithms</option><option>CSC 205 — OOP</option><option>CSC 312 — Operating Systems</option></select></div>
            <div><div style={{fontSize: 11, color: 'var(--text3)', marginBottom: 5, fontWeight: 500}}>Topic focus</div><select style={{width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, outline: 'none'}}><option>Graph algorithms</option><option>Sorting algorithms</option><option>Tree structures</option><option>Dynamic programming</option></select></div>
            <div><div style={{fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 500}}>Number of questions: <span id="q-count">{qCount}</span></div><input type="range" min="5" max="30" value={qCount} step="1" style={{width: '100%', accentColor: 'var(--gold)'}} onChange={(e) => setQCount(parseInt(e.target.value, 10))} /></div>
            <button 
              className="cta" 
              style={{width: '100%', justifyContent: 'center', padding: 12, fontSize: 13.5, position: 'relative', overflow: 'hidden'}}
              onClick={(e) => {
                const btn = e.currentTarget;
                const originalText = btn.innerText;
                btn.disabled = true;
                btn.innerText = 'Generating questions...';
                btn.style.opacity = '0.7';
                setTimeout(() => {
                  btn.disabled = false;
                  btn.innerText = originalText;
                  btn.style.opacity = '1';
                  alert('Practice test generated! (Mock)');
                }, 2000);
              }}
            >
              Generate test →
            </button>
          </div>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">Recent attempts</div></div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--border)'}}><div style={{flex: 1}}><div style={{fontSize: 13, fontWeight: 500}}>Sorting algorithms · 10 Qs</div><div style={{fontSize: 11, color: 'var(--text3)'}}>Yesterday · 18 min</div></div><div style={{fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--teal)'}}>80%</div></div>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--border)'}}><div style={{flex: 1}}><div style={{fontSize: 13, fontWeight: 500}}>Graph algorithms · 8 Qs</div><div style={{fontSize: 11, color: 'var(--text3)'}}>2 days ago · 22 min</div></div><div style={{fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--gold)'}}>63%</div></div>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--border)'}}><div style={{flex: 1}}><div style={{fontSize: 13, fontWeight: 500}}>Dynamic programming · 12 Qs</div><div style={{fontSize: 11, color: 'var(--text3)'}}>4 days ago · 31 min</div></div><div style={{fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--coral)'}}>42%</div></div>
            </div>
          </div>
          <div className="pred-card">
            <div className="pred-lbl">Smart suggestion</div>
            <div className="pred-title">Practice <em style={{color: 'var(--gold)'}}>Dynamic Programming</em></div>
            <div className="pred-body">Your last score was 42%. This topic hasn't appeared since 2021, making it high probability for 2024.</div>
            <button className="cta" onClick={() => go('assistant')}>Practice now →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
