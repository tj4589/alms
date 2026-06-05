import type { ScreenType } from '../types';

export default function Assistant({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-assistant">
      <div className="pg-head">
        <div className="pg-title">AI <em>Assistant</em></div>
        <div className="pg-sub">Every answer is grounded in your past questions and lecture notes — not the internet</div>
      </div>
      <div className="ai-layout">
        <div className="ai-panel">
          <div className="ai-hd">
            <div className="ai-dot"></div>
            <div className="ai-hd-title">ExamMind AI</div>
            <div className="ai-hd-sub">Searching 847 past questions + uploaded notes</div>
          </div>
          <div className="ai-msgs">
            <div className="msg">
              <div className="msg-ava ai">AI</div>
              <div className="bubble ai">Hello Adaeze! Ask me anything — I'll answer using your past questions and lecture notes. I'll always tell you exactly where I found the information, and if something's missing from the system, I'll let you know.</div>
            </div>
            <div className="msg usr">
              <div className="msg-ava usr">AO</div>
              <div className="bubble usr">What is SDLC? Has it come up in past questions?</div>
            </div>
            <div className="msg">
              <div className="msg-ava ai">AI</div>
              <div className="bubble ai">
                SDLC (Software Development Life Cycle) is a structured process for planning, creating, testing and delivering software. Based on Dr. Okafor's uploaded CSC 204 notes, it defines six phases: Planning, Analysis, Design, Implementation, Testing, and Maintenance. <span className="ai-cite">CSC 204 notes · Week 3</span><br/><br/>
                It has appeared in past questions <strong style={{color: 'var(--gold)'}}>6 times</strong> across CSC 204:
                <div className="pq-ref-row">
                  <div className="pq-ref">
                    <div className="pq-ref-yr">2023 · CSC 204</div>
                    <div className="pq-ref-q">Describe the SDLC phases and explain the Waterfall model with a diagram.</div>
                    <div className="pq-ref-tag"><span className="tag tag-m">Medium</span></div>
                  </div>
                  <div className="pq-ref">
                    <div className="pq-ref-yr">2021 · CSC 204</div>
                    <div className="pq-ref-q">Compare Waterfall and Agile methodologies. Which is better suited for large enterprise projects?</div>
                    <div className="pq-ref-tag"><span className="tag tag-h">Hard</span></div>
                  </div>
                  <div className="pq-ref">
                    <div className="pq-ref-yr">2019 · CSC 204</div>
                    <div className="pq-ref-q">List and explain any four phases of the SDLC with their key deliverables.</div>
                    <div className="pq-ref-tag"><span className="tag tag-e">Easy</span></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="msg usr">
              <div className="msg-ava usr">AO</div>
              <div className="bubble usr">What about Agile? Are there lecture notes on it?</div>
            </div>
            <div className="msg">
              <div className="msg-ava ai">AI</div>
              <div className="bubble ai">
                Agile appeared in <strong style={{color: 'var(--gold)'}}>4 past questions</strong> in CSC 204. <span className="ai-cite">2021 Q3 · 2020 Q1b · 2018 Q4</span><br/><br/>
                However — <strong style={{color: 'var(--coral)'}}>there are no lecture notes on Agile in the system yet.</strong> The uploaded CSC 204 notes cover Waterfall and SDLC phases but don't include Agile or Scrum. Given how often it appears in exams, this is worth studying from other sources.
              </div>
            </div>
          </div>
          <div className="ai-foot">
            <input className="ai-inp" type="text" placeholder="Ask about a topic, past question, or request practice..."/>
            <button className="send">→</button>
          </div>
        </div>

        <div className="related-panel">
          <div className="note-absent">
            <div className="note-absent-lbl">No lecture notes found</div>
            <div className="note-absent-msg">There are no lecture notes on <strong>Agile methodology</strong> in the system yet. Be the first to upload them — it will help every student asking this question.</div>
            <div className="upload-prompt" onClick={() => go('upload')}>+ Upload CSC 204 notes</div>
          </div>

          <div className="card">
            <div className="card-hd"><div className="card-ttl">Related past questions</div></div>
            <div className="qi">
              <div className="qi-body">
                <div className="qi-title">Compare Waterfall and Agile. Which suits enterprise projects?</div>
                <div className="qi-meta"><span className="tag tag-h">Hard</span><span className="qi-yr" style={{background: 'none', padding: 0, fontSize: 10, color: 'var(--text3)'}}>2021</span></div>
              </div>
            </div>
            <div className="qi">
              <div className="qi-body">
                <div className="qi-title">Explain Scrum framework and its roles.</div>
                <div className="qi-meta"><span className="tag tag-m">Medium</span><span className="qi-yr" style={{background: 'none', padding: 0, fontSize: 10, color: 'var(--text3)'}}>2020</span></div>
              </div>
            </div>
            <div className="qi">
              <div className="qi-body">
                <div className="qi-title">What are the key principles of Agile development?</div>
                <div className="qi-meta"><span className="tag tag-e">Easy</span><span className="qi-yr" style={{background: 'none', padding: 0, fontSize: 10, color: 'var(--text3)'}}>2018</span></div>
              </div>
            </div>
            <div style={{marginTop: 12}}><button className="cta cta-ghost" style={{width: '100%', justifyContent: 'center', fontSize: 12}}>View all 4 related Qs</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
