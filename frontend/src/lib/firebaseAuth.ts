import { apiPost } from './api';

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
};

export function createFirebaseSession(payload: FirebaseSessionPayload) {
  return apiPost('/auth/firebase/session', payload) as Promise<FirebaseSessionResponse>;
}
