import type { ScreenType } from '../types';

export default function Dashboard({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-dashboard">
      <div className="pg-head">
        <div className="pg-title">Good evening, <em>Adaeze.</em></div>
        <div className="pg-sub">3 high-frequency topics need your attention before the DSA final.</div>
      </div>

      <div className="focus-card">
        <div className="focus-left">
          <div className="focus-pill">⏱ Next exam</div>
          <div className="focus-course">Data Structures &amp; <em>Algorithms</em></div>
          <div className="focus-meta">CSC 301 · Faculty of Computing · First semester final</div>
        </div>
        <div className="focus-right">
          <div className="cd-unit"><span className="cd-num">14</span><div className="cd-lbl">days</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-unit"><span className="cd-num">06</span><div className="cd-lbl">hrs</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-unit"><span className="cd-num">32</span><div className="cd-lbl">min</div></div>
        </div>
        <button className="focus-cta" onClick={() => go('practice')}>Start practice →</button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-glow" style={{background: 'var(--gold)'}}></div>
          <div className="stat-lbl">Questions reviewed</div>
          <div className="stat-val" style={{color: 'var(--gold)'}}>142</div>
          <div className="stat-delta">↑ 18 this week</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{background: 'var(--teal)'}}></div>
          <div className="stat-lbl">Practice avg score</div>
          <div className="stat-val" style={{color: 'var(--teal)'}}>71%</div>
          <div className="stat-delta">↑ 6% from last week</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{background: 'var(--coral)'}}></div>
          <div className="stat-lbl">Topics mastered</div>
          <div className="stat-val" style={{color: 'var(--coral)'}}>8</div>
          <div className="stat-delta">3 in progress</div>
        </div>
        <div className="stat">
          <div className="stat-glow" style={{background: 'var(--purple)'}}></div>
          <div className="stat-lbl">AI sessions today</div>
          <div className="stat-val" style={{color: 'var(--purple)'}}>4</div>
          <div className="stat-delta">24 total this week</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">High-frequency questions</div>
            <div className="card-lnk" onClick={() => go('questions')}>View all →</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2023</div>
            <div className="qi-body">
              <div className="qi-title">Explain the time complexity of QuickSort in best, average and worst cases.</div>
              <div className="qi-meta"><span className="tag tag-h">Hard</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{width: '90%'}}></div></div>9×</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2022</div>
            <div className="qi-body">
              <div className="qi-title">With a diagram, describe how a Binary Search Tree performs deletion.</div>
              <div className="qi-meta"><span className="tag tag-m">Medium</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{width: '70%'}}></div></div>7×</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2021</div>
            <div className="qi-body">
              <div className="qi-title">Compare Dijkstra's and Bellman-Ford algorithms. When would you use each?</div>
              <div className="qi-meta"><span className="tag tag-h">Hard</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{width: '55%'}}></div></div>6×</div>
          </div>
          <div className="qi">
            <div className="qi-yr">2023</div>
            <div className="qi-body">
              <div className="qi-title">Define hashing. Explain collision resolution strategies with examples.</div>
              <div className="qi-meta"><span className="tag tag-e">Easy</span><span className="qi-course">CSC 301</span></div>
            </div>
            <div className="qi-freq"><div className="freq-bar"><div className="freq-fill" style={{width: '45%'}}></div></div>5×</div>
          </div>
        </div>

        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">Topic readiness</div><div className="card-lnk">Details →</div></div>
            <div className="prog-list">
              <div><div className="prog-top"><span className="prog-nm">Sorting algorithms</span><span className="prog-pct">84%</span></div><div className="prog-track"><div className="prog-fill" style={{width: '84%', background: 'var(--teal)'}}></div></div></div>
              <div><div className="prog-top"><span className="prog-nm">Graph theory</span><span className="prog-pct">61%</span></div><div className="prog-track"><div className="prog-fill" style={{width: '61%', background: 'var(--gold)'}}></div></div></div>
              <div><div className="prog-top"><span className="prog-nm">Tree structures</span><span className="prog-pct">48%</span></div><div className="prog-track"><div className="prog-fill" style={{width: '48%', background: 'var(--gold)'}}></div></div></div>
              <div><div className="prog-top"><span className="prog-nm">Dynamic programming</span><span className="prog-pct">22%</span></div><div className="prog-track"><div className="prog-fill" style={{width: '22%', background: 'var(--coral)'}}></div></div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><div className="card-ttl">This week</div></div>
            <div className="bar-chart">
              <div className="bc-col"><div className="bc-bar" style={{height: 28}}></div><span className="bc-lbl">M</span></div>
              <div className="bc-col"><div className="bc-bar" style={{height: 46}}></div><span className="bc-lbl">T</span></div>
              <div className="bc-col"><div className="bc-bar" style={{height: 36}}></div><span className="bc-lbl">W</span></div>
              <div className="bc-col"><div className="bc-bar on" style={{height: 64}}></div><span className="bc-lbl">T</span></div>
              <div className="bc-col"><div className="bc-bar" style={{height: 50}}></div><span className="bc-lbl">F</span></div>
              <div className="bc-col"><div className="bc-bar" style={{height: 22}}></div><span className="bc-lbl">S</span></div>
              <div className="bc-col"><div className="bc-bar" style={{height: 8}}></div><span className="bc-lbl">S</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
