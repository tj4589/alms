import type { ScreenType, User } from '../types';
import './Settings.css';

type SettingsProps = {
  go: (s: ScreenType) => void;
  user: User | null;
};

// The three cards that used to sit under "Privacy summary" restated the same
// three facts at greater length. Merged: the shorter headings, the fuller bodies,
// one list.
const DATA_NOTES = [
  {
    heading: 'Protected pages require a login',
    body: 'ExamMind protects student-facing pages with JWT-based login. Uploads, search, assistance, practice, progress, study groups and reading rooms all require an authenticated session.',
  },
  {
    heading: 'Progress belongs to your account',
    body: 'Practice attempts and readiness are tied to the signed-in account. The progress screen requests your own student record and does not expose another student’s progress.',
  },
  {
    heading: 'Uploaded materials are processed for retrieval',
    body: 'Academic PDFs are read for text extraction, OCR cleanup, metadata detection, semantic search and retrieval. Raw extracted text is kept for traceability and is not shown as the main preview.',
  },
];

export default function Settings({ go, user }: SettingsProps) {
  const username = user?.username ? `@${user.username}` : 'Not set';

  return (
    <div className="page" id="s-settings">
      <div className="pg-head">
        <div className="pg-title">Session <em>and data</em></div>
        <div className="pg-sub">How ExamMind handles your session and the materials you add.</div>
      </div>

      <section className="settings-account-row" aria-labelledby="settings-signed-in">
        <p className="notes-label" id="settings-signed-in">Signed in as</p>
        <div className="settings-account-line">
          <span>{user?.name || 'Student account'} <span className="settings-handle">{username}</span></span>
          <button type="button" className="account-link" onClick={() => go('profile')}>View profile &rarr;</button>
        </div>
      </section>

      <section className="notes" aria-labelledby="settings-notes-title">
        <p className="notes-label">Session and data</p>
        <h2 className="notes-title" id="settings-notes-title">How this account is handled</h2>
        <ol className="notes-list">
          {DATA_NOTES.map((note, index) => (
            <li key={note.heading}>
              <span className="notes-no">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="notes-heading">{note.heading}</h3>
                <p className="notes-body">{note.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
