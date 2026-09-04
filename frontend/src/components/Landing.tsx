import { lazy, Suspense, useState } from 'react';
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

const LandingScene3D = lazy(() => import('./LandingScene3D'));

function LandingScenePlaceholder() {
  return (
    <div className="em-hero-scene em-hero-scene-loading" aria-hidden="true">
      <div className="em-hero-scene-fallback">
        <span className="em-fallback-sheet em-fallback-sheet-back" />
        <span className="em-fallback-sheet em-fallback-sheet-front"><i /><i /><i /><i /></span>
        <span className="em-fallback-highlight" />
      </div>
    </div>
  );
}

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
  const [sceneReady, setSceneReady] = useState(false);

  return (
    <main className="em-landing">
      <section className={`em-hero ${sceneReady ? 'is-scene-ready' : ''}`} id="product">

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

        <div className="em-hero-layout">
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

          <div className="em-hero-visual" aria-label="ExamMind study material in motion">
            <Suspense fallback={<LandingScenePlaceholder />}>
              <LandingScene3D onReady={() => setSceneReady(true)} />
            </Suspense>
            <div className="em-hero-chip em-chip-source"><FileText aria-hidden="true" /><span>Cited · p.14</span></div>
            <div className="em-hero-chip em-chip-readiness"><span className="em-chip-ring" aria-hidden="true" /> <span>Ready to practice</span></div>
            <div className="em-hero-chip em-chip-archive"><Library aria-hidden="true" /><span>Source attached</span></div>
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
