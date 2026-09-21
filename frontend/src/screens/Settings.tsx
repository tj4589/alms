import { useCallback, useEffect, useRef, useState } from 'react';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, type User as FirebaseUser } from 'firebase/auth';
import type { ScreenType, User } from '../types';
import { getSessionPreference, setSessionPreference } from '../lib/session';
import { getTheme, setTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import type { SessionPreference } from '../lib/session';
import FeedbackInbox from '../components/FeedbackInbox';
import FeedbackPanel from '../components/FeedbackPanel';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { firebaseAuth, googleProvider } from '../lib/firebase';
import { clearLocalAccountState, clearToken } from '../lib/session';
import { attemptDeviceCleanup } from '../lib/deviceCleanup';
import './Settings.css';


type SettingsProps = {
  go: (s: ScreenType) => void;
  user: User | null;
  onEditProfile?: () => void;
  onAccountDeleted?: (message: string) => void;
  onAccountDeletionPending?: (message: string, firebaseDeleted: boolean) => void;
  onAccountDeactivated?: (message: string) => void;
  onAccountDeletionScheduled?: (dueAt: string) => void;
  onAccountLifecycleCleanupPending?: (kind: 'deactivated' | 'pending_deletion', deletionDueAt?: string) => void;
  onRestartOnboarding?: () => void;
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

const ACCOUNT_DELETION_UNAVAILABLE_MESSAGE = 'Account deletion is temporarily unavailable. Contact support for assistance.';

export default function Settings({ go, user, onEditProfile, onAccountDeactivated, onAccountDeletionScheduled, onAccountLifecycleCleanupPending, onRestartOnboarding }: SettingsProps) {
  const username = user?.username ? `@${user.username}` : 'Not set';
  const [sessionPref, setPref] = useState<SessionPreference>(() => getSessionPreference());
  const staySignedIn = sessionPref === 'stay';
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const darkMode = theme === 'dark';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deletionEnabled, setDeletionEnabled] = useState(false);
  const [deletionStatusLoading, setDeletionStatusLoading] = useState(true);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteInputRef = useRef<HTMLInputElement | null>(null);

  const isGoogleAccount = Boolean(firebaseAuth?.currentUser?.providerData.some((item) => item.providerId === 'google.com'));

  useEffect(() => {
    let active = true;
    setDeletionStatusLoading(true);
    apiGet('/auth/account/deletion-status')
      .then((data) => {
        if (active) setDeletionEnabled((data as { enabled?: unknown }).enabled === true);
      })
      .catch(() => {
        // The UI fails closed if the status cannot be read. The API remains
        // authoritative and also rejects the destructive request when off.
        if (active) setDeletionEnabled(false);
      })
      .finally(() => {
        if (active) setDeletionStatusLoading(false);
      });
    return () => { active = false; };
  }, []);

  const closeDelete = useCallback(() => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteConfirmation('');
    setDeletePassword('');
    setDeleteError('');
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  }, [deleting]);

  useEffect(() => {
    if (!deleteOpen) return undefined;
    deleteInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDelete();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDelete, deleteOpen]);

  const reauthenticateForAction = async (firebaseUser: FirebaseUser | null | undefined, password: string) => {
    if (!firebaseUser) throw new Error('Your sign-in session has expired. Sign in again before continuing.');
    if (isGoogleAccount) {
      await reauthenticateWithPopup(firebaseUser, googleProvider || new GoogleAuthProvider());
      return;
    }
    const email = firebaseUser.email || user?.email || '';
    if (!email || !password) throw new Error('Enter your password to continue.');
    await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(email, password));
  };

  const deactivateAccount = async () => {
    const firebaseUser = firebaseAuth?.currentUser;
    setDeactivating(true);
    setDeactivateError('');
    try {
      await reauthenticateForAction(firebaseUser, deletePassword);
      await apiPost('/auth/account/deactivate', { confirmation: 'DEACTIVATE', firebase_id_token: await firebaseUser!.getIdToken(true) });
      if (!await attemptDeviceCleanup(clearLocalAccountState)) {
        clearToken();
        onAccountLifecycleCleanupPending?.('deactivated');
        return;
      }
      onAccountDeactivated?.('Your account has been deactivated. Your study data is still safe.');
    } catch (error) {
      setDeactivateError(error instanceof Error ? error.message : 'We could not deactivate your account. Please try again.');
    } finally {
      setDeactivating(false);
    }
  };

  const deleteAccount = async () => {
    if (!deletionEnabled) {
      setDeleteError(ACCOUNT_DELETION_UNAVAILABLE_MESSAGE);
      return;
    }
    if (deleteConfirmation !== 'DELETE') {
      setDeleteError('Type DELETE exactly to confirm this permanent action.');
      return;
    }
    const firebaseUser = firebaseAuth?.currentUser;
    if (!firebaseUser) {
      setDeleteError('Your sign-in session has expired. Sign in again before deleting your account.');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await reauthenticateForAction(firebaseUser, deletePassword);
      const freshFirebaseToken = await firebaseUser.getIdToken(true);
      const response = await apiDelete('/auth/account', { confirmation: 'DELETE', firebase_id_token: freshFirebaseToken }) as { deletion_due_at?: string };
      if (!await attemptDeviceCleanup(clearLocalAccountState)) {
        clearToken();
        onAccountLifecycleCleanupPending?.('pending_deletion', response?.deletion_due_at);
        return;
      }
      if (response?.deletion_due_at) onAccountDeletionScheduled?.(response.deletion_due_at);
    } catch (deleteRequestError) {
      if (deleteRequestError instanceof Error && deleteRequestError.message === 'Account deletion is temporarily unavailable.') {
        setDeletionEnabled(false);
        setDeleteOpen(false);
        setDeleteError('');
      } else {
        setDeleteError(deleteRequestError instanceof Error ? deleteRequestError.message : 'We could not delete your account. Please try again.');
      }
    } finally {
      setDeleting(false);
    }
  };

  const closeDeactivate = () => {
    if (deactivating) return;
    setDeactivateOpen(false);
    setDeactivateError('');
    setDeletePassword('');
  };

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

      {onEditProfile && (
        <section className="setting-block" aria-labelledby="settings-academic-profile">
          <p className="notes-label">Academic profile</p>
          <h2 className="notes-title" id="settings-academic-profile">Keep your recommendations current</h2>
          <p className="setting-note">Update your department, level, courses, and interests whenever your semester changes.</p>
          <button type="button" className="account-link" onClick={onEditProfile}>Edit academic profile &rarr;</button>
        </section>
      )}

      {onRestartOnboarding && (user?.role === 'admin' || import.meta.env.DEV) && (
        <section className="setting-block" aria-labelledby="settings-restart-onboarding">
          <p className="notes-label">Testing tools</p>
          <h2 className="notes-title" id="settings-restart-onboarding">Restart onboarding</h2>
          <p className="setting-note">Reset this test account to the first onboarding step without deleting any study data or Firebase identity.</p>
          <button type="button" className="account-link" onClick={onRestartOnboarding}>Restart onboarding &rarr;</button>
        </section>
      )}

      <section className="setting-block settings-feedback-block" aria-labelledby="settings-feedback-title">
        <p className="notes-label">Help shape ExamMind</p>
        <h2 className="notes-title" id="settings-feedback-title">Tell us what you noticed</h2>
        <p className="setting-note">Found a rough edge, or have an idea that would make studying feel more natural?</p>
        <div className="settings-feedback-panel"><FeedbackPanel mode="authenticated" /></div>
      </section>

      {user?.role === 'admin' && <FeedbackInbox />}

      <section className="setting-block" aria-labelledby="settings-deactivate-title">
        <p className="notes-label">Account</p>
        <h2 className="notes-title" id="settings-deactivate-title">Deactivate account</h2>
        <p className="setting-note">Take a break and return whenever you’re ready. Your profile and data will be kept, and offline files on this device will be cleared for privacy.</p>
        <button type="button" className="onboarding-back" onClick={() => setDeactivateOpen(true)}>Deactivate account</button>
      </section>

      <section className="setting-block settings-danger-zone" aria-labelledby="settings-danger-title">
        <p className="notes-label">Danger zone</p>
        <h2 className="notes-title" id="settings-danger-title">Delete your account</h2>
        <p className="setting-note">Deactivate now and permanently delete after 30 days. You can cancel during that period; offline files on this device will be cleared for privacy.</p>
        {deletionStatusLoading ? <p className="setting-note" role="status">Checking account deletion availability...</p> : !deletionEnabled && <p className="setting-note" role="status">{ACCOUNT_DELETION_UNAVAILABLE_MESSAGE}</p>}
        <button ref={deleteTriggerRef} type="button" className="danger-button" onClick={() => { if (deletionEnabled) setDeleteOpen(true); }} disabled={deletionStatusLoading || !deletionEnabled}>Delete account</button>
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

      {deleteOpen && <div className="account-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}>
        <section className="account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="account-delete-title" aria-describedby="account-delete-copy">
          <p className="notes-label">Permanent action</p>
          <h2 className="notes-title" id="account-delete-title">Delete your ExamMind account?</h2>
          <p id="account-delete-copy" className="account-delete-copy">Your account will be deactivated immediately and permanently deleted after 30 days. Your data remains recoverable during that period.</p>
          <p className="account-delete-copy">Public discussions and replies are preserved without presenting you as currently active.</p>
          {isGoogleAccount ? <p className="account-delete-auth-note">You will confirm your Google account in a secure sign-in window before deletion.</p> : <label className="onboarding-field account-delete-field" htmlFor="account-delete-password"><span>Confirm your password</span><input id="account-delete-password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" disabled={deleting} /></label>}
          <label className="onboarding-field account-delete-field" htmlFor="account-delete-confirm"><span>Type DELETE to continue</span><input ref={deleteInputRef} id="account-delete-confirm" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoCapitalize="characters" autoComplete="off" disabled={deleting} /></label>
          {deleteError && <p className="onboarding-error" role="alert">{deleteError}</p>}
          <div className="account-delete-actions"><button type="button" className="onboarding-back" onClick={closeDelete} disabled={deleting}>Cancel</button><button type="button" className="danger-button danger-button-confirm" onClick={() => void deleteAccount()} disabled={!deletionEnabled || deleting || deleteConfirmation !== 'DELETE' || (!isGoogleAccount && !deletePassword)}>{deleting ? 'Scheduling…' : 'Schedule deletion'}</button></div>
        </section>
      </div>}

      {deactivateOpen && <div className="account-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeactivate(); }}>
        <section className="account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="account-deactivate-title" aria-describedby="account-deactivate-copy">
          <p className="notes-label">Take a break</p>
          <h2 className="notes-title" id="account-deactivate-title">Deactivate your account?</h2>
          <p id="account-deactivate-copy" className="account-delete-copy">Your profile will be marked inactive and you’ll be signed out. Your study data, uploads, courses, groups, discussions and rooms will be kept for when you return.</p>
          {isGoogleAccount ? <p className="account-delete-auth-note">You will confirm your Google account in a secure sign-in window before deactivation.</p> : <label className="onboarding-field account-delete-field" htmlFor="account-deactivate-password"><span>Confirm your password</span><input id="account-deactivate-password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" disabled={deactivating} /></label>}
          {deactivateError && <p className="onboarding-error" role="alert">{deactivateError}</p>}
          <div className="account-delete-actions"><button type="button" className="onboarding-back" onClick={closeDeactivate} disabled={deactivating}>Keep my account</button><button type="button" className="danger-button danger-button-confirm" onClick={() => void deactivateAccount()} disabled={deactivating || (!isGoogleAccount && !deletePassword)}>{deactivating ? 'Deactivating…' : 'Confirm deactivation'}</button></div>
        </section>
      </div>}
    </div>
  );
}
