import { useState } from 'react';
import type { ScreenType, User } from '../types';
import { getSessionPreference, setSessionPreference } from '../lib/session';
import { getTheme, setTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import type { SessionPreference } from '../lib/session';
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
  const [sessionPref, setPref] = useState<SessionPreference>(() => getSessionPreference());
  const staySignedIn = sessionPref === 'stay';
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const darkMode = theme === 'dark';

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

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

        <div className="setting-row">
          <label className="setting-row-text" htmlFor="session-toggle">
            <span className="setting-row-title">Keep me signed in</span>
            <span className="setting-row-body">
              {staySignedIn
                ? 'This session survives closing the browser. Convenient on a laptop only you use.'
                : 'This session ends when you close the browser. Safer on a shared or library machine.'}
            </span>
          </label>
          <button
            type="button"
            id="session-toggle"
            role="switch"
            aria-checked={staySignedIn}
            className={`switch${staySignedIn ? ' is-on' : ''}`}
            onClick={() => choosePreference(staySignedIn ? 'ask' : 'stay')}
          >
            <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
            <span className="sr-only">{staySignedIn ? 'On' : 'Off'}</span>
          </button>
        </div>

        <p className="setting-note">
          {staySignedIn
            ? 'Signing out from the sidebar ends the session immediately either way.'
            : 'Applied now, not just next time: your current session already ends when the browser closes.'}
        </p>
      </section>

      <section className="setting-block" aria-labelledby="settings-theme-title">
        <p className="notes-label">Appearance</p>
        <h2 className="notes-title" id="settings-theme-title">Dark mode</h2>

        <div className="setting-row">
          <label className="setting-row-text" htmlFor="theme-toggle">
            <span className="setting-row-title">Use the dark palette</span>
            <span className="setting-row-body">
              {darkMode
                ? 'Ink on a dark ground, for reading at night.'
                : 'Paper and ink, the default. Turn this on for a dark ground.'}
            </span>
          </label>
          <button
            type="button"
            id="theme-toggle"
            role="switch"
            aria-checked={darkMode}
            className={`switch${darkMode ? ' is-on' : ''}`}
            onClick={() => chooseTheme(darkMode ? 'light' : 'dark')}
          >
            <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
            <span className="sr-only">{darkMode ? 'On' : 'Off'}</span>
          </button>
        </div>
        <p className="setting-note">
          Applies to your study screens. The public landing page stays light.
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
