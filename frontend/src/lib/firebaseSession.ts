import type { User } from '../types';

export type FirebaseSessionResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export const FIREBASE_SESSION_RESPONSE_ERROR = 'ExamMind received an invalid Firebase session response.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionUser(value: unknown): value is User {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'number' &&
    Number.isFinite(value.id) &&
    typeof value.name === 'string' &&
    (value.username === null || typeof value.username === 'string') &&
    typeof value.email === 'string' &&
    typeof value.role === 'string'
  );
}

/**
 * Convert the authenticated-session payload into the exact client contract.
 * The server response is intentionally not accepted via a TypeScript cast:
 * a 200 response with an empty, enveloped, or partial body must not advance
 * the app into a half-authenticated state.
 */
export function mapFirebaseSessionResponse(value: unknown): FirebaseSessionResponse {
  if (!isRecord(value)) throw new Error(FIREBASE_SESSION_RESPONSE_ERROR);
  if (typeof value.access_token !== 'string' || !value.access_token.trim()) {
    throw new Error(FIREBASE_SESSION_RESPONSE_ERROR);
  }
  if (typeof value.token_type !== 'string' || !value.token_type.trim()) {
    throw new Error(FIREBASE_SESSION_RESPONSE_ERROR);
  }
  if (!isSessionUser(value.user)) throw new Error(FIREBASE_SESSION_RESPONSE_ERROR);

  return {
    access_token: value.access_token,
    token_type: value.token_type,
    user: value.user,
  };
}
