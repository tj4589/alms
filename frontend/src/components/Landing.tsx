import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  FileSearch,
  FileText,
  Library,
  ScanLine,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import heroDesk from '../assets/exammind-study-desk-hero-orange.jpg';

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
  {
    icon: Upload,
    title: 'Upload',
    body: 'Add past questions, lecture notes, or scanned PDFs to your student archive.',
  },
  {
    icon: ScanLine,
    title: 'Index',
    body: 'ExamMind reads the material, extracts academic metadata, and makes it searchable.',
  },
  {
    icon: Sparkles,
    title: 'Revise',
    body: 'Search concepts, ask grounded questions, and generate practice from your sources.',
  },
];

export default function Landing({ onGetStarted, onSignIn }: LandingProps) {
  return (
    <main className="em-landing">
      <section
        className="em-hero"
        id="product"
        style={{ '--em-hero-image': `url(${heroDesk})` } as React.CSSProperties}
      >
        <div className="em-hero-shade" aria-hidden="true" />

        <nav className="em-nav" aria-label="Public navigation">
          <a className="em-brand" href="#product" aria-label="ExamMind home">
            <span className="em-brand-mark">E</span>
            <span>ExamMind</span>
          </a>

          <div className="em-nav-links">
            <a href="#capabilities">Capabilities</a>
            <a href="#workflow">How it works</a>
            <a href="#integrity">Integrity</a>
          </div>

          <div className="em-nav-actions">
            <button type="button" className="em-text-button" onClick={onSignIn}>Log in</button>
            <button type="button" className="em-small-cta" onClick={onGetStarted}>
              Start free
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </nav>

        <div className="em-hero-content">
          <div className="em-eyebrow"><span />Your private academic index</div>
          <h1>ExamMind.</h1>
          <p className="em-hero-lede">Turn the course material you already have into answers you can trust.</p>
          <p className="em-hero-copy">
            Search uploaded notes and past questions, ask grounded questions, and build focused practice
            from one student workspace.
          </p>
          <div className="em-hero-actions">
            <button type="button" className="em-primary-cta" onClick={onGetStarted}>
              Build your study archive
              <ArrowRight aria-hidden="true" />
            </button>
            <a className="em-secondary-link" href="#workflow">See how it works</a>
          </div>
          <div className="em-proof-line" aria-label="ExamMind benefits">
            <span><Check aria-hidden="true" />Student account</span>
            <span><Check aria-hidden="true" />Source-grounded</span>
            <span><Check aria-hidden="true" />No credit card</span>
          </div>
        </div>

        <div className="em-product-window" aria-label="ExamMind grounded answer preview">
          <div className="em-window-bar">
            <div className="em-window-dots" aria-hidden="true"><span /><span /><span /></div>
            <span className="em-window-title">ExamMind / Study archive</span>
            <span className="em-window-status"><span />Sources ready</span>
          </div>
          <div className="em-product-layout">
            <aside className="em-product-nav" aria-label="Product preview navigation">
              <div className="em-product-logo">EM</div>
              <div className="em-product-nav-item is-active"><Search aria-hidden="true" /><span>Search</span></div>
              <div className="em-product-nav-item"><Library aria-hidden="true" /><span>Library</span></div>
              <div className="em-product-nav-item"><Bot aria-hidden="true" /><span>Assistant</span></div>
            </aside>
            <div className="em-product-main">
              <div className="em-product-kicker">Course workspace</div>
              <div className="em-demo-search">
                <Search aria-hidden="true" />
                <span>What is the critical path method?</span>
                <kbd>Enter</kbd>
              </div>
              <div className="em-answer-grid">
                <div className="em-answer-copy">
                  <div className="em-answer-label"><Sparkles aria-hidden="true" />Grounded answer</div>
                  <h2>The critical path is the longest sequence of dependent project activities.</h2>
                  <p>It determines the shortest possible completion time and identifies tasks with no scheduling flexibility.</p>
                </div>
                <div className="em-source-panel">
                  <div className="em-source-title">Retrieved sources</div>
                  <div className="em-source-row"><FileText aria-hidden="true" /><span><strong>Project Management Notes</strong><small>Scheduling methods</small></span></div>
                  <div className="em-source-row"><FileText aria-hidden="true" /><span><strong>Past Question</strong><small>Project planning</small></span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="em-material-band" aria-label="Supported study materials">
        <div className="em-material-label">Built for the material students actually use</div>
        <div className="em-material-list">
          <span>Past questions</span>
          <span>Lecture notes</span>
          <span>Scanned PDFs</span>
          <span>Course topics</span>
        </div>
      </section>

      <section className="em-statement" id="integrity">
        <div className="em-section-index">01 / The problem</div>
        <div className="em-statement-grid">
          <h2>Your course material should not disappear into folders.</h2>
          <div>
            <p>ExamMind turns a scattered archive into a study system you can search, question, and practice against.</p>
            <p className="em-integrity-note"><Check aria-hidden="true" />AI answers stay connected to retrieved academic sources.</p>
          </div>
        </div>
      </section>

      <section className="em-capabilities" id="capabilities">
        <div className="em-section-heading">
          <div className="em-section-index">02 / Capabilities</div>
          <h2>One archive.<br /><em>Four ways forward.</em></h2>
          <p>Every feature begins with the material in your own academic workspace.</p>
        </div>
        <div className="em-capability-grid">
          {capabilities.map((capability) => {
            const Icon = capability.icon;
            return (
              <article className="em-capability" key={capability.number}>
                <div className="em-capability-top"><span>{capability.number}</span><Icon aria-hidden="true" /></div>
                <div className="em-capability-label">{capability.label}</div>
                <h3>{capability.title}</h3>
                <p>{capability.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="em-workflow" id="workflow">
        <div className="em-section-index">03 / How it works</div>
        <div className="em-workflow-intro">
          <h2>From upload to useful<br />in three deliberate steps.</h2>
          <p>No blank chatbot. No disconnected revision tool. Your source material stays at the center.</p>
        </div>
        <div className="em-workflow-grid">
          {workflow.map((step, index) => {
            const Icon = step.icon;
            return (
              <article className="em-workflow-step" key={step.title}>
                <div className="em-step-number">0{index + 1}</div>
                <Icon aria-hidden="true" />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="em-final-cta" id="start">
        <div>
          <div className="em-final-label">Your next revision session starts here.</div>
          <h2>Make your material<br />work harder.</h2>
        </div>
        <div className="em-final-action">
          <p>Create your student account and build a searchable academic archive.</p>
          <button type="button" onClick={onGetStarted}>
            Start with ExamMind
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <footer className="em-footer">
        <a className="em-brand" href="#product" aria-label="ExamMind home">
          <span className="em-brand-mark">E</span>
          <span>ExamMind</span>
        </a>
        <p>Source-grounded academic retrieval and revision for university students.</p>
        <div className="em-footer-links">
          <button type="button" onClick={onSignIn}>Student login</button>
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">How it works</a>
        </div>
      </footer>
    </main>
  );
}
