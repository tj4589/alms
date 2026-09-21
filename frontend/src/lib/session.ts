// Where the auth token lives is a user choice, so it goes through here rather
// than reaching for localStorage in seven different places.
//
//   'stay'  - localStorage. The session survives closing the browser. Convenient
//             on a personal laptop, wrong on a shared library machine.
//   'ask'   - sessionStorage. The token is dropped when the tab closes, so the
//             next arrival signs in again.
//
// Reads check both stores, so a token written under the old behaviour is still
// found after this shipped and nobody is logged out by the upgrade.

import { clearOfflineAccountData } from '../offline';

export type SessionPreference = 'stay' | 'ask';

const TOKEN_KEY = 'token';
const PREF_KEY = 'exammind-session-preference';

function safe<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    // Private mode, blocked site data, or a sandboxed frame.
    return fallback;
  }
}

export function getSessionPreference(): SessionPreference {
  return safe(() => (window.localStorage.getItem(PREF_KEY) === 'ask' ? 'ask' : 'stay'), 'stay');
}

export function getToken(): string | null {
  return safe(
    () => window.sessionStorage.getItem(TOKEN_KEY) ?? window.localStorage.getItem(TOKEN_KEY),
    null,
  );
}

export function setToken(token: string): void {
  safe(() => {
    if (getSessionPreference() === 'ask') {
      window.sessionStorage.setItem(TOKEN_KEY, token);
      window.localStorage.removeItem(TOKEN_KEY);
    } else {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.sessionStorage.removeItem(TOKEN_KEY);
    }
  }, undefined);
}

export function clearToken(): void {
  safe(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
  }, undefined);
}

export async function clearLocalAccountState(): Promise<void> {
  await clearOfflineAccountData();
  safe(() => {
    window.sessionStorage.removeItem('exammind-pending-firebase-profile');
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('exammind-discussion-draft:')) window.sessionStorage.removeItem(key);
    }
    window.localStorage.removeItem('exammind-profile-nudge-dismissed');
  }, undefined);
}

/**
 * Changing the preference moves the token the user is currently holding, so the
 * choice takes effect on this session rather than only the next sign-in --
 * switching to 'ask' on a shared machine has to end the persistence now, not
 * after they have already walked away.
 */
export function setSessionPreference(preference: SessionPreference): void {
  safe(() => {
    window.localStorage.setItem(PREF_KEY, preference);
    const token = getToken();
    if (token) setToken(token);
  }, undefined);
}
