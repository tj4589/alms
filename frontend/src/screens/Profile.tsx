import { useEffect, useState } from 'react';
import type { ScreenType, User } from '../types';
import { apiGet } from '../lib/api';
import './Profile.css';

type ProfileProps = {
  go: (s: ScreenType) => void;
  user: User | null;
  username?: string | null;
};

type PublicProfile = {
  id: number;
  username: string | null;
  name: string | null;
  is_self: boolean;
  past_questions_uploaded: number;
  lecture_notes_uploaded: number;
  materials_uploaded: number;
  groups_joined: number;
  rooms_joined: number;
  practice_attempts?: number;
};

type Badge = { key: string; label: string; earned: boolean; detail: string };

function initialsOf(name: string | null | undefined, fallback = 'Student'): string {
  return (name || fallback)
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join('').toUpperCase();
}

// Badges are thresholds over counts that already exist, so each one is a fact
// about what the student actually did. Nothing is awarded for showing up.
function badgesFor(profile: PublicProfile): Badge[] {
  const m = profile.materials_uploaded;
  const r = profile.rooms_joined;
  const g = profile.groups_joined;
  return [
    { key: 'first', label: 'First upload', earned: m >= 1, detail: 'Filed a material to the archive' },
    { key: 'ten', label: 'Ten filed', earned: m >= 10, detail: '10 materials in the shared archive' },
    { key: 'rooms', label: 'Room regular', earned: r >= 5, detail: 'Sat in 5 reading rooms' },
    { key: 'groups', label: 'Connector', earned: g >= 3, detail: 'Active in 3 study groups' },
  ];
}

export default function Profile({ go, user, username }: ProfileProps) {
  const handle = username || user?.username || null;
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    apiGet(`/profiles/${encodeURIComponent(handle)}`)
      .then((data) => {
        if (cancelled) return;
        setProfile(data as PublicProfile);
        setFailed(false);
        setLoadedFor(handle);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoadedFor(handle);
      });
    return () => { cancelled = true; };
  }, [handle]);

  // Derived rather than set, so nothing writes state synchronously during the
  // effect and triggers a cascading render.
  const state: 'loading' | 'ready' | 'error' | 'missing' =
    !handle ? 'missing'
      : loadedFor !== handle ? 'loading'
        : failed ? 'error'
          : profile ? 'ready' : 'loading';

  const isSelf = profile?.is_self ?? !username;
  const displayName = profile?.name || user?.name || 'Student';
  const displayHandle = profile?.username || handle;

  return (
    <div className="page" id="s-profile">
      {/* Identity block: avatar beside name, handle, counts and actions --
          the shape every social profile uses, because it is the one people
          already know how to read. */}
      <header className="pf-head">
        <span className="pf-avatar" aria-hidden="true">{initialsOf(displayName)}</span>

        <div className="pf-identity">
          <div className="pf-nameline">
            <h1 className="pf-name">{displayName}</h1>
            {displayHandle && <span className="pf-handle">@{displayHandle}</span>}
          </div>

          {state === 'ready' && profile && (
            <dl className="pf-counts">
              <div>
                <dt>Materials</dt>
                <dd>{profile.materials_uploaded}</dd>
              </div>
              <div>
                <dt>Groups</dt>
                <dd>{profile.groups_joined}</dd>
              </div>
              <div>
                <dt>Reading rooms</dt>
                <dd>{profile.rooms_joined}</dd>
              </div>
              {isSelf && profile.practice_attempts !== undefined && (
                <div>
                  <dt>Practice</dt>
                  <dd>{profile.practice_attempts}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="pf-actions">
            {isSelf ? (
              <>
                <button type="button" className="pf-btn" onClick={() => go('settings')}>Edit settings</button>
                <button type="button" className="pf-btn is-quiet" onClick={() => go('upload')}>Add materials</button>
              </>
            ) : (
              <button type="button" className="pf-btn is-quiet" onClick={() => go('groups')}>Find shared groups</button>
            )}
          </div>
        </div>
      </header>

      {state === 'loading' && <p className="pf-state">Loading profile...</p>}
      {state === 'missing' && <p className="pf-state">This account has no username yet, so it has no public profile.</p>}
      {state === 'error' && (
        <p className="pf-state pf-state-error" role="alert">
          That profile could not be loaded. It may not exist, or the connection dropped.
        </p>
      )}

      {state === 'ready' && profile && (
        <>
          <section className="pf-section" aria-labelledby="pf-contrib">
            <p className="pf-label">Contributions</p>
            <h2 className="pf-section-title" id="pf-contrib">What {isSelf ? 'you have' : `@${displayHandle} has`} added</h2>
            <dl className="pf-breakdown">
              <div><dt>Past questions</dt><dd>{profile.past_questions_uploaded}</dd></div>
              <div><dt>Lecture notes</dt><dd>{profile.lecture_notes_uploaded}</dd></div>
              <div><dt>Study groups joined</dt><dd>{profile.groups_joined}</dd></div>
              <div><dt>Reading rooms sat in</dt><dd>{profile.rooms_joined}</dd></div>
            </dl>
            {profile.materials_uploaded === 0 && (
              <p className="pf-note">
                {isSelf
                  ? 'Nothing filed yet. Anything you add is available to everyone on the course.'
                  : 'No materials filed yet.'}
              </p>
            )}
          </section>

          <section className="pf-section" aria-labelledby="pf-badges">
            <p className="pf-label">Badges</p>
            <h2 className="pf-section-title" id="pf-badges">Earned from real contributions</h2>
            <ul className="pf-badges">
              {badgesFor(profile).map((badge) => (
                <li key={badge.key} className={`pf-badge${badge.earned ? ' is-earned' : ''}`}>
                  <span className="pf-badge-label">{badge.label}</span>
                  <span className="pf-badge-detail">{badge.detail}</span>
                  {!badge.earned && <span className="pf-badge-state">Not yet</span>}
                </li>
              ))}
            </ul>
          </section>

          {isSelf && (
            <section className="pf-section pf-section--end" aria-labelledby="pf-private">
              <p className="pf-label">Only you see this</p>
              <h2 className="pf-section-title" id="pf-private">Your results stay yours</h2>
              <p className="pf-note">
                Readiness and practice scores are never shown on a profile another student
                can open. They contribute to your own progress screen and nothing else.
              </p>
              <button type="button" className="pf-link" onClick={() => go('progress')}>Open progress &rarr;</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
