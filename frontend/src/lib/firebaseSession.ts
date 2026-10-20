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
    typeof value.email === 'string' &&
    (value.username === undefined || value.username === null || typeof value.username === 'string') &&
    (value.role === undefined || typeof value.role === 'string') &&
    (value.account_status === undefined || typeof value.account_status === 'string') &&
    (value.admin_portal_access === undefined || typeof value.admin_portal_access === 'boolean')
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

  const rawUser = value.user as Record<string, unknown>;
  return {
    access_token: value.access_token,
    token_type: value.token_type,
    user: {
      id: rawUser.id as number,
      name: rawUser.name as string,
      username: rawUser.username === undefined ? null : rawUser.username as string | null,
      email: rawUser.email as string,
      role: rawUser.role === undefined ? 'student' : rawUser.role as string,
      account_status: rawUser.account_status === undefined ? 'active' : rawUser.account_status as string,
      admin_portal_access: rawUser.admin_portal_access === undefined ? false : rawUser.admin_portal_access as boolean,
    },
  };
}
