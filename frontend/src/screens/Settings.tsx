import { useState } from 'react';
import type { ScreenType, User } from '../types';
import { getSessionPreference, setSessionPreference } from '../lib/session';
import type { SessionPreference } from '../lib/session';
import './Settings.css';

const SESSION_CHOICES: { value: SessionPreference; title: string; body: string }[] = [
  {
    value: 'stay',
    title: 'Keep me signed in',
    body: 'Your session survives closing the browser. Convenient on a laptop only you use.',
  },
  {
    value: 'ask',
    title: 'Sign in each visit',
    body: 'Your session ends when you close the browser. Use this on a shared or library machine.',
  },
];

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
  const [sessionPref, setPref] = useState<SessionPreference>(() => getSessionPreference());

  const choosePreference = (value: SessionPreference) => {
    setSessionPreference(value);
    setPref(value);
  };

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

      <section className="setting-block" aria-labelledby="settings-session-title">
        <p className="notes-label">Staying signed in</p>
        <h2 className="notes-title" id="settings-session-title">How long should this session last?</h2>
        <div className="setting-choices" role="radiogroup" aria-labelledby="settings-session-title">
          {SESSION_CHOICES.map((choice) => (
            <button
              type="button"
              key={choice.value}
              role="radio"
              aria-checked={sessionPref === choice.value}
              className={`setting-choice${sessionPref === choice.value ? ' is-on' : ''}`}
              onClick={() => choosePreference(choice.value)}
            >
              <span className="setting-choice-mark" aria-hidden="true" />
              <span>
                <span className="setting-choice-title">{choice.title}</span>
                <span className="setting-choice-body">{choice.body}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="setting-note">
          {sessionPref === 'ask'
            ? 'Applied now, not just next time: your current session already ends when the browser closes.'
            : 'Signing out from the sidebar ends the session immediately, whichever option is chosen.'}
        </p>
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
