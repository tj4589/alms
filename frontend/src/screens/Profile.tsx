import type { ScreenType, User } from '../types';
import './Settings.css';

type ProfileProps = {
  go: (s: ScreenType) => void;
  user: User | null;
};

export default function Profile({ go, user }: ProfileProps) {
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
    <div className="page" id="s-profile">
      <div className="pg-head">
        <div className="pg-title">Your <em>Profile</em></div>
        <div className="pg-sub">How you appear to the rest of your course on ExamMind.</div>
      </div>

      <section className="account-sheet" aria-labelledby="profile-account-title">
        <span className="account-marks" aria-hidden="true"><i /><i /><i /><i /></span>

        <div className="account-id">
          <span className="account-initials" aria-hidden="true">{initials}</span>
          <div>
            <h2 className="account-name" id="profile-account-title">{user?.name || 'Student account'}</h2>
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

      <section className="account-aside" aria-labelledby="profile-visible-title">
        <p className="notes-label">What others see</p>
        <h2 className="notes-title" id="profile-visible-title">Your username, not your email</h2>
        <p className="notes-body">
          Discussions, study groups and reading rooms show {username}. Your email address and
          practice results are never shown to other students.
        </p>
        <button type="button" className="account-link" onClick={() => go('settings')}>
          Session and data settings &rarr;
        </button>
      </section>
    </div>
  );
}
