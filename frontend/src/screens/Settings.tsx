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

export default function Settings({ user }: SettingsProps) {
  const username = user?.username ? `@${user.username}` : 'Not set';
  // Word initials, so "Dev Student" reads DS like the sidebar avatar, not DE.
  const initials = (user?.name || 'Student')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="page" id="s-settings">
      <div className="pg-head">
        <div className="pg-title">Student <em>Settings</em></div>
        <div className="pg-sub">Your account record, and how ExamMind handles your session and the materials you add.</div>
      </div>

      <section className="account-sheet" aria-labelledby="settings-account-title">
        <span className="account-marks" aria-hidden="true"><i /><i /><i /><i /></span>

        <div className="account-id">
          <span className="account-initials" aria-hidden="true">{initials}</span>
          <div>
            <h2 className="account-name" id="settings-account-title">{user?.name || 'Student account'}</h2>
            <p className="account-handle">{username}</p>
          </div>
        </div>

        <dl className="account-facts">
          <div><dt>Name</dt><dd>{user?.name || 'Not available'}</dd></div>
          <div><dt>Username</dt><dd>{username}</dd></div>
          <div><dt>Email</dt><dd>{user?.email || 'Not available'}</dd></div>
          <div><dt>Account type</dt><dd>Student</dd></div>
        </dl>
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
