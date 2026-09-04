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
    title: 'Ask questions against material you trust.',
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
    body: 'Track practice history, topic readiness, and weak areas as revision progresses.',
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
    const onScroll = () => setNavScrolled(window.scrollY > 24);
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
    <main className="em-landing">
      <nav className={`em-nav ${navScrolled ? 'is-scrolled' : ''}`} aria-label="Public navigation">
        <a className="em-brand" href="#product" aria-label="ExamMind home">
          <span className="em-brand-mark">E</span>
          <span className="em-brand-word">exam<span>mind</span></span>
        </a>
        <div className="em-nav-links">
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">How it works</a>
          <a href="#grounded">Grounded answers</a>
          <a href="#practice">Practice</a>
        </div>
        <div className="em-nav-actions">
          <button type="button" className="em-text-button" onClick={onSignIn}>Log in</button>
          <button type="button" className="em-small-cta" onClick={onGetStarted}>Start free <ArrowRight aria-hidden="true" /></button>
          <button
            type="button"
            className="em-menu-button"
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
          <button type="button" className="em-menu-backdrop" aria-label="Close menu" onClick={closeMenu} />
          <div className="em-mobile-menu" role="dialog" aria-modal="true" aria-label="ExamMind menu">
            <button type="button" className="em-mobile-menu-close" ref={closeButtonRef} onClick={closeMenu} aria-label="Close menu"><X aria-hidden="true" /></button>
            <a href="#capabilities" onClick={closeMenu}>Capabilities</a>
            <a href="#workflow" onClick={closeMenu}>How it works</a>
            <a href="#grounded" onClick={closeMenu}>Grounded answers</a>
            <a href="#practice" onClick={closeMenu}>Practice</a>
          </div>
        </>
      )}

      <section className="em-hero" id="product">
        <div className="em-hero-grid" aria-hidden="true" />
        <div className="em-hero-content">
          <div className="em-eyebrow"><span />Private academic index</div>
          <h1>Your course material, finally <em>answerable.</em></h1>
          <p className="em-hero-lede">Upload your past questions and lecture notes. ExamMind indexes them, answers from them, and builds practice out of them — with the source attached.</p>
          <div className="em-hero-actions">
            <button type="button" className="em-primary-cta" onClick={onGetStarted}>Build your study archive <ArrowRight aria-hidden="true" /></button>
            <a className="em-secondary-link" href="#workflow">See how it works</a>
          </div>
          <div className="em-proof-line" aria-label="ExamMind benefits">
            <span><Check aria-hidden="true" />Student account</span>
            <span><Check aria-hidden="true" />Answers cite sources</span>
            <span><Check aria-hidden="true" />No credit card</span>
          </div>
        </div>

        <div className="em-product-stage">
          <div className="em-product-window" aria-label="ExamMind grounded answer preview">
            <div className="em-window-bar">
              <div className="em-window-dots" aria-hidden="true"><span /><span /><span /></div>
              <span className="em-window-title">ExamMind / Study archive</span>
              <span className="em-window-status"><span />Sources ready</span>
            </div>
            <div className="em-product-layout">
              <aside className="em-product-nav" aria-label="Product preview navigation">
                <div className="em-product-logo">E</div>
                <div className="em-product-nav-item is-active"><Search aria-hidden="true" /><span>Search</span></div>
                <div className="em-product-nav-item"><Library aria-hidden="true" /><span>Library</span></div>
                <div className="em-product-nav-item"><Bot aria-hidden="true" /><span>Assistant</span></div>
              </aside>
              <div className="em-product-main">
                <div className="em-product-kicker">Course workspace / preview archive</div>
                <div className="em-demo-search"><Search aria-hidden="true" /><span>What is the critical path method?</span><kbd>Enter</kbd></div>
                <div className="em-answer-grid">
                  <div className="em-answer-copy">
                    <div className="em-answer-label"><Sparkles aria-hidden="true" />Grounded answer</div>
                    <h2>The critical path is the longest sequence of dependent project activities.</h2>
                    <p>It determines the shortest possible completion time and identifies tasks with no scheduling flexibility.</p>
                  </div>
                  <div className="em-source-panel">
                    <div className="em-source-title">Retrieved sources</div>
                    <div className="em-source-row"><FileText aria-hidden="true" /><span><strong>Your lecture notes</strong><small>Relevant passage · attached</small></span><Check aria-hidden="true" /></div>
                    <div className="em-source-row"><FileText aria-hidden="true" /><span><strong>Your past questions</strong><small>Related item · attached</small></span><Check aria-hidden="true" /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="em-fragment em-fragment-readiness"><strong>—</strong><span>Readiness after practice</span></div>
          <div className="em-fragment em-fragment-source"><Check aria-hidden="true" /><span>Source attached to every answer</span></div>
          <div className="em-fragment em-fragment-practice"><Sparkles aria-hidden="true" /><span>Practice from your archive</span></div>
        </div>
      </section>

      <section className="em-material-band" aria-label="Supported study materials">
        <div className="em-material-track">
          {['Past questions', 'Lecture notes', 'Scanned PDFs', 'Course topics', 'Study groups', 'Reading rooms'].map((item) => <span key={item}>{item}</span>)}
          {['Past questions', 'Lecture notes', 'Scanned PDFs', 'Course topics', 'Study groups', 'Reading rooms'].map((item) => <span aria-hidden="true" key={`duplicate-${item}`}>{item}</span>)}
        </div>
      </section>

      <section className="em-statement" id="problem">
        <div className="em-section-index">01 / The problem</div>
        <div className="em-statement-grid">
          <h2>Your course material should not disappear into folders.</h2>
          <div><p>ExamMind turns a scattered archive into a study system you can search, question, and practice against.</p><p className="em-integrity-note"><Check aria-hidden="true" />Every answer stays attached to the material it was retrieved from.</p></div>
        </div>
      </section>

      <section className="em-capabilities" id="capabilities">
        <div className="em-section-heading"><div className="em-section-index">02 / Capabilities</div><h2>One archive. <em>Four ways forward.</em></h2><p>Every feature begins with the material in your own academic workspace.</p></div>
        <div className="em-capability-grid">
          {capabilities.map((capability) => { const Icon = capability.icon; return <article id={capability.number === '03' ? 'practice' : undefined} className={`em-capability em-capability-${capability.number}`} key={capability.number}><div className="em-capability-top"><span>{capability.number}</span><Icon aria-hidden="true" /></div><div className="em-capability-label">{capability.label}</div><h3>{capability.title}</h3><p>{capability.body}</p>{capability.number === '01' && <div className="em-mini-results"><span>Search your own archive</span><small><Check aria-hidden="true" />Lecture note passage</small><small><Check aria-hidden="true" />Related past question</small></div>}{capability.number === '02' && <div className="em-citation">Sources stay attached</div>}{capability.number === '03' && <div className="em-question-stub"><strong>Which activity has zero float?</strong><span className="is-selected">A · Critical path</span><span>B · Non-critical path</span></div>}{capability.number === '04' && <div className="em-readiness-empty">Readiness appears after practice.</div>}</article>; })}
        </div>
      </section>

      <section className="em-workflow" id="workflow">
        <div className="em-section-index">03 / How it works</div>
        <div className="em-workflow-intro"><h2>From upload to useful in three deliberate steps.</h2><p>No blank chatbot. No disconnected revision tool. Your source material stays at the center.</p></div>
        <div className="em-workflow-grid">{workflow.map((step, index) => { const Icon = step.icon; return <article className="em-workflow-step" key={step.title}><div className="em-step-number">0{index + 1}</div><Icon aria-hidden="true" /><h3>{step.title}</h3><p>{step.body}</p></article>; })}</div>
      </section>

      <section className="em-grounded" id="grounded">
        <div className="em-section-index">04 / Grounded answers</div>
        <div className="em-grounded-grid"><div className="em-grounded-answer"><div className="em-answer-label"><Sparkles aria-hidden="true" />Grounded answer</div><p className="em-grounded-question">Ask about a concept in your own material.</p><p className="em-grounded-copy">ExamMind retrieves from your archive first, then explains the answer with the source context beside it.</p><div className="em-grounded-sources"><div><FileText aria-hidden="true" /><span>Lecture note source <small>page reference</small></span></div><div><FileText aria-hidden="true" /><span>Past question source <small>course context</small></span></div></div><footer><Check aria-hidden="true" />Grounded in your uploads</footer></div><div className="em-grounded-principles"><p>Retrieves before it answers.</p><p>Cites the source name.</p><p>Says so when your archive has nothing.</p></div></div>
      </section>

      <section className="em-final-cta" id="start"><div><div className="em-final-label">Your next revision session starts here.</div><h2>Make your material work harder.</h2></div><div className="em-final-action"><p>Create your student account and build a searchable academic archive.</p><button type="button" onClick={onGetStarted}>Start with ExamMind <ArrowRight aria-hidden="true" /></button></div></section>

      <footer className="em-footer"><a className="em-brand" href="#product" aria-label="ExamMind home"><span className="em-brand-mark">E</span><span className="em-brand-word">exam<span>mind</span></span></a><p>Source-grounded academic retrieval and revision for university students.</p><div className="em-footer-links"><span>Product</span><a href="#workflow">How it works</a><button type="button" onClick={onSignIn}>Student login</button></div><small>ExamMind — source-grounded academic retrieval for university students.</small></footer>
    </main>
  );
}
