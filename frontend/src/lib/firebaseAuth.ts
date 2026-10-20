import { apiPost, API_INVALID_RESPONSE_ERROR } from './api';
import { mapFirebaseSessionResponse, type FirebaseSessionResponse } from './firebaseSession';

export type { FirebaseSessionResponse } from './firebaseSession';

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

export async function createFirebaseSession(payload: FirebaseSessionPayload): Promise<FirebaseSessionResponse> {
  const response = await apiPost('/auth/firebase/session', payload, { timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
  try {
    return mapFirebaseSessionResponse(response);
  } catch {
    // Keep the existing safe UX mapping while ensuring no partial session can
    // reach App.tsx and leave the user in an invalid authenticated state.
    throw new Error(API_INVALID_RESPONSE_ERROR);
  }
}
