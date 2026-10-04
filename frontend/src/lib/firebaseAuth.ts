import { apiPost } from './api';
import type { User } from '../types';

// Render may need time to wake the API after inactivity, but authentication
// must still return control to the browser if the session exchange is stuck.
export const AUTH_REQUEST_TIMEOUT_MS = 75_000;

export type FirebaseSessionPayload = {
  firebase_id_token: string;
  google_id_token?: string;
  provider: 'password' | 'google';
  name?: string;
  username?: string;
};

export type FirebaseSessionResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export function createFirebaseSession(payload: FirebaseSessionPayload) {
  return apiPost('/auth/firebase/session', payload, { timeoutMs: AUTH_REQUEST_TIMEOUT_MS }) as Promise<FirebaseSessionResponse>;
}
