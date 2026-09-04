import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  FileSearch,
  FileText,
  Library,
  Menu,
  ScanLine,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

type LandingProps = {
  onGetStarted: () => void;
  onSignIn: () => void;
};

const capabilities = [
  {
    number: '01',
    icon: Search,
    label: 'Semantic retrieval',
    title: 'Find the idea, not just the exact phrase.',
    body: 'Search past questions and lecture notes by course, topic, session, or academic concept.',
  },
  {
    number: '02',
    icon: Bot,
    label: 'Grounded answers',
    title: 'Ask against material you trust.',
    body: 'ExamMind retrieves relevant uploaded content before the assistant responds with source context.',
  },
  {
    number: '03',
    icon: FileSearch,
    label: 'Exam practice',
    title: 'Turn an archive into a revision session.',
    body: 'Generate focused practice from the material already indexed in your private study workspace.',
  },
  {
    number: '04',
    icon: BarChart3,
    label: 'Readiness',
    title: 'See which topics still need attention.',
    body: 'Practice history and topic readiness surface your next useful study action.',
  },
];

const workflow = [
  { icon: Upload, title: 'Upload', body: 'Add past questions, lecture notes, or scanned PDFs to your student archive.' },
  { icon: ScanLine, title: 'Index', body: 'ExamMind reads the material, extracts academic metadata, and makes it searchable.' },
  { icon: Sparkles, title: 'Revise', body: 'Search concepts, ask grounded questions, and generate practice from your sources.' },
];

export default function Landing({ onGetStarted, onSignIn }: LandingProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 18);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (menuOpen) closeButtonRef.current?.focus();
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="lm-landing">
      <div className="lm-frame-outer">
        <div className="lm-frame">
          <nav className={`lm-nav ${navScrolled ? 'is-scrolled' : ''}`} aria-label="Public navigation">
            <a className="lm-brand" href="#product" aria-label="ExamMind home">
              <span className="lm-seal">E</span>
              <span className="lm-brand-word"><b>Exam</b><em>Mind</em></span>
            </a>

            <div className="lm-nav-links">
              <a href="#capabilities">Capabilities</a>
              <a href="#workflow">How it works</a>
              <a href="#grounded">Grounded answers</a>
              <a href="#practice">Practice</a>
            </div>

            <div className="lm-nav-actions">
              <button type="button" className="lm-quiet-button" onClick={onSignIn}>Log in</button>
              <button type="button" className="lm-button lm-button-primary lm-nav-cta" onClick={onGetStarted}>
                Start free <ArrowRight aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lm-menu-button"
                ref={menuButtonRef}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
              </button>
            </div>
          </nav>

          {menuOpen && (
            <>
              <button type="button" className="lm-menu-backdrop" aria-label="Close menu" onClick={closeMenu} />
              <div className="lm-mobile-menu" role="dialog" aria-modal="true" aria-label="ExamMind menu">
                <button type="button" className="lm-mobile-menu-close" ref={closeButtonRef} onClick={closeMenu} aria-label="Close menu">
                  <X aria-hidden="true" />
                </button>
                <a href="#capabilities" onClick={closeMenu}>Capabilities</a>
                <a href="#workflow" onClick={closeMenu}>How it works</a>
                <a href="#grounded" onClick={closeMenu}>Grounded answers</a>
                <a href="#practice" onClick={closeMenu}>Practice</a>
                <button type="button" onClick={() => { closeMenu(); onSignIn(); }}>Log in</button>
              </div>
            </>
          )}

          <header className="lm-hero" id="product">
            <div className="lm-hero-canvas">
              <div className="lm-note lm-note-left" aria-hidden="true">
                <span>cites p.14 of</span>
                <strong>my notes <Check /></strong>
              </div>
              <div className="lm-icon-tile lm-check-tile" aria-hidden="true"><Check /></div>
              <div className="lm-icon-tile lm-ai-tile" aria-hidden="true"><Bot /></div>
              <div className="lm-reminder" aria-hidden="true">
                <span className="lm-fragment-label">Next study action</span>
                <strong>Revise network analysis</strong>
                <small>lowest readiness topic</small>
              </div>
              <div className="lm-seal-float" aria-hidden="true">E</div>

              <div className="lm-hero-copy">
                <div className="lm-part"><span>§</span><small>Source-grounded study</small></div>
                <h1>Search, ask, and revise<span>from your own archive.</span></h1>
                <p>Upload past questions and lecture notes. ExamMind answers only from what you gave it — and shows the source.</p>
                <div className="lm-hero-actions">
                  <button type="button" className="lm-button lm-button-primary" onClick={onGetStarted}>
                    Get started <ArrowRight aria-hidden="true" />
                  </button>
                  <a className="lm-button lm-button-outline" href="#workflow">See how it works</a>
                </div>
              </div>

              <div className="lm-archive-fragment" aria-label="Example course archive">
                <span className="lm-fragment-label">Your archive</span>
                <div className="lm-archive-row"><code>MIS415</code><span>Project Management</span><i><b /></i></div>
                <div className="lm-archive-row"><code>BUS204</code><span>Business Statistics</span><i><b /></i></div>
              </div>

              <div className="lm-source-fragment" aria-label="Supported study materials">
                <span className="lm-fragment-label">Built from your material</span>
                <div className="lm-source-icons">
                  <span className="is-gold"><FileText aria-hidden="true" /></span>
                  <span className="is-green"><Library aria-hidden="true" /></span>
                  <span className="is-red"><FileSearch aria-hidden="true" /></span>
                  <span className="is-muted"><Bot aria-hidden="true" /></span>
                </div>
              </div>
            </div>
          </header>

          <div className="lm-material-strip" aria-label="Supported study materials">
            <div className="lm-material-track">
              {['Past questions', 'Lecture notes', 'Scanned PDFs', 'Course topics', 'Reading rooms'].map((item) => <span key={item}>{item}</span>)}
              {['Past questions', 'Lecture notes', 'Scanned PDFs', 'Course topics', 'Reading rooms'].map((item) => <span aria-hidden="true" key={`duplicate-${item}`}>{item}</span>)}
            </div>
          </div>

          <section className="lm-section lm-problem">
            <div className="lm-shell lm-section-head">
              <div>
                <div className="lm-part"><span>§</span><small>The problem</small></div>
                <h2>A folder of scanned PDFs is <em>not</em> a study system.</h2>
              </div>
              <div>
                <p>Past questions circulate on WhatsApp, notes live in a phone gallery, and none of it is searchable when the exam is a week out.</p>
                <div className="lm-rule-note"><Check aria-hidden="true" />Every answer stays attached to the material it was retrieved from.</div>
              </div>
            </div>
          </section>

          <section className="lm-section lm-capabilities" id="capabilities">
            <div className="lm-shell">
              <div className="lm-section-head">
                <div>
                  <div className="lm-part"><span>A</span><small>Section A — capabilities</small></div>
                  <h2>One archive. <em>Four ways forward.</em></h2>
                </div>
                <p>Every feature starts from material you uploaded yourself — nothing is answered from outside your workspace.</p>
              </div>

              <div className="lm-capability-grid">
                {capabilities.map((capability) => {
                  const Icon = capability.icon;
                  return (
                    <article className={`lm-capability lm-capability-${capability.number}`} key={capability.number} id={capability.number === '03' ? 'practice' : undefined}>
                      <div className="lm-capability-top"><span>{capability.number}</span><Icon aria-hidden="true" /></div>
                      <div className="lm-capability-label">{capability.label}</div>
                      <h3>{capability.title}</h3>
                      <p>{capability.body}</p>
                      {capability.number === '01' && (
                        <div className="lm-mini-results"><span>Search your own archive</span><small><Check aria-hidden="true" />Lecture note passage</small><small><Check aria-hidden="true" />Related past question</small></div>
                      )}
                      {capability.number === '02' && <div className="lm-citation">Sources stay attached</div>}
                      {capability.number === '03' && (
                        <div className="lm-question-stub"><strong>Which activity has zero float?</strong><span className="is-selected">A · Critical path</span><span>B · Non-critical path</span></div>
                      )}
                      {capability.number === '04' && <div className="lm-readiness-empty">Readiness appears after practice.</div>}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="lm-section lm-workflow" id="workflow">
            <div className="lm-shell">
              <div className="lm-section-head">
                <div>
                  <div className="lm-part"><span>B</span><small>Section B — how it works</small></div>
                  <h2>From upload to useful in <em>three steps.</em></h2>
                </div>
                <p>No blank chatbot. No disconnected revision tool. Your source material stays at the centre.</p>
              </div>

              <div className="lm-workflow-grid">
                {workflow.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <article className="lm-workflow-step" key={step.title}>
                      <span className="lm-step-number">0{index + 1}</span>
                      <Icon aria-hidden="true" />
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                      <div className="lm-step-visual">
                        {index === 0 && <span className="lm-drop-line">MIS415_2022_2023.pdf · scanned</span>}
                        {index === 1 && <><span><i className="is-done" />OCR cleaned · metadata found</span><span><i className="is-done" />Course context attached</span><span><i />Archive ready to search</span></>}
                        {index === 2 && <><span><i className="is-done" />Questions generated from sources</span><span><i className="is-done" />Two passages cited</span><span><i />Readiness updated after practice</span></>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="lm-section lm-grounded" id="grounded">
            <div className="lm-shell">
              <div className="lm-section-head">
                <div>
                  <div className="lm-part"><span>C</span><small>Section C — grounded answers</small></div>
                  <h2>It answers from your archive, or <em>it says so.</em></h2>
                </div>
                <p>The difference between a study tool and a chatbot is whether it can show you where the answer came from.</p>
              </div>

              <div className="lm-grounded-grid">
                <div className="lm-answer-box">
                  <div className="lm-ask"><span className="lm-avatar">TJ</span><strong>Explain how float is calculated and why it matters.</strong></div>
                  <div className="lm-reply">
                    <span className="lm-reply-label">Answer · grounded in your uploads</span>
                    <p>Total float is the delay an activity can absorb without moving the project end date. The explanation is drawn from your scheduling notes, with the source shown beside it.</p>
                    <div className="lm-reply-source"><FileText aria-hidden="true" />Scheduling Methods · page reference</div>
                  </div>
                </div>
                <div className="lm-tenets">
                  <div><span>01</span><h3>Retrieves before it answers.</h3><p>Relevant chunks come from your uploads first.</p></div>
                  <div><span>02</span><h3>Names the source.</h3><p>Document and page context stay beside the explanation.</p></div>
                  <div><span>03</span><h3>Admits an empty archive.</h3><p>If nothing relevant was uploaded, ExamMind says so.</p></div>
                </div>
              </div>
            </div>
          </section>

          <section className="lm-final-cta" id="start">
            <div className="lm-shell lm-final-inner">
              <div><span className="lm-final-label">Section D — get started</span><h2>Make your material work harder.</h2></div>
              <div><p>Create a student account and build a searchable academic archive from the PDFs already on your phone.</p><button type="button" className="lm-button" onClick={onGetStarted}>Start with ExamMind <ArrowRight aria-hidden="true" /></button></div>
            </div>
          </section>

          <footer className="lm-footer">
            <div className="lm-shell lm-footer-inner">
              <a className="lm-brand" href="#product" aria-label="ExamMind home"><span className="lm-seal">E</span><span className="lm-brand-word"><b>Exam</b><em>Mind</em></span></a>
              <p>Source-grounded academic retrieval and collaborative revision for university students.</p>
              <div className="lm-footer-links"><a href="#capabilities">Capabilities</a><a href="#workflow">How it works</a><button type="button" onClick={onSignIn}>Student login</button></div>
              <small>ExamMind — source-grounded academic retrieval for university students.</small>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
