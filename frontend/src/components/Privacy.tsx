import type { MouseEvent as ReactMouseEvent } from 'react';
import { ArrowLeft, ArrowUpRight, Mail, ShieldCheck } from 'lucide-react';
import Logo from './Logo';
import './Privacy.css';

type PrivacyProps = {
  onBackToHome: () => void;
  onGetStarted: () => void;
  onSignIn: () => void;
};

const EFFECTIVE_DATE = 'September 20, 2026';
const CONTACT_EMAIL = 'ekpokpobeoghenetejiri29@gmail.com';

export default function Privacy({ onBackToHome, onGetStarted, onSignIn }: PrivacyProps) {
  const handleHomeLink = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onBackToHome();
  };

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <a className="privacy-brand" href="/" onClick={handleHomeLink} aria-label="ExamMind home">
          <Logo size={32} />
          <span>Exam<span>Mind.</span></span>
        </a>
        <div className="privacy-header-actions">
          <button className="privacy-back" type="button" onClick={onBackToHome}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to ExamMind
          </button>
          <button className="privacy-login" type="button" onClick={onSignIn}>Log in</button>
          <button className="privacy-cta" type="button" onClick={onGetStarted}>
            Get started <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="privacy-wrap">
        <section className="privacy-hero" aria-labelledby="privacy-heading">
          <p className="privacy-effective">Effective date · {EFFECTIVE_DATE}</p>
          <h1 id="privacy-heading">Privacy, in <em>plain language.</em></h1>
          <p>
            ExamMind is a study workspace for Covenant University students. This policy explains
            what we collect, why we use it, and the choices you have around your account and study material.
          </p>
        </section>

        <div className="privacy-layout">
          <aside className="privacy-aside" aria-label="On this page">
            <div className="privacy-aside-note">
              <ShieldCheck size={20} aria-hidden="true" />
              <span>Built around your material.<br />Handled with care.</span>
            </div>
            <nav>
              <a href="#information-we-collect">Information we collect</a>
              <a href="#how-we-use-it">How we use it</a>
              <a href="#providers">Service providers</a>
              <a href="#retention-and-deletion">Retention and deletion</a>
              <a href="#security">Security</a>
            </nav>
          </aside>

          <div className="privacy-content">
            <section className="privacy-section" id="information-we-collect">
              <p className="privacy-section-index">01</p>
              <div>
                <h2>Information we collect</h2>
                <p>Depending on how you use ExamMind, we may collect:</p>
                <ul>
                  <li><strong>Account details</strong><span>Your name, username, university email address, and password.</span></li>
                  <li><strong>Study material</strong><span>Files and content you upload, such as lecture notes, past questions, and scanned PDFs.</span></li>
                  <li><strong>Study activity</strong><span>Searches, topics, practice activity, and questions you ask the AI assistant.</span></li>
                  <li><strong>Technical information</strong><span>Basic information needed to keep the service working, such as browser, device, and service logs.</span></li>
                </ul>
              </div>
            </section>

            <section className="privacy-section" id="google-sign-in">
              <p className="privacy-section-index">02</p>
              <div>
                <h2>Google Sign-In data</h2>
                <p>
                  If you choose Google Sign-In, Google may provide ExamMind with your Google account ID,
                  name, email address, and profile picture where available. We use this information to create
                  or access your ExamMind account and to show your account identity in the workspace.
                </p>
                <p>ExamMind does not receive your Google password.</p>
              </div>
            </section>

            <section className="privacy-section" id="how-we-use-it">
              <p className="privacy-section-index">03</p>
              <div>
                <h2>How we use information</h2>
                <p>We use information to:</p>
                <ul className="privacy-simple-list">
                  <li>authenticate you and keep your account signed in;</li>
                  <li>receive, process, and organise uploaded study materials;</li>
                  <li>extract text with document processing and OCR where needed;</li>
                  <li>index material for semantic and keyword search;</li>
                  <li>answer AI study questions using the material available to your workspace; and</li>
                  <li>maintain, troubleshoot, and improve the service.</li>
                </ul>
              </div>
            </section>

            <section className="privacy-section" id="providers">
              <p className="privacy-section-index">04</p>
              <div>
                <h2>Service providers and AI processing</h2>
                <p>
                  Some ExamMind features depend on configured service providers. Uploaded materials, extracted
                  text, searches, or AI questions may be processed by configured AI, embedding, OCR, database,
                  email, hosting, or other infrastructure providers when that is needed to provide the feature.
                </p>
                <p>
                  We send information for the requested purpose and configure providers according to the needs of
                  the service. Provider settings can change as ExamMind develops.
                </p>
              </div>
            </section>

            <section className="privacy-section" id="passwords-and-codes">
              <p className="privacy-section-index">05</p>
              <div>
                <h2>Passwords and verification codes</h2>
                <p>
                  Passwords are protected using one-way password hashing rather than being stored as readable text.
                  Where email verification uses a one-time passcode (OTP), the code is treated as a short-lived,
                  single-use authentication secret and expires after its validity window.
                </p>
              </div>
            </section>

            <section className="privacy-section" id="retention-and-deletion">
              <p className="privacy-section-index">06</p>
              <div>
                <h2>Retention and deletion</h2>
                <p>
                  We keep account information, uploaded material, and related study activity while your account is
                  active or for as long as needed to provide the service. You can request deletion of your account
                  and associated data by emailing us. Include the university email or username connected to the account
                  so we can identify the request.
                </p>
                <p>
                  Some limited records may remain for a period in backups, security logs, or where retention is needed
                  to protect the service or comply with a valid obligation. We do not sell personal information.
                </p>
              </div>
            </section>

            <section className="privacy-section" id="security">
              <p className="privacy-section-index">07</p>
              <div>
                <h2>Security</h2>
                <p>
                  ExamMind uses reasonable protections for the information it handles, including password hashing,
                  authenticated API requests, access controls, and HTTPS for deployed web and API traffic. No online
                  service can promise perfect security, so please protect your password and tell us promptly if you
                  believe your account has been used without permission.
                </p>
              </div>
            </section>

            <section className="privacy-contact" id="contact">
              <div>
                <p className="privacy-section-index">08</p>
                <h2>Questions or deletion requests?</h2>
                <p>Contact the ExamMind team at the address below.</p>
              </div>
              <a href={`mailto:${CONTACT_EMAIL}`}>
                <Mail size={18} aria-hidden="true" />
                {CONTACT_EMAIL}
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </section>
          </div>
        </div>
      </div>

      <footer className="privacy-footer">
        <div className="privacy-footer-inner">
          <a className="privacy-footer-brand" href="/" onClick={handleHomeLink} aria-label="ExamMind home">
            <Logo size={28} />
            <span>Exam<span>Mind.</span></span>
          </a>
          <p>© {new Date().getFullYear()} ExamMind<br />A clearer way to study.</p>
          <div>
            <a href="/" onClick={handleHomeLink}>Home</a>
            <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
