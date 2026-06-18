type LandingProps = {
  onGetStarted: () => void;
  onSignIn: () => void;
};

type IconName = 'search' | 'ai' | 'practice' | 'analytics';

const featureCards = [
  {
    label: 'Semantic Search',
    icon: 'search' as IconName,
    title: 'Retrieve exact academic concepts',
    body: 'Search uploaded past questions and lecture notes by course, topic, session, or exam phrase.',
  },
  {
    label: 'AI Study Assistant',
    icon: 'ai' as IconName,
    title: 'Ask from your own source materials',
    body: 'Receive grounded answers from retrieved uploaded materials, with source context when relevant.',
  },
  {
    label: 'Practice Questions',
    icon: 'practice' as IconName,
    title: 'Generate revision sessions',
    body: 'Create self-marked practice from uploaded past questions when ExamMind has enough course material.',
  },
  {
    label: 'Examination Analytics',
    icon: 'analytics' as IconName,
    title: 'Track progress and weak topics',
    body: 'Visualize readiness, practice history, and topics that need more attention before exams.',
  },
];

function LineIcon({ name }: { name: IconName }) {
  if (name === 'search') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 8h10M4 16h7M4 24h11" />
        <circle cx="20" cy="14" r="6" />
        <path d="m24.5 18.5 4.5 4.5" />
      </svg>
    );
  }

  if (name === 'ai') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="8" y="9" width="16" height="15" rx="4" />
        <path d="M13 9V5M19 9V5M13 24v3M19 24v3M8 14H4M8 20H4M28 14h-4M28 20h-4" />
        <circle cx="13" cy="16" r="1" />
        <circle cx="19" cy="16" r="1" />
        <path d="M13 20h6" />
      </svg>
    );
  }

  if (name === 'practice') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="8" y="5" width="16" height="22" rx="2" />
        <path d="M12 10h8M12 23h8M16 17c0-3 4-2.5 4-5 0-1.7-1.4-3-3.5-3-1.8 0-3 .9-3.6 2.2" />
        <path d="M16 20h.1" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="6" width="20" height="20" rx="2" />
      <path d="M11 22v-6M16 22V10M21 22v-9" />
      <path d="M10 26h14" />
    </svg>
  );
}

function GraduationMark() {
  return (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M8 22 48 4l40 18-40 20L8 22Z" />
      <path d="M22 31v20l26 14 26-14V31" />
      <path d="M88 24v30" />
    </svg>
  );
}

export default function Landing({ onGetStarted, onSignIn }: LandingProps) {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Public navigation">
        <div className="landing-brand">
          <span>Exam<em>Mind</em></span>
        </div>
        <div className="landing-nav-links">
          <a href="#product">Product</a>
          <a href="#capabilities">Research</a>
          <a href="#start">Students</a>
        </div>
        <div className="landing-nav-actions">
          <button className="landing-link" onClick={onSignIn}>Log in</button>
          <button className="landing-nav-cta" onClick={onGetStarted}>Get started</button>
        </div>
      </nav>

      <section className="landing-hero" id="product">
        <div className="landing-copy">
          <h1>Study Smarter. Retrieve Faster. Revise With Confidence.</h1>
          <p>
            An AI-powered academic knowledge system for authenticated university students,
            grounded in uploaded course materials, past questions, and lecture notes.
          </p>
          <div className="landing-actions">
            <button className="landing-primary" onClick={onGetStarted}>Get Started - It's Free</button>
            <a className="landing-secondary" href="#capabilities">See How It Works</a>
          </div>
        </div>

        <div className="landing-device-wrap" aria-label="ExamMind interface preview">
          <div className="landing-device">
            <div className="landing-product">
              <div className="landing-product-top">
                <div>
                  <span className="lp-dot"></span>
                  <span className="lp-dot"></span>
                  <span className="lp-dot"></span>
                </div>
                <span>Student dashboard</span>
              </div>
              <div className="landing-product-grid">
                <aside className="lp-side">
                  <div className="lp-side-brand">ExamMind</div>
                  <div className="lp-side-sub">Academic Excellence</div>
                  <div className="lp-side-row on"><span>⌘</span>Dashboard</div>
                  <div className="lp-side-row"><span>◇</span>AI Assistant</div>
                  <div className="lp-side-row"><span>⇧</span>Upload</div>
                  <div className="lp-side-row"><span>□</span>Practice</div>
                </aside>
                <div className="lp-main">
                  <div className="lp-hero-card">
                    <span>Good morning</span>
                    <strong>Ready for revision.</strong>
                    <p>Search uploaded materials, ask grounded questions, and generate practice from indexed documents.</p>
                  </div>
                  <div className="lp-stat-row">
                    <div><span>Search</span><strong>Live</strong></div>
                    <div><span>OCR</span><strong>Clean</strong></div>
                    <div><span>AI</span><strong>Grounded</strong></div>
                  </div>
                  <div className="lp-answer-card">
                    <span>AI study board</span>
                    <p>
                      Answers are generated from retrieved uploaded content and cite source material
                      when relevant.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-capabilities" id="capabilities">
        <div className="landing-section-kicker">Capabilities</div>
        <h2>Precision support for student revision</h2>
        <div className="landing-feature-grid" aria-label="ExamMind capabilities">
          {featureCards.map((card, index) => (
            <article className={`landing-feature ${index === 2 ? 'is-featured' : ''}`} key={card.label}>
              <div className="landing-feature-icon"><LineIcon name={card.icon} /></div>
              <span>{card.label}</span>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-final-cta" id="start">
        <div className="landing-cap-icon"><GraduationMark /></div>
        <h2>Ready to start?</h2>
        <p>Upload your academic materials and build a searchable revision archive for your courses.</p>
        <button className="landing-primary" onClick={onGetStarted}>Get Started For Free</button>
        <small>Student account required. Uploaded materials remain part of your ExamMind study workspace.</small>
      </section>

      <footer className="landing-footer">
        <div>
          <div className="landing-footer-brand">ExamMind</div>
          <p>AI-powered academic knowledge retrieval and collaborative study for university students.</p>
        </div>
        <div className="landing-footer-links">
          <button onClick={onSignIn}>Student login</button>
          <a href="#product">Product</a>
          <a href="#capabilities">Capabilities</a>
        </div>
        <div className="landing-footer-copy">Academic integrity first.</div>
      </footer>
    </main>
  );
}
