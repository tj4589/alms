import { apiPost } from './api';
import type { User } from '../types';

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
  return apiPost('/auth/firebase/session', payload) as Promise<FirebaseSessionResponse>;
}
