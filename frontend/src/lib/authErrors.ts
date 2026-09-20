export const PASSWORD_RESET_GENERIC_MESSAGE = 'If that account exists, a password reset link is on its way.';

function firebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
}

/**
 * Keep password-reset failures enumeration-safe. Firebase may return account
 * discovery errors for both existing and missing accounts, so those all use
 * the same generic response.
 */
export function forgotPasswordErrorMessage(error: unknown): string {
  switch (firebaseErrorCode(error)) {
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/user-disabled':
    case 'auth/operation-not-allowed':
    case 'auth/invalid-action-code':
      return PASSWORD_RESET_GENERIC_MESSAGE;
    case 'auth/network-request-failed':
      return 'The authentication service could not be reached. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many reset requests. Wait a moment, then try again.';
    default:
      return PASSWORD_RESET_GENERIC_MESSAGE;
  }
}
