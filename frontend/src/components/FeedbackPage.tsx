import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import Logo from './Logo';
import FeedbackPanel from './FeedbackPanel';
import './FeedbackPage.css';

type FeedbackPageProps = {
  onBackToHome: () => void;
  onGetStarted: () => void;
  onSignIn: () => void;
};

export default function FeedbackPage({ onBackToHome, onGetStarted, onSignIn }: FeedbackPageProps) {
  return (
    <main className="feedback-page">
      <header className="feedback-page-header">
        <button className="feedback-page-brand" type="button" onClick={onBackToHome} aria-label="Return to ExamMind home">
          <Logo size={30} />
          <span>Exam<span>Mind.</span></span>
        </button>
        <div className="feedback-page-actions">
          <button className="feedback-page-back" type="button" onClick={onBackToHome}><ArrowLeft size={16} aria-hidden="true" /> Back to ExamMind</button>
          <button className="feedback-page-login" type="button" onClick={onSignIn}>Log in</button>
          <button className="feedback-page-cta" type="button" onClick={onGetStarted}>Get started <ArrowUpRight size={17} aria-hidden="true" /></button>
        </div>
      </header>

      <div className="feedback-page-wrap">
        <section className="feedback-page-hero" aria-labelledby="feedback-page-heading">
          <p className="feedback-page-kicker">A clearer way starts with listening</p>
          <h1 id="feedback-page-heading">Tell us what<br /><em>you noticed.</em></h1>
          <p>You do not need an ExamMind account to share an idea or report a problem. A small detail can make the next study session feel much easier.</p>
        </section>

        <div className="feedback-page-grid">
          <aside className="feedback-page-aside">
            <span>01</span>
            <p>Tell us what happened.<br />We’ll take it from there.</p>
          </aside>
          <FeedbackPanel mode="public" />
        </div>
      </div>

      <footer className="feedback-page-footer">
        <div>
          <button className="feedback-page-brand" type="button" onClick={onBackToHome} aria-label="Return to ExamMind home"><Logo size={27} /><span>Exam<span>Mind.</span></span></button>
          <p>Built around your material.<br />Improved with your notes.</p>
        </div>
        <span>© {new Date().getFullYear()} ExamMind</span>
      </footer>
    </main>
  );
}
